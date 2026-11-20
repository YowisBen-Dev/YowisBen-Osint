'use strict';
/* Klien AI multi-provider untuk YowisBen Controller.
 *
 * Mendukung tiga jalur (dipilih otomatis):
 *  1. Gemini (Google AI Studio)  -> GEMINI_API_KEY  (key berawalan AIza)
 *  2. Provider OpenAI-compatible -> AI_API_KEY + AI_PROVIDER (groq | deepseek | openrouter | custom)
 *     - tanpa AI_PROVIDER, provider dideteksi otomatis dari awalan key:
 *       gsk_ -> Groq (gratis), sk-or- -> OpenRouter, sk- -> DeepSeek
 *  3. Tanpa key sama sekali -> available() false (pemanggil memakai fallback sendiri)
 *
 * Semua pemanggilan AI proyek ini lewat modul ini: verifikasi screenshot (vision)
 * dan generator fitur (teks). Model bisa dioverride via AI_TEXT_MODEL / AI_VISION_MODEL.
 */

/* Preset provider OpenAI-compatible: base URL + model bawaan.
 * Model default bisa berubah dari sisi provider — selalu bisa dioverride lewat env. */
const PRESETS = {
  groq:       { name: 'Groq', base: 'https://api.groq.com/openai/v1',      text: 'llama-3.3-70b-versatile',    vision: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  deepseek:   { name: 'DeepSeek', base: 'https://api.deepseek.com/v1',     text: 'deepseek-chat',              vision: null },
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1',  text: 'nvidia/nemotron-3-ultra-550b-a55b:free', vision: 'nvidia/nemotron-3.5-super-vl:free' },
};

const GEMINI_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

/* Model cadangan per provider — model gratis sering flaky/rate-limit, jadi satu
 * kegagalan tidak boleh menggagalkan fitur. Bisa dioverride via AI_FALLBACK_MODELS
 * (dipisah koma). Daftar terverifikasi Nov 2026 dengan key OpenRouter aktif. */
const FALLBACK_MODELS = {
  groq: ['llama-3.1-8b-instant'],
  deepseek: [],
  openrouter: {
    text: ['nvidia/nemotron-3.5-lightning:free', 'openrouter/free', 'baidu/ernie-5.5-flash-preview:free', 'recursive/flint-v1.0:free'],
    vision: ['dots-studio/dots-3-note-preview:free', 'openrouter/free'],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function geminiKey() { return (process.env.GEMINI_API_KEY || '').trim(); }

/* Pilihan provider OpenAI-compatible dari env, dengan deteksi otomatis awalan key. */
function compatChoice() {
  const key = (process.env.AI_API_KEY || '').trim();
  if (!key) return null;
  const p = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (p === 'gemini') return null; // eksplisit: pakai Gemini saja
  if (p) return { provider: p, key };
  if (key.startsWith('gsk_')) return { provider: 'groq', key };
  if (key.startsWith('sk-or-')) return { provider: 'openrouter', key };
  if (key.startsWith('sk-')) return { provider: 'deepseek', key };
  return { provider: 'custom', key }; // awalan tidak dikenal — wajib AI_BASE_URL/AI_TEXT_MODEL
}

/* Provider aktif saat ini (dinilai tiap panggilan agar perubahan env langsung berlaku). */
function active() {
  const c = compatChoice();
  if (c) {
    const preset = PRESETS[c.provider];
    const base = ((process.env.AI_BASE_URL || '').trim() || (preset && preset.base) || '').replace(/\/+$/, '');
    const textModel = (process.env.AI_TEXT_MODEL || '').trim() || (preset && preset.text) || '';
    const visionModel = (process.env.AI_VISION_MODEL || '').trim() || (preset && preset.vision) || '';
    if (!base || !textModel) return null; // provider custom tanpa base/model — dianggap tidak lengkap
    return { kind: 'compat', provider: c.provider, name: (preset && preset.name) || c.provider, key: c.key, base, textModel, visionModel };
  }
  if (geminiKey()) {
    return { kind: 'gemini', provider: 'gemini', name: 'Gemini', key: geminiKey(), base: 'https://generativelanguage.googleapis.com/v1beta', textModel: '', visionModel: '' };
  }
  return null;
}

function available() { return !!active(); }
/* Vision tersedia bila provider punya model vision (DeepSeek API: teks saja). */
function visionAvailable() {
  const a = active();
  return !!a && (a.kind === 'gemini' || !!a.visionModel);
}
function providerInfo() {
  const a = active();
  if (!a) return null;
  return { provider: a.provider, name: a.name, kind: a.kind, textModel: a.textModel || 'gemini-2.5-flash', visionModel: a.visionModel || null };
}

/* ================= jalur Gemini ================= */
async function geminiGenerate(model, key, base, parts, timeoutMs, maxTokens) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        msg = 'GEMINI_API_KEY tidak valid — buat API key baru di aistudio.google.com/apikey (berawalan AIza), atau pakai provider lain (mis. Groq gratis) lewat AI_API_KEY.';
      }
      const err = new Error(`Gemini: ${msg}`);
      err.status = res.status;
      const alt = String((data && data.error && data.error.message) || '').match(/use models\/([a-z0-9.\-]+)/i);
      if (alt) return geminiGenerate(alt[1], key, base, parts, timeoutMs, maxTokens); // saran model pengganti dari API
      throw err;
    }
    const c = data && data.candidates && data.candidates[0];
    const txt = c && c.content && c.content.parts ? c.content.parts.map((p) => p.text || '').join('').trim() : '';
    if (!txt) throw new Error('Gemini: respons kosong');
    return txt;
  } finally {
    clearTimeout(t);
  }
}

