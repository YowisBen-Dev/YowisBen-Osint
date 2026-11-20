'use strict';
/* Scanner keamanan website — pemindaian konfigurasi PASIF & RINGAN yang benar-benar
 * dijalankan (bukan simulasi): HTTPS, header keamanan, flag cookie, kebocoran file
 * sensitif (.env, .git, phpinfo, backup). Maksimal ±10 request ringan ke target.
 *
 * Batasan jujur (anti-gimmick): ini pemeriksaan konfigurasi dasar, BUKAN pentest
 * penuh — tidak ada tool yang bisa menjamin "100% kerentanan ditemukan".
 * Gunakan hanya pada situs milik sendiri atau yang punya izin tertulis.
 */

const PROBES = [
  { path: '/.env', crit: true, label: 'File .env (kredensial/database) terekspos publik', sniff: (t) => (/^[A-Za-z_]+=/.test(t) && !/<html/i.test(t)) || /APP_KEY|DB_PASSWORD|API_SECRET/i.test(t) },
  { path: '/.git/HEAD', crit: true, label: 'Folder .git terekspos (kode sumber & riwayat bisa diunduh)', sniff: (t) => /^ref:/i.test(t.trim()) },
  { path: '/phpinfo.php', crit: true, label: 'phpinfo.php terekspos (bocorkan konfigurasi server)', sniff: (t) => /phpinfo\(\)|PHP Version/i.test(t) },
  { path: '/backup.zip', crit: true, label: 'Arsip backup.zip terekspos publik', zip: true },
  { path: '/.DS_Store', crit: false, label: '.DS_Store terekspos (memetakan struktur folder)', bin: true },
];

async function fetchLimited(url, { timeoutMs = 10000, redirect = 'follow' } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect });
  const text = (await res.text()).slice(0, 4000);
  return { res, text };
}

/* Jalankan scan penuh. onProgress(label) dipanggil tiap tahap untuk update real-time.
 * Melempar Error bila target tak terjangkau. Hasil: daftar temuan + skor. */
async function scan(rawUrl, { onProgress = () => {} } = {}) {
  let url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) throw new Error('URL tidak valid');

  const findings = [];
  let pass = 0, total = 0;
  const push = (mark, msg, sev) => { findings.push([mark, msg, sev]); total++; if (sev === 'ok') pass++; };

  onProgress('Tahap 1/2: mengambil halaman & header…');
  const { res, text } = await fetchLimited(url, { timeoutMs: 20000 });
  const h = res.headers;

  const okHttps = /^https:/i.test(url) && res.ok;
  push(okHttps ? '✅' : '🚨', okHttps ? 'HTTPS aktif & halaman merespons' : `HTTPS tidak aktif / halaman tidak respons (HTTP ${res.status})`, okHttps ? 'ok' : 'kritis');
  push(h.get('strict-transport-security') ? '✅' : '⚠️', h.get('strict-transport-security') ? 'HSTS aktif' : 'HSTS tidak ada — bisa dijebak downgrade ke HTTP', h.get('strict-transport-security') ? 'ok' : 'penting');
  const csp = h.get('content-security-policy');
  push(csp ? '✅' : '⚠️', csp ? 'Content-Security-Policy ada' : 'CSP tidak ada — injeksi skrip (XSS) lebih mudah', csp ? 'ok' : 'penting');
  const click = h.get('x-frame-options') || (csp && /frame-ancestors/i.test(csp));
  push(click ? '✅' : '⚠️', click ? 'Proteksi clickjacking ada' : 'Tidak ada proteksi clickjacking', click ? 'ok' : 'penting');
  push(h.get('x-content-type-options') ? '✅' : '⚠️', h.get('x-content-type-options') ? 'X-Content-Type-Options: nosniff aktif' : 'X-Content-Type-Options tidak ada — risiko MIME sniffing', h.get('x-content-type-options') ? 'ok' : 'penting');
  push(h.get('referrer-policy') ? '✅' : '⚠️', h.get('referrer-policy') ? 'Referrer-Policy ada' : 'Referrer-Policy tidak ada', h.get('referrer-policy') ? 'ok' : 'penting');
  const server = h.get('server') || '';
  push(/\d+\.\d+/.test(server) ? '⚠️' : '✅', /\d+\.\d+/.test(server) ? `Versi server terpamer: ${server.slice(0, 40)} — memudahkan pencarian CVE` : 'Versi server tidak terpamer', /\d+\.\d+/.test(server) ? 'penting' : 'ok');
  const cookie = h.get('set-cookie');
  if (cookie) {
    const miss = [];
    if (!/secure/i.test(cookie)) miss.push('Secure');
    if (!/httponly/i.test(cookie)) miss.push('HttpOnly');
    if (!/samesite/i.test(cookie)) miss.push('SameSite');
    push(miss.length ? '⚠️' : '✅', miss.length ? `Cookie tanpa flag keamanan: ${miss.join(', ')}` : 'Cookie lengkap (Secure + HttpOnly + SameSite)', miss.length ? 'penting' : 'ok');
  } else {
    push('ℹ️', 'Tidak ada cookie pada respons awal', 'info');
  }
  if (!h.get('permissions-policy')) push('ℹ️', 'Permissions-Policy tidak diatur (opsional)', 'info');

  onProgress('Tahap 2/2: memeriksa kebocoran file sensitif…');
  for (const probe of PROBES) {
    try {
      const { res: r, text: t } = await fetchLimited(url.replace(/\/+$/, '') + probe.path, { redirect: 'manual' });
      const hit = r.status === 200 && (probe.zip
        ? (/^PK/.test(t) || /zip|octet-stream/i.test(r.headers.get('content-type') || ''))
        : probe.bin
          ? (/Bud1/.test(t) || /octet-stream/i.test(r.headers.get('content-type') || ''))
          : probe.sniff(t));
      if (hit) push('🚨', `${probe.label} → ${probe.path}`, 'kritis');
      else push('✅', `${probe.path} tidak terekspos`, 'ok');
    } catch {
      push('✅', `${probe.path} tidak terekspos`, 'ok');
    }
    onProgress(`Memeriksa ${probe.path}…`);
  }

  const krit = findings.filter((f) => f[2] === 'kritis').length;
  const penting = findings.filter((f) => f[2] === 'penting').length;
  return { url, findings, pass, total, krit, penting };
}

module.exports = { scan };
