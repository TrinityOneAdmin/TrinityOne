// PROBE (not a test): does the locked-boot wipe fire on the TIMEOUT path, in the real APK WebView?
//
// Usage:  node scripts/locked-boot-wipe.probe.mjs          # locked + hung identity -> MUST wipe at ~20s
//         node scripts/locked-boot-wipe.probe.mjs --unlocked   # an ordinary boot   -> MUST NOT wipe
//
// Attach first (see scripts/cdp.probe.mjs for the full recipe):
//   source scripts/android-env.sh
//   PID=$(adb -s <SERIAL> shell pidof com.trinityone.app | tr -d '\r')
//   adb -s <SERIAL> forward tcp:9222 localabstract:webview_devtools_remote_$PID
//
// Measured on the Oppo, member APK 214 from 8064692, 2026-09-15: locked run wiped at 22s; unlocked run
// did not wipe in 41s. Both halves of item 7 on one rig, with no PIN set and no key material touched.
//
// The effect in app/app.jsx keys on commLocked and waits for TrinityIdentity.settled, with a 20s budget
// after which it wipes anyway ("we could not find out" is not "the phone is unlocked"). The suite covers
// this by lifting the effect. This drives it in the shipped WebView instead.
//
// It sets NO PIN and touches no key material: it overrides TrinityIdentity.isLocked() to say "locked" and
// pins .settled to false, both installed BEFORE any page script runs. The app then believes it booted
// locked with an identity module that never answers — which is the exact shape the timeout exists for.
import { WebSocket } from 'ws';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
if (!page) { console.error('no page found'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});
await new Promise(r => ws.on('open', r));

const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
  return r.result.value;
};

const UNLOCKED = process.argv.includes('--unlocked');

const HOOK = `
const FORCE_LOCK = ${UNLOCKED ? 'false' : 'true'};
(() => {
  window.__wipe = { installed: Date.now(), calls: [], sawID: false, sawF: false };
  let _id;
  Object.defineProperty(window, 'TrinityIdentity', {
    configurable: true,
    get() { return _id; },
    set(v) {
      _id = v;
      if (v && !window.__wipe.sawID) {
        window.__wipe.sawID = true;
        if (FORCE_LOCK) {
          try { v.isLocked = () => true; } catch (e) {}
          try { Object.defineProperty(v, 'settled', { configurable: true, get: () => false, set: () => {} }); } catch (e) {}
        }
      }
    }
  });
  let _f;
  Object.defineProperty(window, 'Fellowship', {
    configurable: true,
    get() { return _f; },
    set(v) {
      _f = v;
      if (v && !window.__wipe.sawF) {
        window.__wipe.sawF = true;
        const wrap = () => {
          const orig = v.clearCommunityCache;
          if (typeof orig !== 'function' || orig.__wrapped) return false;
          const spy = function (...a) { window.__wipe.calls.push(Date.now() - window.__wipe.installed); return orig.apply(this, a); };
          spy.__wrapped = true;
          try { v.clearCommunityCache = spy; return true; } catch (e) { return false; }
        };
        if (!wrap()) { const t = setInterval(() => { if (wrap()) clearInterval(t); }, 50); setTimeout(() => clearInterval(t), 15000); }
      }
    }
  });
})();
`;

await send('Page.enable');
const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
await send('Page.reload', { ignoreCache: false });

process.stdout.write(UNLOCKED
  ? 'ordinary boot — nothing should wipe\n'
  : 'booting with a hung, "locked" identity — the budget is 20s\n');
let last = null;
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 1500));
  try {
    last = await evalIn(`JSON.stringify({ t: window.__wipe ? Date.now() - window.__wipe.installed : null, sawID: !!(window.__wipe||{}).sawID, sawF: !!(window.__wipe||{}).sawF, calls: (window.__wipe||{}).calls || [], locked: !!(window.TrinityIdentity && window.TrinityIdentity.isLocked && window.TrinityIdentity.isLocked()), settled: (window.TrinityIdentity||{}).settled })`);
    const o = JSON.parse(last);
    process.stdout.write(`  t=${Math.round((o.t||0)/1000)}s  identity=${o.sawID?'hooked':'-'} fellowship=${o.sawF?'hooked':'-'} locked=${o.locked} settled=${o.settled} wipes=${o.calls.length}\n`);
    if (o.calls.length) {
      process.stdout.write(`\n${UNLOCKED ? '✖ WIPED' : '✓ WIPED'} at ${Math.round(o.calls[0]/1000)}s after boot`
        + (UNLOCKED ? ' — A PHONE THAT NEVER LOCKED LOST ITS CHURCH CACHES. This is item 7 back.\n' : ' — the timeout path fired in the real WebView.\n'));
      break;
    }
    if ((o.t || 0) > (UNLOCKED ? 40000 : 45000)) {
      process.stdout.write(UNLOCKED ? '\n✓ NO WIPE — an ordinary boot kept its caches.\n' : '\n✖ NO WIPE within 45s — a locked phone KEPT every congregation cache.\n');
      break;
    }
  } catch (e) { process.stdout.write('  (page still reloading)\n'); }
}

// put the app back to normal: remove the hook and reload clean
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
await send('Page.reload', { ignoreCache: false });
process.stdout.write('hook removed, app reloaded clean\n');
ws.close();
