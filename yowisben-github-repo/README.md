# YowisBen Dev — Bot Telegram + Web Admin Controller

Satu service Railway berisi dua bagian yang saling mengendalikan:

1. **Bot Telegram** (@YowisBen_bot) dengan alur verifikasi saluran WhatsApp berbasis AI, plus fitur:
   - **Deploy APK** — kirim `.zip` proyek Flutter lengkap → bot build APK release asli → kirim file APK + info (nama, package, versi, ukuran, waktu build). Kirim `.zip` website / `.html` → jadi **APK WebView** asli (aapt+d8+apksigner, ±30 detik, ter-sign keystore server).
   - **Deploy Website** — kirim `.html` atau `.zip` + minta nama subdomain → live di `https://<subdomain>.netlify.app` — URL **diverifikasi benar-benar online** sebelum diklaim sukses.
   - **Download Video All Sosmed** — kirim tautan (TikTok, Instagram, YouTube, Facebook, X, dsb) → otomatis diunduh dan dikirim; `/audio <link>` untuk MP3. **TikTok punya fallback anti-blokir** (API publik tikwm) karena yt-dlp sering diblok TikTok di IP server.
   - **Buat Website dengan AI** (`/buatweb`) — tulis permintaan bebas (3D, animasi teks, efek gravitasi partikel, motion, video) → AI menulis situs premium satu file → kasih nama subdomain → langsung live di Netlify.
   - **OSINT** (`/osint phone|ip|user|whois`) — data publik resmi: metadata nomor + operator Indonesia, geolokasi jaringan IP (koordinat + Google Maps), cek akun di 7 platform, WHOIS RDAP domain. **Jujur: lokasi fisik seseorang realtime (semacam Pegasus) tidak mungkin & ilegal — bot tidak memalsukannya.**
   - **Scan Kerentanan Website** (`/scan <url>`) — pemeriksaan sungguhan: HTTPS, HSTS/CSP/clickjacking, flag cookie, versi server, kebocoran `.env`/`.git`/phpinfo/backup — laporan real-time per tahap dengan skor jujur (bukan angka palsu).
2. **Web Admin Controller** — panel dengan login password, animasi penuh, dan kendali **start / restart / stop** proses bot secara realtime, log streaming, daftar pengguna terverifikasi, serta **generator fitur AI**: jelaskan fitur yang diinginkan dalam bahasa bebas → AI menulis plugin → aktifkan → langsung jadi perintah baru di bot tanpa deploy ulang.

## Cara Deploy ke Railway (5 langkah)

1. Deploy pakai **zip terbaru** (`yowisben-admin-panel.zip`) — versi lama punya bug: `.env` tidak ikut ke image (lihat bagian Troubleshooting di bawah). Ekstrak, push ke GitHub atau `railway up`.
2. Di Railway: **New Project → Deploy from GitHub repo** — Railway otomatis memakai `Dockerfile` (builder DOCKERFILE dari `railway.json`). Build pertama agak lama (10–20 menit) karena image memuat Flutter SDK + Android SDK + yt-dlp; itu wajar dan hanya sekali.
3. Pilih salah satu cara mengisi token:
   - **Paling mudah — dari panel**: setelah deploy selesai, login ke web controller → halaman **Pengaturan** → isi token di sana → **Simpan & Restart Bot**. BOT_TOKEN dicek langsung ke Telegram sebelum disimpan. Tidak perlu buka dashboard Railway.
   - **Cara klasik**: set **Variables** di Railway (lihat tabel di bawah). Variables dashboard selalu menimpa nilai `.env`.
4. Deploy selesai → buka domain Railway (mis. `https://xxx.up.railway.app`) → login pakai `ADMIN_PASSWORD`.
5. Di panel, tekan **Start** (atau biarkan `BOT_AUTOSTART=true` menyalakan bot sendiri). Bot langsung online — kalau gagal, panel menampilkan banner merah berisi penyebab persisnya + tombol lompat ke Pengaturan.

> **RAM**: build APK Flutter butuh memori besar. Set resource service minimal **2 GB** (disarankan 4 GB) di Railway untuk fitur deploy APK. Web + bot biasa cukup di 512 MB–1 GB.

### Variabel Environment

| Variabel | Isi | Keterangan |
| --- | --- | --- |
| `BOT_TOKEN` | token @BotFather | sudah terisi di `.env` proyek ini |
| `ADMIN_ID` | `7596781256` | Telegram ID admin (perintah `/stats` di bot) |
| `ADMIN_PASSWORD` | `YowisBen2026` | **ganti** password login web ini |
| `GEMINI_API_KEY` | key Google AI Studio (format `AIza...`) | verifikasi screenshot + generator fitur |
| `AI_API_KEY` | key Groq `gsk_...` (GRATIS) / DeepSeek `sk-...` / OpenRouter `sk-or-...` | **alternatif tanpa Gemini** — provider terdeteksi otomatis dari awalan key |
| `AI_PROVIDER` | `groq` / `deepseek` / `openrouter` / `custom` | opsional; kosong = deteksi otomatis |
| `AI_TEXT_MODEL` / `AI_VISION_MODEL` | mis. `llama-3.3-70b-versatile` | opsional override model per provider |
| `NETLIFY_TOKEN` | token Netlify | deploy website ke subdomain |
| `WA_CHANNEL_LINK` | link saluran WhatsApp | syarat verifikasi user |
| `BOT_AUTOSTART` | `true` | bot menyala otomatis saat service hidup |
| `GEMINI_MODEL` | `gemini-2.5-flash` | opsional; klien otomatis mencoba model pengganti (2.0-flash / saran API) |