async function geminiCall(parts, { timeoutMs = 45000, maxTokens = 2048 } = {}) {
  const a = active();
  const model = (process.env.GEMINI_MODEL || '').trim() || 'gemini-2.5-flash';
  const chain = [model, ...GEMINI_FALLBACKS.filter((m) => m !== model)];
  let lastErr = null;
  for (const m of chain) {
    try {
      return await geminiGenerate(m, a.key, a.base, parts, timeoutMs, maxTokens);
    } catch (e) {
      lastErr = e;
      if (e.status !== 404) throw e; // hanya 404 model yang layak dicoba dengan model berikutnya
    }
  }
  throw lastErr;
}

/* ================= jalur OpenAI-compatible ================= */
async function compatCall({ prompt, imageB64, mimeType = 'image/jpeg', timeoutMs, maxTokens }) {
  const a = active();
  if (!a) throw new Error('AI_API_KEY belum diisi di environment');
  const isVision = !!imageB64;
  if (isVision && !a.visionModel) {
    throw new Error(`Provider ${a.name} tidak mendukung analisis gambar. Pakai GEMINI_API_KEY atau AI_API_KEY Groq (gratis) untuk verifikasi screenshot, atau verifikasi manual: /verif <id_user>.`);
  }
  const primary = isVision ? a.visionModel : a.textModel;
  const envFb = (process.env.AI_FALLBACK_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const fbDef = FALLBACK_MODELS[a.provider];
  const fbList = envFb.length ? envFb : Array.isArray(fbDef) ? fbDef : ((isVision ? fbDef && fbDef.vision : fbDef && fbDef.text) || []);
  const models = [primary, ...fbList.filter((m) => m && m !== primary)];

  let lastErr = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const content = [{ type: 'text', text: prompt }];
    if (imageB64) content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageB64}` } });
    let data;
    try {
      const res = await fetch(`${a.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.key}`, 'X-Title': 'YowisBen Bot Controller' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ model, temperature: 0.4, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403) {
          const ke = new Error(`API key ${a.name} tidak valid — periksa AI_API_KEY di Pengaturan (key Groq berawalan gsk_, DeepSeek sk-, OpenRouter sk-or-).`);
          ke.keyInvalid = true;
          throw ke;
        }
        if (i < models.length - 1 && (res.status === 404 || res.status === 429 || res.status === 503)) {
          lastErr = new Error(`${a.name} (${model}): ${msg}`);
          if (res.status === 429) await sleep(3000); // rate limit — jeda lalu coba model cadangan
          continue;
        }
        if (res.status === 404) msg = `Model "${model}" tidak tersedia di ${a.name} — isi AI_TEXT_MODEL / AI_VISION_MODEL dengan nama model yang valid.`;
        if (res.status === 429) msg = `Rate limit ${a.name} tercapai — tunggu sebentar lalu coba lagi.`;
        throw new Error(`${a.name}: ${msg}`);
      }
    } catch (e) {
      if (e && e.keyInvalid) throw e;
      if (!lastErr) lastErr = e;
      if (i < models.length - 1) continue;
      throw e;
    }
    let txt = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    // Model reasoning (mis. Nemotron) kadang mengosongkan "content" dan menaruh
    // jawabannya di kolom "reasoning" — fallback ke situ sebelum menyatakan kosong.
    if (typeof txt !== 'string' || !txt.trim()) {
      txt = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.reasoning) || '';
    }
    if (typeof txt !== 'string' || !txt.trim()) {
      lastErr = new Error(`${a.name} (${model}): respons kosong`);
      if (i < models.length - 1) continue;
      throw lastErr;
    }
    txt = txt.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); // model reasoning: buang blok pikiran
    if (!txt) {
      lastErr = new Error(`${a.name} (${model}): respons kosong`);
      if (i < models.length - 1) continue;
      throw lastErr;
    }
    return txt.trim();
  }
  throw lastErr || new Error(`${a.name}: semua model cadangan gagal`);
}

/* ================= API bersama ================= */
async function aiCall({ prompt, imageB64, mimeType, timeoutMs = 45000, maxTokens = 2048 }) {
  const a = active();
  if (!a) throw new Error('Belum ada API key AI — isi GEMINI_API_KEY (Gemini) atau AI_API_KEY (Groq/DeepSeek/OpenRouter) di Pengaturan.');
  if (a.kind === 'gemini') {
    const parts = [{ text: prompt }];
    if (imageB64) parts.push({ inline_data: { mime_type: mimeType || 'image/jpeg', data: imageB64 } });
    return geminiCall(parts, { timeoutMs, maxTokens });
  }
  return compatCall({ prompt, imageB64, mimeType, timeoutMs, maxTokens });
}

function parseJsonLoose(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

/* Analisis screenshot bukti follow saluran WhatsApp. */
async function analyzeFollowScreenshot(imageB64, channelLink) {
  const prompt =
    'Kamu adalah verifier keanggotaan saluran WhatsApp untuk bot Telegram.\n' +
    `Tautan saluran: ${channelLink}\n` +
    'Tugas: periksa screenshot ini dan putuskan apakah terlihat JELAS bahwa pengguna sudah menekan tombol Follow/Bergabung (atau statusnya sudah menjadi follower) di saluran WhatsApp tersebut.\n' +
    'Ciri positif: tombol "Follow"/"Joined"/"Mengikuti" terlihat sudah ditekan, banner/nama saluran WhatsApp terlihat, jumlah follower terlihat.\n' +
    'Ciri negatif: screenshot tidak berhubungan dengan saluran, tombol belum ditekan, gambar burik yang tidak bisa dinilai dianggap negatif.\n' +
    'Balas HANYA JSON tanpa teks lain: {"following": true|false, "confidence": 0-100, "reason": "alasan singkat dalam bahasa Indonesia"}';
  const text = await aiCall({ prompt, imageB64, maxTokens: 300, timeoutMs: 45000 });
  const j = parseJsonLoose(text);
  return {
    following: !!j.following,
    confidence: Math.max(0, Math.min(100, Number(j.confidence) || 0)),
    reason: String(j.reason || ''),
  };
}

/* Generator fitur baru untuk bot (dipakai web admin). */
async function generateFeature(description) {
  const prompt =
    'Tulis SATU plugin fitur untuk bot Telegram YowisBen (Node.js 18+, CommonJS).\n\n' +
    '== KONTRAK PLUGIN (WAJIB dipatuhi persis) ==\n' +
    'File plugin harus mengekspor objek:\n' +
    'module.exports = {\n' +
    '  name: "Nama Fitur (bahasa Indonesia, menarik)",\n' +
    '  slug: "slug_perintah",   // lowercase_underscore, 3-20 char, unik, menjadi perintah /slug\n' +
    '  description: "Deskripsi singkat 1-2 kalimat",\n' +
    '  usage: "/slug <cara pakai>",\n' +
    '  run: async (ctx) => { ... }\n' +
    '}\n\n' +
    'Objek ctx di dalam run(ctx):\n' +
    '- ctx.from   -> { id, first_name, username }\n' +
    '- ctx.chat   -> { id, type }\n' +
    '- ctx.text   -> teks pesan penuh\n' +
    '- ctx.args   -> array argumen setelah perintah\n' +
    '- ctx.reply(text, extra?)          -> balas teks biasa\n' +
    '- ctx.replyWithHTML(html, extra?)  -> balas HTML (tag: <b> <i> <code> <pre> <a href>)\n' +
    '- ctx.sendTyping()                 -> indikator "sedang mengetik"\n' +
    '- ctx.fetch(url, options?)         -> fetch global Node 18 (untuk API publik gratis)\n' +
    '- ctx.env                          -> process.env\n\n' +
    'ATURAN KERAS:\n' +
    '1. Hindari require; jika benar-benar perlu, hanya modul bawaan node: (contoh require("node:https")).\n' +
    '2. DILARANG pakai fs, eval, child_process, atau menulis file.\n' +
    '3. Semua jalur kode WAJIB diakhiri ctx.reply / ctx.replyWithHTML (jangan balas kosong).\n' +
    '4. Bungkus fetch dalam try/catch dan beri pesan error ramah bahasa Indonesia.\n' +
    '5. Maksimal 3 emoji, gaya santai profesional.\n' +
    '6. Kode berdiri sendiri, langsung jalan, tanpa variabel di luar module.exports.\n\n' +
    '== PERMINTAAN ADMIN ==\n' +
    `"${String(description).replace(/"/g, "'").slice(0, 600)}"\n\n` +
    'Balas HANYA JSON valid tanpa penjelasan lain, format:\n' +
    '{"name":"...","slug":"...","description":"...","usage":"...","code":"..."}\n' +
    'Di dalam "code", baris baru ditulis \\n dan semua quote di-escape dengan benar.';
  const text = await (async () => {
    try {
      return await aiCall({ prompt, maxTokens: 3500, timeoutMs: 90000 });
    } catch (e) {
      // sekali retry — model gratis kadang sibuk/kosong sesaat
      return aiCall({ prompt: prompt + '\n\n(PENTING: balas HANYA JSON valid satu baris, tanpa teks lain.)', maxTokens: 3500, timeoutMs: 90000 });
    }
  })();
  const j = parseJsonLoose(text);
  const slug = String(j.slug || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(slug)) throw new Error('Slug plugin tidak valid: ' + slug);
  if (typeof j.code !== 'string' || j.code.length < 30) throw new Error('Kode plugin kosong');
  if (!j.code.includes('module.exports')) throw new Error('Kode plugin tidak mengekspor module.exports');
  return {
    name: String(j.name || slug).slice(0, 60),
    slug,
    description: String(j.description || '').slice(0, 200),
    usage: String(j.usage || `/${slug}`).slice(0, 100),
    code: j.code,
  };
}

