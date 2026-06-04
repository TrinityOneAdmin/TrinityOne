// dev-relay.mjs — minimal in-memory Nostr relay (NIP-01) for TrinityOne local dev.
// Private to this machine; not for production. Run: node relay/dev-relay.mjs
// (production uses a hosted Khatru NIP-29 relay — see reference/trinityone-fellowship-spec.md §5)
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.RELAY_PORT || 7447);
const MAX_EVENTS = 5000;
const events = [];                 // in-memory event log
const subs = new Map();            // ws -> Map(subId -> filters[])

function matchFilter(evt, f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;   // a real filter object only
  if (f.ids && !f.ids.includes(evt.id)) return false;
  if (f.authors && !f.authors.includes(evt.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(evt.kind)) return false;
  if (f.since && evt.created_at < f.since) return false;
  if (f.until && evt.created_at > f.until) return false;
  for (const k in f) {
    if (k[0] === '#') {
      const tag = k.slice(1), vals = f[k];
      if (!evt.tags.some(t => t[0] === tag && vals.includes(t[1]))) return false;
    }
  }
  return true;
}
const matchAny = (evt, filters) => filters.some(f => matchFilter(evt, f));

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });
wss.on('connection', ws => {
  subs.set(ws, new Map());
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const [type, ...rest] = msg;

    if (type === 'EVENT') {
      const evt = rest[0];
      if (!evt || !evt.id) return;
      events.push(evt); if (events.length > MAX_EVENTS) events.shift();
      ws.send(JSON.stringify(['OK', evt.id, true, '']));
      for (const [client, m] of subs) {
        if (client.readyState !== 1) continue;
        for (const [subId, filters] of m) if (matchAny(evt, filters)) client.send(JSON.stringify(['EVENT', subId, evt]));
      }
    } else if (type === 'REQ') {
      const subId = rest[0];
      let filters = rest.slice(1);
      // tolerate clients that wrap filters in one array: ["REQ", id, [f1, f2]]
      if (filters.length === 1 && Array.isArray(filters[0])) filters = filters[0];
      subs.get(ws).set(subId, filters);
      let matched = events.filter(e => matchAny(e, filters));
      const lim = Math.max(0, ...filters.map(f => f.limit || 0));
      if (lim) matched = matched.slice(-lim);
      for (const e of matched) ws.send(JSON.stringify(['EVENT', subId, e]));
      ws.send(JSON.stringify(['EOSE', subId]));
    } else if (type === 'CLOSE') {
      subs.get(ws)?.delete(rest[0]);
    }
  });
  ws.on('close', () => subs.delete(ws));
});
console.log(`TrinityOne dev relay listening on ws://127.0.0.1:${PORT}  (events kept in memory, max ${MAX_EVENTS})`);
