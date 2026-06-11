#!/usr/bin/env node
// TrinityOne Relay app — v0.7.0 runnable core (the launcher the Tauri shell will wrap).
// Boots the church relay (scripts/gateway.mjs), checks reachability (Tailscale Funnel / direct),
// and prints the URLs a steward needs: their console, the member join base, and the relay status.
// No code to write — a steward runs the OS double-click wrapper which calls this.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { exec } from 'child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');                 // repo root (gateway lives in ROOT/scripts)
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

const line = (s = '') => process.stdout.write(s + '\n');
const sh = (cmd) => new Promise(res => exec(cmd, { timeout: 6000 }, (e, out) => res(e ? '' : String(out || ''))));

function churchNames() {
  try {
    const cj = JSON.parse(readFileSync(join(ROOT, 'relay', 'church.json'), 'utf8'));
    const list = cj.churches || (cj.npub ? [cj] : []);
    return list.map(c => c.name || (c.npub || '').slice(0, 16) + '…');
  } catch { return []; }
}

// resolve how members reach this relay: a Tailscale Funnel if one is up, else the LAN/local address.
async function publicBase() {
  const fs = await sh('tailscale funnel status 2>/dev/null');
  const m = fs.match(/https:\/\/[\w.-]+\.ts\.net/);
  if (m) return { url: m[0], how: 'Tailscale Funnel' };
  // fall back to a LAN address (members on the same wifi) or localhost
  const ip = (await sh("hostname -I 2>/dev/null")).trim().split(/\s+/)[0] || '';
  if (ip) return { url: `http://${ip}:${PORT}`, how: 'LAN (same wifi only)' };
  return { url: `http://localhost:${PORT}`, how: 'this computer only' };
}

line('\n  TrinityOne — Relay app  ·  v0.7.0\n  ' + '─'.repeat(40));
const names = churchNames();
line('  Serving: ' + (names.length ? names.join(', ') : 'no church configured yet — set one in the Steward console'));
line('  Starting the relay…');

const gw = spawn(process.execPath, [join(ROOT, 'scripts', 'gateway.mjs'), String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
gw.stdout.on('data', d => process.stdout.write('  [relay] ' + d));
gw.stderr.on('data', d => process.stderr.write('  [relay] ' + d));

// open a URL in the OS default browser (the GUI control dashboard)
function openInBrowser(u) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${u}"`, () => {});
}

// once it's listening, print the reachability summary + open the control dashboard
setTimeout(async () => {
  const { url, how } = await publicBase();
  const wss = url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/relay';
  const control = `http://localhost:${PORT}/relay-app/control.html?public=${encodeURIComponent(url)}`;
  line('\n  ✓ Relay running.  Reachability: ' + how);
  line('  ─'.repeat(40));
  line('  Control panel   : ' + control);
  line('  Steward console : ' + url + '/steward.html');
  line('  Member relay    : ' + wss);
  line('  Members join via the invite QR you share from the console.');
  if (how !== 'Tailscale Funnel') line('\n  ⚠  Not publicly reachable yet. To let members join from anywhere,\n     turn on a tunnel (Tailscale Funnel or Cloudflare) — the packaged app will do this for you.');
  line('  ─'.repeat(40));
  line('  Opening the control panel in your browser…');
  line('  Leave this running. Close the window to stop the relay.\n');
  if (!process.env.RELAY_NO_OPEN) openInBrowser(control);
}, 1500);

const stop = () => { try { gw.kill('SIGTERM'); } catch {} process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
gw.on('exit', code => { line('  Relay stopped (' + code + ').'); process.exit(code || 0); });
