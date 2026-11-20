'use strict';
/* Klien Netlify API: buat situs + deploy zip (untuk fitur deploy website bot). */
const API = 'https://api.netlify.com/api/v1';

function token() { return (process.env.NETLIFY_TOKEN || '').trim(); }
function available() { return token().length > 10; }

async function req(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    signal: AbortSignal.timeout(opts.timeoutMs || 30000),
    headers: { Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* biarkan null */ }
  if (!res.ok) {
    const msg = (data && data.message) || String(text).slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(`Netlify ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function createSite(name) {
  return req('/sites', {
    method: 'POST',
    timeoutMs: 30000,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

async function deployZip(siteId, zipBuf) {
  const res = await fetch(`${API}/sites/${siteId}/deploys`, {
    method: 'POST',
    signal: AbortSignal.timeout(180000),
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/zip' },
    body: zipBuf,
  });
  const text = await res.text();
  const data = (() => { try { return JSON.parse(text); } catch { return {}; } })();
  if (!res.ok) {
    const msg = data.message || (res.status === 401 ? 'token tidak valid/expired' : 'gagal mengunggah zip');
    throw new Error(`Netlify deploy ${res.status}: ${msg}`);
  }
  return data;
}

async function deleteSite(siteId) { return req(`/sites/${siteId}`, { method: 'DELETE', timeoutMs: 30000 }); }

async function getDeploy(deployId) { return req(`/deploys/${deployId}`); }

async function waitReady(deployId, { timeoutMs = 120000, intervalMs = 3000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = await getDeploy(deployId);
    if (d.state === 'ready') return d;
    if (d.state === 'error') throw new Error('Deploy Netlify error: ' + (d.error_message || 'tidak diketahui'));
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timeout menunggu deploy Netlify siap');
}

/* Verifikasi anti-gimmick: URL benar-benar menyajikan konten sebelum diklaim live. */
async function verifyLive(url, { tries = 3, delayMs = 4000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
      if (res.ok) {
        const body = (await res.text()).slice(0, 2000);
        if (body.trim()) return true;
      }
    } catch { /* coba lagi */ }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

module.exports = { available, createSite, deployZip, waitReady, getDeploy, verifyLive, deleteSite };
