'use strict';
/* OSINT — pengolahan DATA PUBLIK RESMI saja:
 *   phone : metadata nomor (negara/tipe/operator by prefix) via libphonenumber-js
 *   ip    : geolokasi jaringan publik via ip-api.com (gratis)
 *   user  : cek keberadaan akun publik di 7 platform
 *   whois : data domain resmi via RDAP (rdap.org)
 *
 * Batasan jujur (anti-gimmick): melacak lokasi FISIK seseorang secara realtime
 * semacam Pegasus tidak mungkin lewat API publik dan ilegal — fitur ini tidak
 * memalsukannya. Yang ditampilkan adalah data publik yang benar-benar diambil.
 */
const { parsePhoneNumberFromString } = require('libphonenumber-js');

const NOTE =
  '\n\n🧭 <i>OSINT YowisBen hanya mengolah data publik resmi. Melacak lokasi fisik seseorang secara realtime (semacam Pegasus) tidak mungkin lewat API publik dan melanggar hukum — bot ini tidak akan memalsukannya. Data di atas diambil langsung dari sumber publik.</i>';

const ID_OPERATORS = [
  ['Telkomsel (simPATI / Kartu As / Halo)', ['811', '812', '813', '821', '822', '823', '851', '852', '853']],
  ['XL Axiata', ['817', '818', '819', '859', '877', '878']],
  ['Indosat IM3', ['814', '815', '816', '855', '856', '857', '858']],
  ['Indosat Tri (3)', ['895', '896', '897', '898', '899']],
  ['Smartfren', ['881', '882', '883', '884', '885', '886', '887', '888', '889']],
  ['AXIS', ['831', '832', '833', '838']],
];

async function osintPhone(val) {
  const p = parsePhoneNumberFromString(val, 'ID');
  if (!p || !p.isValid()) return { error: `<b>${esc(String(val))}</b> bukan nomor telepon yang valid. Contoh benar: <code>081234567890</code> atau <code>+6281234567890</code>.` };
  const nat = String(p.nationalNumber);
  let operator = '-';
  if (p.country === 'ID') {
    const hit = ID_OPERATORS.find(([, arr]) => arr.includes(nat.slice(0, 3)));
    if (hit) operator = hit[0];
  }
  const TIPE = { MOBILE: 'Seluler (mobile)', FIXED_LINE: 'Telepon rumah', FIXED_LINE_OR_MOBILE: 'Rumah/seluler', TOLL_FREE: 'Bebas pulsa', PREMIUM_RATE: 'Premium', VOIP: 'VoIP', PERSONAL_NUMBER: 'Personal', PAGER: 'Pager', UAN: 'Universal access', VOICEMAIL: 'Voicemail', SHARED_COST: 'Shared cost' };
  let tipe = TIPE[p.getType()] || p.getType() || '';
  if (p.country === 'ID' && !tipe && nat.startsWith('8')) tipe = 'Seluler (mobile)'; // prefix 8xx Indonesia pasti seluler
  tipe = tipe || '-';
  return { html:
    '🧠 <b>OSINT Nomor Telepon</b> (metadata publik resmi)\n\n' +
    `• Nomor: <code>${esc(p.formatInternational())}</code>\n` +
    `• Format lokal: <code>${esc(p.formatNational())}</code>\n` +
    `• Negara: ${esc(p.country || '-')} 🌍\n` +
    `• Tipe: ${esc(tipe)}\n` +
    (p.country === 'ID' ? `• Operator (berdasarkan prefix): <b>${esc(operator)}</b>\n  <i>Catatan: bisa berubah karena portabilitas nomor.</i>\n` : '') +
    `• Valid: ✅ ya` + NOTE };
}

