'use strict';
/* Wrapper yt-dlp: probe info + unduh video/audio dengan batas ukuran
 * (Bot API Telegram: unduh 20 MB, unggah 50 MB — kita jaga di bawah 45 MB). */
const { spawn } = require('child_process');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_FILESIZE = '48M';

function bin() { return process.env.YTDLP_PATH || 'yt-dlp'; }

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(bin(), args, { cwd: os.tmpdir() });
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e.message) });
    }
    let out = '', err = '';
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* sudah mati */ } }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (out.length > 100000) out = out.slice(-50000); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 100000) err = err.slice(-50000); });
    p.on('close', (code, sig) => { clearTimeout(t); resolve({ code, sig, out, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message) }); });
  });
}

function cleanErr(e) {
  const lines = String(e || '').split('\n').filter((l) => l.trim() && !l.startsWith('['));
  const line = lines.pop() || String(e || '').split('\n').filter(Boolean).pop() || '';
  return line.replace(/^ERROR:\s*/, '').slice(0, 300);
}

/* TikTok sering memblokir ekstraksi yt-dlp di IP server ("Unexpected response
 * from webpage request") — fallback nyata: API publik tikwm.com (tanpa watermark). */
function isTikTok(url) { return /(?:https?:\/\/)?(?:vm|vt|www|\w)?\.?tiktok\.com\//i.test(url) || /tiktok\.com/i.test(url); }

async function tikwmInfo(url) {
  const res = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' },
    signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({ url }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j || j.code !== 0 || !j.data) {
    const msg = j && j.msg ? String(j.msg) : `HTTP ${res.status}`;
    throw new Error(`TikTok (fallback): ${msg}`);
  }
  const d = j.data;
  return {
    title: String(d.title || 'video tiktok').slice(0, 120),
    duration: Number(d.duration) || 0,
    extractor: 'tiktok',
    uploader: String((d.author && (d.author.unique_id || d.author.nickname)) || '').slice(0, 60),
    playUrl: d.hdplay || d.play || d.wmplay || '',
  };
}

/* Unduh file langsung (dipakai fallback TikTok) — streaming ke disk, ada batas ukuran. */
async function downloadDirect(url, dir, filename, { referer = '' } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', ...(referer ? { Referer: referer } : {}) },
    signal: AbortSignal.timeout(4 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`Unduhan langsung gagal (HTTP ${res.status})`);
  const cl = Number(res.headers.get('content-length') || 0);
  if (cl > 48 * 1024 * 1024) throw new Error('Videonya lebih besar dari batas kirim Telegram (±45 MB). Coba tautan lain.');
  if (!res.body) throw new Error('Respon unduhan kosong dari server sumber.');
  const file = path.join(dir, filename);
  const out = fs.createWriteStream(file);
  // fetch Node mengembalikan web ReadableStream — konversi ke stream Node dulu
  await new Promise((resolve, reject) => {
    Readable.fromWeb(res.body).pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
  const size = fs.statSync(file).size;
  if (size > 48 * 1024 * 1024) { fs.rmSync(file, { force: true }); throw new Error('Videonya lebih besar dari batas kirim Telegram (±45 MB).'); }
  if (size < 8192) throw new Error('File hasil unduhan tidak valid (terlalu kecil) — coba lagi.');
  return file;
}

/* Ambil metadata video (judul, durasi, sumber). */
async function probe(url) {
  let ytErr = null;
  try {
    const r = await run(['-J', '--no-playlist', '--no-warnings', '--skip-download', url], 45000);
    if (r.code === 0) {
      const j = JSON.parse(r.out);
      return {
        title: String(j.title || 'video').slice(0, 120),
        duration: Number(j.duration) || 0,
        extractor: String(j.extractor || '').split(':')[0],
        uploader: String(j.uploader || j.channel || '').slice(0, 60),
      };
    }
    ytErr = new Error(cleanErr(r.err) || 'Gagal membaca info video dari tautan tersebut.');
  } catch (e) { ytErr = e; }
  if (isTikTok(url)) {
    const info = await tikwmInfo(url); // fallback nyata; biarkan error-nya naik kalau gagal
    return { title: info.title, duration: info.duration, extractor: info.extractor, uploader: info.uploader };
  }
  throw ytErr;
}

/* Unduh ke folder sementara, kembalikan path file hasil. */
async function download(url, { audio = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  const outTpl = path.join(dir, '%(title).80s.%(ext)s');
  const args = [
    '--no-playlist', '--no-warnings', '--no-progress', '--restrict-filenames',
    '--max-filesize', MAX_FILESIZE,
    '-o', outTpl,
  ];
  if (audio) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5');
  } else {
    args.push('-f', `bv*[filesize<${MAX_FILESIZE}]+ba/b[filesize<${MAX_FILESIZE}]/b[filesize<${MAX_FILESIZE}]`,
      '--merge-output-format', 'mp4');
  }
  args.push('--print', 'after_move:filepath', url);
  const r = await run(args, 5 * 60 * 1000);
  let file = r.out.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('[')).pop();
  if (!file || !fs.existsSync(file)) {
    const files = fs.readdirSync(dir).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).size > 0);
    if (files.length) file = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  }
  if (!file || !fs.existsSync(file)) {
    const tooBig = /larger than max-filesize|maximum file size/i.test(r.err);
    if (!tooBig && !/Private video|login|cookies|Sign in/i.test(r.err) && isTikTok(url)) {
      // fallback TikTok via tikwm (yt-dlp diblok di IP server)
      try {
        const info = await tikwmInfo(url);
        if (audio) throw new Error('Audio TikTok sementara tidak tersedia via fallback — coba video utuh dulu.');
        const dl = await downloadDirect(info.playUrl, dir, 'tiktok.mp4', { referer: 'https://www.tikwm.com/' });
        return { file: dl, dir, isAudio: false };
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error(`${cleanErr(r.err) || 'TikTok gagal via yt-dlp'} | ${e.message}`);
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
    if (tooBig) throw new Error('Videonya lebih besar dari batas kirim Telegram (sekitar 45 MB). Coba tautan versi ringkas atau klip lain.');
    if (/Private video|login|cookies|Sign in/i.test(r.err)) throw new Error('Konten ini butuh login/private — bot tidak bisa mengunduhnya. Coba tautan publik.');
    throw new Error(cleanErr(r.err) || 'Gagal mengunduh. Pastikan tautan publik dan didukung yt-dlp (TikTok, Instagram, YouTube, Facebook, X, dll).');
  }
  return { file, dir, isAudio: audio };
}

module.exports = { probe, download, bin, isTikTok };
