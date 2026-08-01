// A controllable bad link, sat between a client and a relay. Import it; don't reimplement it.
//
// WHY THIS EXISTS. Every test on the console's write path so far has used a LOCAL relay on loopback: either
// perfectly healthy or hard-killed. Real deployments are neither. The question this product is built around is
// "does this work over a thin pipe in Tehran", and the honest answer has never been measured — only the two
// extremes have. The failures that actually cost a church its safeguarding records live in between: a link
// that is slow enough for timeouts to fire, a socket that stalls rather than closes, a relay that comes and
// goes every few minutes, one relay blocked and one reachable.
//
// WHAT IT SIMULATES, and what it deliberately does not. This is a TCP shim, so it models what a bad link
// actually presents to an application:
//
//   • latency + jitter   — the dominant effect on a 2G/satellite/Tor path
//   • bandwidth ceiling  — bytes per second, which is what makes a 500-member back-fill hurt
//   • connection churn   — the relay or the path going away mid-session (every a8 deploy does this)
//   • BLACKHOLE          — accept the TCP connection and then say nothing, for ever. This is the DPI /
//                          half-open-NAT case, and it is the one that hangs code rather than failing it.
//                          It has already produced one real defect on this branch.
//   • REFUSE             — nothing listening, connection refused (a blocked relay)
//
// It does NOT drop individual packets. TCP retransmits, so byte-level loss on a stream would corrupt WebSocket
// framing rather than simulate a lossy link — it would test the wrong thing and produce confident nonsense.
// Loss presents to the app as latency and stalls, which is what the knobs above produce.
import { createServer, connect } from 'node:net';

export function badLink({ port, upstreamPort, latencyMs = 0, jitterMs = 0, bytesPerSec = 0, mode = 'pass' }) {
  const socks = new Set();
  let cfg = { latencyMs, jitterMs, bytesPerSec, mode };
  const wait = () => cfg.latencyMs + (cfg.jitterMs ? Math.floor(Math.random() * cfg.jitterMs) : 0);
  const stats = { conns: 0, bytesUp: 0, bytesDown: 0 };

  // Bytes are released on a timer rather than piped, so latency and a bandwidth ceiling can both apply. A
  // simple queue per direction keeps ordering, which a naive setTimeout-per-chunk would not.
  const pump = (from, to, count) => {
    const q = [];
    let sending = false;
    const drain = () => {
      if (sending || !q.length) return;
      sending = true;
      const chunk = q.shift();
      const byteDelay = cfg.bytesPerSec ? (chunk.length / cfg.bytesPerSec) * 1000 : 0;
      setTimeout(() => {
        sending = false;
        if (!to.destroyed) { to.write(chunk); stats[count] += chunk.length; }
        drain();
      }, wait() + byteDelay);
    };
    from.on('data', (c) => { if (cfg.mode === 'blackhole') return; q.push(c); drain(); });
  };

  const srv = createServer((client) => {
    stats.conns++;
    socks.add(client);
    client.on('close', () => socks.delete(client));
    client.on('error', () => {});
    if (cfg.mode === 'refuse') { client.destroy(); return; }
    // BLACKHOLE: accept, then never speak and never close. The socket looks alive to the client for ever.
    if (cfg.mode === 'blackhole') return;

    const up = connect({ host: '127.0.0.1', port: upstreamPort });
    socks.add(up);
    up.on('error', () => { try { client.destroy(); } catch {} });
    up.on('close', () => { socks.delete(up); try { client.destroy(); } catch {} });
    client.on('close', () => { try { up.destroy(); } catch {} });
    pump(client, up, 'bytesUp');
    pump(up, client, 'bytesDown');
  });

  return {
    stats,
    listen: () => new Promise(r => srv.listen(port, '127.0.0.1', r)),
    set: (patch) => { cfg = { ...cfg, ...patch }; },
    // Cut every live connection — what a relay restart or a NAT timeout looks like from the app's side.
    cut: () => { for (const s of socks) { try { s.destroy(); } catch {} } socks.clear(); },
    // server.close() WAITS on open sockets, so destroy them first or the caller hangs. Learned the hard way.
    close: async () => { for (const s of socks) { try { s.destroy(); } catch {} } socks.clear(); await new Promise(r => srv.close(r)); },
  };
}

// Named profiles, so scenarios read as conditions rather than numbers.
export const LINKS = {
  fast:      { latencyMs: 5,    jitterMs: 5,   bytesPerSec: 0 },
  dsl:       { latencyMs: 40,   jitterMs: 20,  bytesPerSec: 0 },
  // ~2G/EDGE: the pilot's stated worst realistic case.
  edge2g:    { latencyMs: 400,  jitterMs: 300, bytesPerSec: 20 * 1024 },
  // A congested satellite / heavily shaped path — where the console's own 8s and 6s bounds start to bite.
  satellite: { latencyMs: 900,  jitterMs: 600, bytesPerSec: 8 * 1024 },
  // Deliberately past every internal timeout, to find what the console does when its own bounds fire.
  awful:     { latencyMs: 2500, jitterMs: 1500, bytesPerSec: 4 * 1024 },
};