## Troubleshooting: "Bot berhenti" / tombol Start tidak bereaksi

Gejala: toast "Perintah start dikirim" muncul, tapi badge tetap **Bot berhenti** dan bot tidak merespon `/start` di Telegram. Penyebab hampir selalu: **proses bot mati seketika saat menyala**. Buka halaman **Log Realtime** di panel — penyebabnya tertulis di sana, dan dashboard kini menampilkan **banner merah diagnosis**.

| Pesan di banner/log | Penyebab | Solusi |
| --- | --- | --- |
| `BOT_TOKEN kosong — bot tidak bisa jalan` | token belum sampai ke server (deploy dari GitHub tanpa `.env`, atau Variables belum diisi/redeploy) | **buka halaman Pengaturan di panel → isi BOT_TOKEN → Simpan & Restart Bot** (paling cepat), atau isi Variables di Railway |
| `Gemini: API key not valid (401)` | key bukan API key AI Studio (mis. format `AQ.Ab8R...`) | buat key di **aistudio.google.com/apikey** (berawalan `AIza`), atau pakai Groq gratis lewat `AI_API_KEY` (`gsk_...`), lalu Restart |
| `Provider … tidak mendukung analisis gambar` | AI_API_KEY memakai DeepSeek (API-nya teks saja) | pakai `AI_API_KEY` Groq (`gsk_...`) atau Gemini untuk verifikasi screenshot, atau verifikasi manual `/verif <id>` |
| `Polling terhenti: 409 Conflict` | ada dua proses bot yang jalan bersamaan (mis. Railway + komputer lokal) | matikan salah satunya, tekan Restart |
| `Gagal start bot: 401 Unauthorized` | token bot salah/dicabut | regenerate token di @BotFather, update `BOT_TOKEN`, Restart |

Error konfigurasi (BOT_TOKEN kosong) **tidak** di-restart otomatis — percuma restart terus; perbaiki dulu, lalu tekan Start/Restart. Verifikasi AI yang bermasalah otomatis mengirim peringatan + langkah perbaikan ke chat admin, dan admin bisa memverifikasi user manual: `/verif <telegram_id_user>` (cabut: `/unverif <id>`).

## Cara Pakai Bot

1. User kirim `/start` → bot meminta **follow saluran WhatsApp** (tombol tersedia) → kirim **screenshot bukti**. Pengecualian: **ID admin (`ADMIN_ID`, 7596781256) otomatis lolos tanpa verifikasi apa pun** — hanya pengguna lain yang wajib follow + screenshot.
2. AI menganalisis screenshot (±5 detik; Gemini vision atau Groq Llama-4 vision). Lolos → semua fitur terbuka, admin dapat notifikasi. Gagal → boleh ulangi sampai 5x.
3. Menu utama (tombol inline): **Deploy APK**, **Deploy Website**, **Download Video**, **Buat Website AI**, **OSINT**, **Scan Website**, **Fitur AI** (plugin buatan AI ikut digabung sebagai tombol ⚡), **Bantuan**.
4. Perintah: `/deployapk` `/deployweb` `/buatweb` `/osint phone|ip|user|whois` `/scan <url>` `/audio <link>` `/fitur` `/cancel` `/help`; khusus admin: `/stats`, `/verif <id>`, `/unverif <id>`.

## Web Admin Controller

- **Dashboard** — status proses (cincin LIVE/OFF), uptime, statistik (pengguna terdaftar/terverifikasi, APK, website, website AI, broadcast, unduhan, plugin).
- **Kontrol Bot** — tombol Start / Restart / Stop dengan konfirmasi; auto-restart 5x jika proses bot mati tiba-tiba (bisa dimatikan lewat `BOT_AUTOSTART=false`).
- **Fitur & Plugin** — daftar plugin dengan saklar aktif/nonaktif dan hapus. Tombol **Buat Fitur Baru** menjalankan generator AI; hasil kode ditampilkan dulu (bisa dirancang ulang) baru diaktifkan → bot *hot-reload* tanpa deploy.
- **Broadcast** — siaran pesan ke **semua** pengguna yang pernah menyapa bot (tercatat otomatis di `data/users.json`), dikirim bertahap aman dari rate-limit, progres & rekap tampil di log.
- **Log Realtime** — stream SSE, filter level, unduh `.txt`.
- **Pengaturan** — isi/perbarui semua variabel (BOT_TOKEN, ADMIN_ID, GEMINI_API_KEY, AI_API_KEY, NETLIFY_TOKEN, dll) langsung dari panel; nilai ditulis ke `.env` + server dan bot di-restart otomatis. BOT_TOKEN divalidasi via `getMe` Telegram sebelum disimpan.
- **Pengguna** — semua pengguna + status verifikasi + terakhir aktif.

