// A SMALL PIPE, IN MINIATURE. Not a test: imported by the tests that need a console on a slow link.
//
// WHY. Churches run on small pipes (reference/DOMAIN.md, 2026-11-11): a self-hosted box on home broadband,
// members on weak mobile data. On localhost a socket drains as fast as the relay can write, so the relay's
// MAX_WS_BUFFER (scripts/gateway.mjs, "1009 too slow") can never fill and a console that re-downloads its whole
// church a dozen times per connect looks fine. Put this between the browser and the gateway and it does not.
//
// WHAT IT DOES. A plain TCP forwarder on a free 127.0.0.1 port. A connection whose first bytes are a WebSocket
// upgrade has its relay->browser direction metered to `rate` bytes/second (a token bucket; the upstream socket
// is PAUSED while more than `hwm` bytes wait, so the backlog sits in the relay's own buffer — exactly where it
// sits on a real slow link, and exactly what the relay's bufferedAmount check measures). Every other connection
// (the page, the bundle, /status) passes at full speed, so only the relay socket is slow.
//
// WHAT IT KEEPS, per WebSocket connection: wire bytes each way (compressed — what the pipe carries), the number
// of complete server->browser data messages, and the close code of any close frame the RELAY sent (parsed off
// the wire, so it is the relay's own 1009 and not something the browser inferred).
//
// `target` may be given later (api.target = port): the relay signs its identity only for an address it
// DECLARES (RELAY_PUBLIC_URL), so it has to be told this proxy's address before it starts.
//
// dropAll() destroys every live connection at once — a forced drop the console must reconnect from.
// close() ends everything and frees the port; nothing is left behind (no interval outlives it).
import { createServer, connect } from 'node:net';

export async function startSlowLink({ target, rate = 400 * 1024, hwm = 64 * 1024, tickMs = 25 } = {}) {
  const conns = [];          // every connection ever made, newest last
  const live = new Set();
  let n = 0;
  const server = createServer((client) => {
    const c = { id: ++n, ws: null, opened: Date.now(), closed: 0, down: 0, up: 0, msgs: 0, closeCodes: [], sockets: [client] };
    conns.push(c); live.add(c);
    const up = connect(api.target, '127.0.0.1');
    c.sockets.push(up);
    client.setNoDelay(true); up.setNoDelay(true);
    let q = [], qb = 0, budget = 0, timer = null;
    // server->browser WebSocket frame parser: only to count messages and read a close code.
    let hdrDone = false, hbuf = Buffer.alloc(0), fbuf = Buffer.alloc(0), skip = 0, closeLeft = -1, closeBuf = [];
    const parse = (chunk) => {
      let b = chunk;
      if (!hdrDone) {
        hbuf = Buffer.concat([hbuf, b]);
        const i = hbuf.indexOf('\r\n\r\n'); if (i < 0) return;
        hdrDone = true; b = hbuf.subarray(i + 4); hbuf = null;
      }
      while (b.length) {
        if (skip > 0) {
          const k = Math.min(skip, b.length);
          if (closeLeft >= 0) closeBuf.push(b.subarray(0, k));
          skip -= k; b = b.subarray(k);
          if (skip === 0 && closeLeft >= 0) { const p = Buffer.concat(closeBuf); c.closeCodes.push(p.length >= 2 ? p.readUInt16BE(0) : 1005); closeLeft = -1; closeBuf = []; }
          continue;
        }
        fbuf = Buffer.concat([fbuf, b]); b = Buffer.alloc(0);
        if (fbuf.length < 2) return;
        const fin = fbuf[0] & 0x80, op = fbuf[0] & 0x0f; let len = fbuf[1] & 0x7f, h = 2;
        if (len === 126) { if (fbuf.length < 4) return; len = fbuf.readUInt16BE(2); h = 4; }
        else if (len === 127) { if (fbuf.length < 10) return; len = Number(fbuf.readBigUInt64BE(2)); h = 10; }
        if (fin && (op === 0 || op === 1 || op === 2)) c.msgs++;
        if (op === 8) { closeLeft = len; if (len === 0) { c.closeCodes.push(1005); closeLeft = -1; } }
        const rest = fbuf.subarray(h); fbuf = Buffer.alloc(0);
        skip = len; b = rest;
        if (skip === 0) continue;
      }
    };
    const pump = () => {
      budget = Math.min(budget + api.rate * tickMs / 1000, Math.max(api.rate * tickMs / 1000, 16 * 1024));
      while (q.length && budget > 0) {
        let ch = q[0];
        if (ch.length > budget) { const k = Math.max(1, Math.floor(budget)); q[0] = ch.subarray(k); ch = ch.subarray(0, k); } else q.shift();
        budget -= ch.length; qb -= ch.length;
        c.down += ch.length; api.lastDown = Date.now(); parse(ch);
        if (!client.destroyed) client.write(ch);
      }
      if (qb < hwm && up.isPaused()) up.resume();
      if (!q.length && timer) { clearInterval(timer); timer = null; }
    };
    let first = true;
    client.on('data', (d) => {
      if (first) { first = false; c.ws = /^upgrade:\s*websocket/im.test(d.toString('latin1', 0, Math.min(d.length, 4096))); }
      c.up += d.length; up.write(d);
    });
    up.on('data', (d) => {
      if (!c.ws) { c.down += d.length; client.write(d); return; }
      q.push(d); qb += d.length;
      if (qb >= hwm) up.pause();
      if (!timer) { timer = setInterval(pump, tickMs); timer.unref?.(); }
    });
    const end = () => {
      if (c.closed) return; c.closed = Date.now(); live.delete(c);
      if (timer) { clearInterval(timer); timer = null; }
      q = []; qb = 0;
      client.destroy(); up.destroy();
    };
    client.on('error', end); up.on('error', end); client.on('close', end);
    // the relay closing: let what is already metered drain first, as a real pipe would
    up.on('close', () => { const wait = () => { if (!qb || client.destroyed) end(); else setTimeout(wait, 50).unref?.(); }; wait(); });
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const api = {
    port: server.address().port,
    target,   // may be set after start: the relay must be told the proxy's address before it boots
    rate,
    conns,
    wsConns: () => conns.filter(c => c.ws),
    setRate(r) { api.rate = r; },
    dropAll() { const k = live.size; for (const c of [...live]) for (const s of c.sockets) s.destroy(); return k; },
    close() { api.dropAll(); return new Promise(r => server.close(() => r())); },
  };
  return api;
}
