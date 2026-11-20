'use strict';
/* Builder APK WebView — bungkus situs (.zip / .html / URL) menjadi APK Android ASLI.
 *
 * Jalur build TANPA Gradle (cepat, ±10-30 detik, hemat RAM container):
 *   1. aapt package      -> kerangka APK + manifest + assets situs
 *   2. javac + d8        -> MainActivity.java -> classes.dex (dalvik)
 *   3. aapt add          -> classes.dex masuk ke APK
 *   4. zipalign + apksigner -> APK ter-sign (keystore server dipakai ulang agar update app aman)
 *
 * Prasyarat (sudah ada di Dockerfile): JDK 17 (keytool/javac), Android build-tools,
 * platform android-34 (android.jar). Semua langkah nyata — tidak ada pemalsuan.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const KS_PASS = 'yowisben2026';
const KS_ALIAS = 'yowisben';

function run(cmd, args, { cwd, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { cwd: cwd || os.tmpdir(), env: { ...process.env } });
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e.message) });
    }
    let out = '', err = '';
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* sudah mati */ } }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (out.length > 60000) out = out.slice(-30000); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 60000) err = err.slice(-30000); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message) }); });
  });
}

function sdkPaths() {
  const base = process.env.ANDROID_HOME || '/opt/android-sdk';
  const btDir = path.join(base, 'build-tools');
  let bt = '';
  if (fs.existsSync(btDir)) {
    const vers = fs.readdirSync(btDir).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort().pop();
    if (vers) bt = path.join(btDir, vers);
  }
  const plDir = path.join(base, 'platforms');
  let jar = '';
  if (fs.existsSync(plDir)) {
    const vers = fs.readdirSync(plDir).filter((v) => /^android-\d+$/.test(v)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).pop();
    if (vers) jar = path.join(plDir, vers, 'android.jar');
  }
  return { bt, jar };
}

function toolMissing({ bt, jar }) {
  if (!bt || !fs.existsSync(path.join(bt, 'aapt'))) return 'Android build-tools tidak ditemukan (set ANDROID_HOME dengan benar di server).';
  if (!jar || !fs.existsSync(jar)) return 'android.jar (platform) tidak ditemukan — pasang platforms;android-34 di server.';
  return null;
}

/* Keystore dipakai ulang antar-build supaya update APK tidak minta uninstall. */
async function ensureKeystore(ksPath) {
  if (fs.existsSync(ksPath)) return null;
  const keytool = path.join(process.env.JAVA_HOME || '', 'bin', 'keytool');
  const cmd = fs.existsSync(keytool) ? keytool : 'keytool';
  const r = await run(cmd, [
    '-genkeypair', '-keystore', ksPath, '-alias', KS_ALIAS,
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', KS_PASS, '-keypass', KS_PASS,
    '-dname', 'CN=YowisBen Dev, OU=YowisBen, O=YowisBen, C=ID',
  ], { timeoutMs: 60000 });
  if (r.code !== 0 || !fs.existsSync(ksPath)) throw new Error('Gagal membuat keystore: ' + (r.err || r.out).slice(-300));
  return ksPath;
}

function sanitizePkg(name) {
  let s = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18) || 'app';
  if (/^[0-9]/.test(s)) s = 'app' + s;
  return s;
}

const MANIFEST = (pkg, label) => `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${pkg}" android:versionCode="1" android:versionName="1.0">
  <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34"/>
  <uses-permission android:name="android.permission.INTERNET"/>
  <application android:label="${label}" android:usesCleartextTraffic="true" android:theme="@android:style/Theme.Material.Light.NoActionBar">
    <activity android:name=".MainActivity" android:exported="true" android:configChanges="orientation|screenSize|keyboardHidden">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
`;

const MAIN_ACTIVITY = (pkg, startUrl) => `package ${pkg};

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView wv;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        wv = new WebView(this);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        wv.setWebViewClient(new WebViewClient());
        setContentView(wv);
        wv.loadUrl("${startUrl}");
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && wv != null && wv.canGoBack()) {
            wv.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
`;

