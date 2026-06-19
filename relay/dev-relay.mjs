// dev-relay.mjs — small Nostr relay (NIP-01) for TrinityOne self-hosting on ONE machine.
// Binds to the LAN (0.0.0.0) so phones on the same wifi connect, and persists events to disk so
// chat + user-data survive a restart. Run: node relay/dev-relay.mjs
// (a hardened Khatru/NIP-29 relay -- bundled in the church Relay app -- is the production upgrade;
//  see reference/proposal-relay-app-steward-console.md)
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, renameSync } from 'fs';

const PORT = Number(process.env.RELAY_PORT || 7447);
const HOST = process.env.RELAY_HOST || '0.0.0.0';                  // LAN-reachable (was 127.0.0.1)
const DB = new URL('./relay-db.json', import.meta.url).pathname;  // gitignored on-disk event log
const MAX_EVENTS = 20000;
let events = [];                   // event log (loaded from disk, capped)
const subs = new Map();            // ws -> Map(subId -> filters[])

try { const d = JSON.parse(readFileSync(DB, 'utf8')); if (Array.isArray(d)) events = d.slice(-MAX_EVENTS); } catch { /* fresh */ }
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { const tmp = DB + '.tmp'; writeFileSync(tmp, JSON.stringify(events)); renameSync(tmp, DB); }
    catch (e) { console.warn('[relay] save failed:', e.message); }
  }, 1500);
}

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

const wss = new WebSocketServer({ port: PORT, host: HOST });
wss.on('connection', ws => {
  subs.set(ws, new Map());
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const [type, ...rest] = msg;

    if (type === 'EVENT') {
      const evt = rest[0];
      if (!evt || !evt.id) return;
      events.push(evt); if (events.length > MAX_EVENTS) events.shift();
      scheduleSave();
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
console.log(`TrinityOne relay listening on ws://${HOST}:${PORT}  (persisted to ${DB}, max ${MAX_EVENTS}, ${events.length} loaded)`);