/* Generator website premium satu file (dipakai perintah /buatweb di bot).
 * Output: HTML lengkap (inline CSS/JS, boleh CDN untuk 3D/animasi).
 * Anti-truncation: auto-retry versi lebih ringkas bila keluaran terpotong. */
async function generateWebsite(description, _retry = true) {
  const base =
    'Kamu adalah web developer senior pembuat situs premium satu halaman.\n' +
    'TUGAS: tulis SATU file HTML lengkap sesuai permintaan di bawah.\n\n' +
    'WAJIB:\n' +
    '- Satu file mandiri: <!DOCTYPE html> ... </html>, semua CSS/JS inline atau via CDN resmi (unpkg/cdnjs/jsdelivr).\n' +
    '- Responsive (mobile-first), font menarik (system font stack atau Google Fonts).\n' +
    '- Visual premium: animasi halus, transisi, gradient/glassmorphism yang enak dilihat.\n' +
    '- Jika diminta 3D: pakai three.js via CDN (objek 3D berputar / partikel bintang, interaktif dengan mouse/touch).\n' +
    '- Jika diminta animasi teks/gravitasi/motion: implementasikan sungguhan (canvas/CSS/JS requestAnimationFrame) — bukan sekadar narasi.\n' +
    '- Jika diminta video: sisipkan <video> atau embed YouTube dengan tombol putar yang elegan.\n' +
    '- Konten nyata sesuai permintaan (bukan Lorem ipsum), bahasa Indonesia, copywriting menarik.\n' +
    '- Tanpa placeholder kosong, tanpa komentar "TODO", tanpa link sosmed palsu (jika tidak diberi, pakai href="#" saja).\n' +
    '- Penting: keluaran harus UTUH sampai </html> — kendalikan panjang kode (±400-600 baris cukup), hindari pengulangan.\n\n' +
    `PERMINTAAN USER:\n"${String(description).slice(0, 1500)}"\n\n` +
    'Balas HANYA kode HTML mentah (tanpa penjelasan, tanpa blok kode ```).';
  const prompt = _retry ? base : base + '\n\nCATATAN: Versi sebelumnya terpotong. Buat LEBIH RINGKAS (maks ±350 baris) tetapi tetap lengkap sampai </html>.';
  const text = await aiCall({ prompt, maxTokens: 16000, timeoutMs: 240000 });
  let html = String(text);
  // buang sapaan/penjelasan sebelum <!DOCTYPE html> (kadang model reasoning menulis pembuka)
  const idx = html.search(/<!doctype html|<html[\s>]/i);
  if (idx > 0) html = html.slice(idx);
  html = html.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    if (_retry) return generateWebsite(description, false); // sekali retry versi ringkas
    throw new Error('Hasil website dari AI tidak lengkap (tag <html> tidak tertutup) — coba lagi, atau ceraikan permintaan menjadi lebih sederhana.');
  }
  return { html };
}

module.exports = { available, visionAvailable, providerInfo, analyzeFollowScreenshot, generateFeature, generateWebsite };