/* Cari index.html di dalam folder hasil ekstraksi (root atau 1 tingkat folder). */
function findIndexHtml(dir, depth = 0) {
  if (depth > 2) return null;
  const direct = path.join(dir, 'index.html');
  if (fs.existsSync(direct)) return dir;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) {
      const r = findIndexHtml(path.join(dir, f.name), depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/* Bangun APK dari folder assets (sudah berisi index.html) atau dari URL remote.
 * siteName: nama tampilan app; assetsDir: folder sumber; remoteUrl: null atau URL. */
async function build({ label, assetsDir, remoteUrl, keystorePath, onStep = () => {} }) {
  const { bt, jar } = sdkPaths();
  const miss = toolMissing({ bt, jar });
  if (miss) throw new Error(miss);
  if (remoteUrl) {
    if (!/^https?:\/\//i.test(remoteUrl)) throw new Error('URL tidak valid.');
  } else if (!assetsDir || !fs.existsSync(path.join(assetsDir, 'index.html'))) {
    throw new Error('index.html tidak ditemukan di dalam arsip — situs minimal butuh satu index.html.');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webapk-'));
  const pkg = 'com.yowisben.' + sanitizePkg(label);
  const startUrl = remoteUrl || 'file:///android_asset/index.html';
  const base = path.join(tmp, 'base.apk');
  const aligned = path.join(tmp, 'aligned.apk');
  const out = path.join(tmp, 'app.apk');
  try {
    onStep('Membuat manifest & kode aplikasi…');
    fs.writeFileSync(path.join(tmp, 'AndroidManifest.xml'), MANIFEST(pkg, String(label).slice(0, 30)));
    fs.writeFileSync(path.join(tmp, 'MainActivity.java'), MAIN_ACTIVITY(pkg, startUrl));

    onStep('Mengemas assets situs ke APK…');
    let r = await run(path.join(bt, 'aapt'), ['package', '-f', '-M', 'AndroidManifest.xml', '-I', jar, '-F', path.basename(base)], { cwd: tmp, timeoutMs: 120000 });
    if (r.code !== 0) throw new Error('aapt package gagal: ' + (r.err || r.out).slice(-400));

    if (!remoteUrl) {
      // daftar file relatif lalu aapt add satu per satu (batasi 400 file)
      const root = assetsDir;
      const rels = [];
      const walk = (d, rel) => {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          const rp = rel ? path.join(rel, f.name) : f.name;
          if (f.isDirectory()) { if (rels.length < 390) walk(path.join(d, f.name), rp); }
          else if (rels.length < 400) rels.push(rp);
        }
      };
      walk(root, '');
      if (!rels.length) throw new Error('Arsip situs kosong — tidak ada file untuk dikemas.');
      for (const rel of rels) {
        // cwd di root assets supaya jalur relatif di dalam APK sesuai struktur situs
        r = await run(path.join(bt, 'aapt'), ['add', base, rel], { cwd: root, timeoutMs: 60000 });
        if (r.code !== 0) throw new Error(`aapt add ${rel} gagal: ` + (r.err || r.out).slice(-300));
      }
    }

    onStep('Mengompilasi & mengonversi ke bytecode Android (d8)…');
    r = await run('javac', ['-source', '1.8', '-target', '1.8', '-bootclasspath', jar, '-classpath', jar, '-d', path.join(tmp, 'classes'), path.join(tmp, 'MainActivity.java')], { cwd: tmp, timeoutMs: 180000 });
    if (r.code !== 0) throw new Error('javac gagal: ' + (r.err || r.out).slice(-400));
    r = await run(path.join(bt, 'd8'), ['--release', '--lib', jar, '--min-api', '21', '--output', tmp, path.join(tmp, 'classes', pkg.replace(/\./g, '/'), 'MainActivity.class')], { cwd: tmp, timeoutMs: 180000 });
    if (r.code !== 0) throw new Error('d8 gagal: ' + (r.err || r.out).slice(-400));
    if (!fs.existsSync(path.join(tmp, 'classes.dex'))) throw new Error('classes.dex tidak dihasilkan d8.');
    r = await run(path.join(bt, 'aapt'), ['add', path.basename(base), 'classes.dex'], { cwd: tmp, timeoutMs: 60000 });
    if (r.code !== 0) throw new Error('aapt add classes.dex gagal: ' + (r.err || r.out).slice(-300));

    onStep('Menyelaraskan (zipalign) & menandatangani APK…');
    r = await run(path.join(bt, 'zipalign'), ['-f', '4', base, aligned], { cwd: tmp, timeoutMs: 120000 });
    if (r.code !== 0) throw new Error('zipalign gagal: ' + (r.err || r.out).slice(-300));
    await ensureKeystore(keystorePath);
    r = await run(path.join(bt, 'apksigner'), ['sign', '--ks', keystorePath, '--ks-key-alias', KS_ALIAS, '--ks-pass', 'pass:' + KS_PASS, '--key-pass', 'pass:' + KS_PASS, '--out', out, aligned], { cwd: tmp, timeoutMs: 120000 });
    if (r.code !== 0) throw new Error('apksigner gagal: ' + (r.err || r.out).slice(-300));
    r = await run(path.join(bt, 'apksigner'), ['verify', out], { cwd: tmp, timeoutMs: 60000 });
    if (r.code !== 0) throw new Error('Verifikasi APK gagal: ' + (r.err || r.out).slice(-300));

    const size = fs.statSync(out).size;
    return { apkPath: out, tmp, size, pkg, label: String(label).slice(0, 30) };
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* biarkan */ }
    throw e;
  }
}

module.exports = { build, sdkPaths, findIndexHtml, sanitizePkg };