async function osintIp(val) {
  val = String(val).trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(val) && !/^[0-9a-fA-F:]{4,45}$/.test(val)) {
    return { error: 'Format IP tidak dikenal. Contoh: <code>/osint ip 8.8.8.8</code>' };
  }
  const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(val)}?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,reverse,mobile,proxy,hosting,query`, { signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (j.status !== 'success') return { error: `Data IP tidak ditemukan: ${esc(j.message || 'respon tidak valid')}` };
  return { html:
    '🧠 <b>OSINT Alamat IP</b> (geolokasi jaringan publik)\n\n' +
    `• IP: <code>${esc(j.query)}</code>\n` +
    `• Negara: ${esc(j.country || '-')} (${esc(j.countryCode || '-')})\n` +
    `• Wilayah: ${esc(j.regionName || '-')}\n` +
    `• Kota: ${esc(j.city || '-')}${j.zip ? ` (${esc(j.zip)})` : ''}\n` +
    `• Koordinat jaringan: ${j.lat}, ${j.lon} 📍\n` +
    `  <a href="https://www.google.com/maps?q=${j.lat},${j.lon}">🗺️ Buka di Google Maps</a>\n` +
    `• Zona waktu: ${esc(j.timezone || '-')}\n` +
    `• ISP: <b>${esc(j.isp || '-')}</b>\n` +
    `• Organisasi: ${esc(j.org || '-')}\n` +
    `• ASN: ${esc(j.as || '-')}\n` +
    (j.reverse ? `• Hostname balik: <code>${esc(j.reverse)}</code>\n` : '') +
    `• Klasifikasi: ${[j.mobile ? '📱 seluler' : '', j.proxy ? '🕶️ proxy/VPN' : '', j.hosting ? '🖥️ hosting/datacenter' : ''].filter(Boolean).join(', ') || 'rumah/kantor biasa'}` +
    `\n  <i>Koordinat ini milik jaringan/ISP, bukan posisi fisik pemilik perangkat.</i>` + NOTE };
}

async function osintUser(u) {
  u = String(u).replace(/^@/, '').trim();
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(u)) return { error: 'Username tidak valid (2–32 karakter: huruf, angka, titik, garis).' };
  const enc = encodeURIComponent(u);
  const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) YowisBenOSINT/1.0' };
  const checks = [
    { name: 'GitHub', fn: async () => { const r = await fetch(`https://api.github.com/users/${enc}`, { signal: AbortSignal.timeout(10000), headers: UA }); return r.status === 200 ? 'yes' : r.status === 404 ? 'no' : '?'; } },
    { name: 'TikTok', fn: async () => { const r = await fetch(`https://www.tiktok.com/@${enc}`, { signal: AbortSignal.timeout(10000), headers: UA }); return r.status === 200 ? 'yes' : r.status === 404 ? 'no' : '?'; } },
    { name: 'Telegram', fn: async () => { const r = await fetch(`https://t.me/${enc}`, { signal: AbortSignal.timeout(10000), headers: UA }); const t = await r.text(); return r.status === 200 && t.includes('tgme_page_title') ? 'yes' : 'no'; } },
    { name: 'Medium', fn: async () => { const r = await fetch(`https://medium.com/@${enc}`, { signal: AbortSignal.timeout(10000), headers: UA }); return r.status === 200 ? 'yes' : r.status === 404 ? 'no' : '?'; } },
    { name: 'Pinterest', fn: async () => { const r = await fetch(`https://www.pinterest.com/${enc}/`, { signal: AbortSignal.timeout(10000), headers: UA }); return r.status === 200 ? 'yes' : r.status === 404 ? 'no' : '?'; } },
    { name: 'Steam', fn: async () => { const r = await fetch(`https://steamcommunity.com/id/${enc}`, { signal: AbortSignal.timeout(10000), headers: UA }); const t = await r.text(); return t.includes('The specified profile could not be found') ? 'no' : r.status === 200 ? 'yes' : '?'; } },
    { name: 'Reddit', fn: async () => { const r = await fetch(`https://www.reddit.com/user/${enc}/about.json`, { signal: AbortSignal.timeout(10000), headers: UA }); return r.status === 200 ? 'yes' : r.status === 404 ? 'no' : '?'; } },
  ];
  const rs = await Promise.allSettled(checks.map((c) => c.fn()));
  const MARK = { yes: '✅ terdaftar', no: '❌ tidak ada', '?': '❓ tidak pasti (dibatasi platform)' };
  const lines = checks.map((c, i) => `• ${c.name}: ${rs[i].status === 'fulfilled' ? MARK[rs[i].value] || MARK['?'] : MARK['?']}`);
  return { html: `🧠 <b>OSINT Username "@${esc(u)}"</b> (cek keberadaan akun publik)\n\n${lines.join('\n')}` + NOTE };
}

async function osintWhois(dom) {
  dom = String(dom).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dom)) return { error: 'Domain tidak valid. Contoh: <code>/osint whois example.com</code>' };
  const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(dom)}`, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/rdap+json', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) YowisBenOSINT/1.0' }, redirect: 'follow' });
  if (res.status === 404) return { error: `${esc(dom)} tidak ditemukan di registry RDAP (belum terdaftar / TLD tidak menyediakan RDAP).` + NOTE };
  const j = await res.json().catch(() => null);
  if (!j) return { error: `Data RDAP ${esc(dom)} tidak terbaca (HTTP ${res.status}).` };
  const ev = (t) => { const e = (j.events || []).find((x) => x.eventAction === t); return e ? String(e.eventDate).slice(0, 10) : '-'; };
  let registrar = '-';
  const reg = (j.entities || []).find((x) => (x.roles || []).includes('registrar'));
  if (reg && reg.vcardArray) {
    const fn = (reg.vcardArray[1] || []).find((v) => v[0] === 'fn');
    if (fn) registrar = String(fn[3]);
  }
  const ns = (j.nameservers || []).map((n) => n.ldhName).filter(Boolean).slice(0, 6);
  return { html:
    `🧠 <b>OSINT WHOIS "${esc(dom)}"</b> (data RDAP resmi registry)\n\n` +
    `• Registrar: <b>${esc(registrar)}</b>\n` +
    `• Terdaftar sejak: ${esc(ev('registration'))}\n` +
    `• Kedaluwarsa: ${esc(ev('expiration'))}\n` +
    `• Terakhir diubah: ${esc(ev('last changed'))}\n` +
    `• Status: ${esc((j.status || []).join(', ') || '-')}\n` +
    (ns.length ? `• Nameserver: ${esc(ns.join(', '))}\n` : '') + NOTE };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { osintPhone, osintIp, osintUser, osintWhois, NOTE };