## Engine AI: multi-provider (anti-gimmick)

- **Gemini** (Google AI Studio) — vision + teks. Key `AIza...` dari aistudio.google.com/apikey.
- **Groq (gratis, paling mudah)** — konsol console.groq.com/keys → key `gsk_...` → isi `AI_API_KEY` di Pengaturan. Vision: Llama-4 Scout (verifikasi screenshot), teks: Llama-3.3 70B (generator fitur).
- **DeepSeek** — platform.deepseek.com, key `sk-...`. Teks saja: **tidak mendukung analisis gambar**, jadi verifikasi screenshot tetap butuh Gemini/Groq atau `/verif` manual.
- **OpenRouter** — openrouter.ai/keys, key `sk-or-...`. Bawaan terverifikasi Nov 2026: teks `nvidia/nemotron-3-ultra-550b-a55b:free`, vision `nvidia/nemotron-3.5-super-vl:free`. **Hindari model `google/*` di OpenRouter — Google menolak lokasi Indonesia ("User location is not supported").**
- **Fallback model otomatis** — model gratis sering flaky/rate-limit; kalau model utama kosong/404/429, klien otomatis mencoba model cadangan (bisa dioverride via `AI_FALLBACK_MODELS`, dipisah koma). Respons kosong dari model reasoning (kolom `reasoning`) juga ditangani.
- Provider dipilih otomatis dari awalan key (`gsk_`→Groq, `sk-or-`→OpenRouter, `sk-`→DeepSeek) atau dipaksa lewat `AI_PROVIDER`. Model bisa dioverride via `AI_TEXT_MODEL` / `AI_VISION_MODEL`.
- **Anti-gimmick**: generator fitur selalu menampilkan engine yang benar-benar dipakai (Groq/Gemini/DeepSeek/…). Tanpa key AI sama sekali, hasil ditandai `template offline` dengan penjelasan — tidak ada yang pura-pura jadi AI. Verifikasi screenshot tidak pernah lolos palsu.

## Batasan yang jujur perlu diketahui

- **20 MB** batas unduhan file oleh Bot API Telegram (zip proyek/situs), **50 MB** batas unggah — unduhan video dibatasi ±45 MB otomatis.
- Build APK butuh **5–15 menit** per proyek dan RAM memadai; proyek Flutter harus utuh (`pubspec.yaml` + folder `android/`).
- Netlify: subdomain yang sudah dipakai otomatis diberi akhiran acak; kuota akun Netlify berlaku.
- Beberapa konten sosmed yang privat/ber-login tidak bisa diunduh (mesin: yt-dlp; bisa diperbarui lewat `pip install -U yt-dlp` di Dockerfile).

## Struktur Proyek

```
├── Dockerfile              # Node 20 + Flutter 3.24 + Android SDK 34 + JDK17 + yt-dlp + ffmpeg
├── railway.json            # builder DOCKERFILE + healthcheck /health
├── src/
│   ├── index.js            # Express + process manager bot (start/stop/restart, SSE log, broadcast API)
│   ├── bot/worker.js       # seluruh logika bot (verifikasi, fitur, sesi, broadcast, registry user)
│   ├── bot/pluginLoader.js # muat/validasi plugin
│   ├── ai/gemini.js        # klien AI multi-provider (fallback model; vision + teks; generator fitur & website)
│   ├── ai/templates.js     # engine template offline
│   ├── services/netlify.js # API Netlify (buat situs + deploy zip + verifikasi live)
│   ├── services/ytdlp.js   # wrapper yt-dlp + fallback TikTok (tikwm)
│   ├── services/webapk.js  # builder APK WebView (aapt + javac + d8 + zipalign + apksigner)
│   ├── services/osint.js   # OSINT data publik (phone/IP/user/whois)
│   └── services/webscan.js # scanner keamanan website (header + kebocoran file)
├── plugins/                # plugin contoh: ping, sapa, quote, kalkulator (bisa jadi contoh AI)
├── public/                 # web admin (HTML/CSS/JS murni, animasi penuh)
└── data/                   # runtime (dibuat otomatis; jangan di-commit)
```

## Menjalankan Lokal (opsional)

```bash
npm install
cp .env.example .env   # isi sesuai kebutuhan
node src/index.js      # buka http://localhost:3000
```

Untuk mencoba panel tanpa menyambung Telegram: `MOCK_BOT=1 node src/index.js` (bot simulasi + data contoh).

## Keamanan

- `.env` berisi token asli milik pemilik proyek — **jangan pernah di-push ke repo publik**.
- Karena token sempat ditempel di percakapan, sangat disarankan **regenerate token** via @BotFather (`/revoke`) dan mengganti `ADMIN_PASSWORD` sebelum dipakai luas.
- Web admin dilindungi cookie HttpOnly + rate limit login; hanya satu akun admin (password).
