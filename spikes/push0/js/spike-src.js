// THROWAWAY Phase-0 spike. Minimal nostr-tools SimplePool exercise, run inside a
// headless WebView hosted by a WorkManager worker. NOT shipped. See spikes/push0/README.md.
//
// Proves P0.2 (bundled nostr-tools SimplePool opens a WebSocket to a real, already-admitted
// church relay and runs ONE since= REQ, reading to EOSE) and the P0.3/F2 probes (is there a
// window.Capacitor bridge at all; did the native layer inject the signing key?).
//
// It reuses the SAME nostr-tools version the member app ships (package.json ^2.23.5), so the
// transport engine under test is the real one, not a re-implementation.

import { SimplePool } from 'nostr-tools/pool';

// Native glue hands results back through this interface (added via addJavascriptInterface).
function report(stage, data) {
  try {
    const line = JSON.stringify({ stage, ...data });
    if (window.SpikeNative && window.SpikeNative.result) window.SpikeNative.result(line);
    // eslint-disable-next-line no-console
    console.log('[SPIKE] ' + line);
  } catch (e) { /* ignore */ }
}

// P0.3 / F2: what did the native worker inject, and is a Capacitor bridge present at all?
window.__spikeInjectedKey = window.__spikeInjectedKey || null;

window.runSpike = async function runSpike(relayUrl) {
  report('boot', {
    hasWebSocket: typeof WebSocket !== 'undefined',
    hasWebCrypto: !!(window.crypto && window.crypto.subtle),
    hasLocalStorage: (function () { try { return typeof localStorage !== 'undefined'; } catch { return false; } })(),
    // F2 probe: a RAW WebView built inside a WorkManager worker is NOT a Capacitor BridgeWebView,
    // so window.Capacitor is expected to be undefined here.
    hasCapacitorBridge: typeof window.Capacitor !== 'undefined',
    capacitorPlugins: (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins)
      ? Object.keys(window.Capacitor.Plugins) : [],
    // P0.3: did native read the Keystore-backed secret and inject it?
    injectedKeyPresent: !!window.__spikeInjectedKey,
    injectedKeyLen: window.__spikeInjectedKey ? String(window.__spikeInjectedKey).length : 0,
  });

  if (typeof WebSocket === 'undefined') {
    report('fatal', { why: 'no WebSocket in this WebView' });
    return;
  }

  const pool = new SimplePool();
  const since = Math.floor(Date.now() / 1000) - 3600; // one since= cursor, last hour
  let events = 0;
  let eosed = false;

  report('req-open', { relay: relayUrl, since });

  await new Promise((resolve) => {
    let done = false;
    const finish = (reason) => {
      if (done) return; done = true;
      try { sub.close(); } catch (e) {}
      try { pool.close([relayUrl]); } catch (e) {}
      report('closed', { reason, events, eosed });
      resolve();
    };
    // subscribeMany: one REQ with a since= filter, read to EOSE. kind 1 is public (ungated).
    const sub = pool.subscribeMany(
      [relayUrl],
      [{ kinds: [1], since, limit: 10 }],
      {
        onevent(ev) { events += 1; if (events <= 3) report('event', { id: ev.id.slice(0, 12), kind: ev.kind }); },
        oneose() { eosed = true; report('eose', { events }); finish('eose'); },
        onclose(reasons) { report('relay-closed', { reasons: String(reasons).slice(0, 200) }); },
      }
    );
    // Safety timeout so the worker cannot hang if the relay never EOSEs.
    setTimeout(() => finish('timeout-12s'), 12000);
  });
};
