// PUSH SERVICE — PHASE 1 of the "push service" redesign.
//
// A standalone, STATELESS Node HTTP service that holds the Apple .p8 and sends contentless APNs pushes on behalf of
// relays. It exists because the APNs .p8 is an UNSCOPEABLE master key: it cannot be distributed to decentralized /
// self-hosted relays, so ONE key-holder sends on their behalf. (Phase 2 — teaching the relay to forward its push
// seam here — is a SEPARATE change and is NOT built here.)
//
// Run as a server:   node scripts/push-service.mjs       (host/port + APNs config from env — see startFromEnv)
// Tested in:         scripts/push-service.test.mjs       (point-of-use: a mock APNs transport, a real HTTP server)
//
// REUSE (CLAUDE.md #2): the APNs crypto/payload contract is NOT reimplemented here. buildPayload / apnsUrl /
// buildJwt / buildHeaders / loadConfig are imported from scripts/apns-cli-lib.mjs (standalone, no gateway import).
// The §15.2 drift guard in the test deep-equals this service's payload to apns-cli-lib's buildPayload() so the two
// can never diverge. The CONNECTION POOL + PER-SEND TIMEOUT are ported from gateway.mjs's makeApnsSender region
// (the _apnsSessions pool + per-send setTimeout + guarded eviction, committed in f1a2df3c) — equivalent, fully
// guarded, never throwing out of a send.
//
// SECURITY MODEL (per the design audit):
//   * CORE GATE = a HARD per-RECIPIENT-TOKEN rate limit (see RATE LIMIT). This is the load-bearing throttle.
//   * DEFENCE-IN-DEPTH = a relay-IDENTITY-signed NIP-98 envelope (kind 27235) over method+path+sha256(body)+ts.
//     The signature only proves "some keypair signed this" — it is junk-filtering + per-relay attribution, NOT
//     authorization to wake a specific token. The per-identity rate limit below is best-effort and DEFEATABLE by
//     key rotation, so it is explicitly NOT load-bearing.
//   * STATELESS + PRIVACY: no token database. A token lives in-memory only for the instant of the send. The service
//     structurally SEES (relay-identity, token) to verify + send, but NEVER logs or persists it: logs are coarse
//     counts/status only (no token, no pubkey, no .p8 path contents).

import http from 'node:http';
import { createHash } from 'node:crypto';
import { connect as http2Connect } from 'node:http2';
import { pathToFileURL } from 'node:url';
import { verifyEvent } from 'nostr-tools/pure';
import { buildPayload, apnsUrl, buildJwt, buildHeaders, loadConfig } from './apns-cli-lib.mjs';

export const WAKE_PATH = '/wake';
export const NIP98_KIND = 27235;   // NIP-98 HTTP Auth event kind — the relay-identity-signed envelope

// Any body field that would carry sender / church / message / content metadata is forbidden: a /wake carries the
// RECIPIENT TOKEN AND NOTHING ELSE (contentless, communication-graph-free). A request bearing any of these is 400.
const FORBIDDEN_BODY_FIELDS = ['sender', 'from', 'to', 'church', 'churchId', 'group', 'message', 'content', 'body', 'title', 'text', 'aps', 'payload', 'pub', 'pubkey'];

// §15.2 CONTRACT — the contentless payload the service sends. It RETURNS the apns-cli-lib payload unchanged; the
// drift guard deep-equals this to apns-cli-lib's buildPayload(), so adding any content here turns that test red.
export function contentlessPayload() { return buildPayload(); }

function sha256hex(buf) { return createHash('sha256').update(buf).digest('hex'); }

// ── CONNECTION POOL + JWT CACHE + PER-SEND TIMEOUT — ported from gateway.mjs makeApnsSender (f1a2df3c). Each service
// instance owns its OWN pool/counters/log/timeouts (no module-level singletons) so tests are isolated and a server
// restart starts clean. The transport (`connect`) and logger (`log`) are injectable for point-of-use testing.
export function makePooledSender(cfg, {
  connect = http2Connect,
  log = () => {},
  reqTimeoutMs = 8 * 1000,         // per-request deadline — a response must arrive within this or we tear down
  idleTimeoutMs = 5 * 60 * 1000,   // a pooled session with no traffic for this long closes itself
} = {}) {
  const counters = { sent: 0, ok: 0, err: 0, timeout: 0 };
  const sessions = new Map();      // origin => { session, origin }
  let jwt = null, jwtAt = 0;
  const note = (m) => { try { log(m); } catch {} };   // COARSE strings only — never a token, never a pubkey

  // JWT CACHE: Apple rejects a token older than 60 min and rejects regenerating one too often, so reuse past ~50 min.
  function jwtCached(nowMs = Date.now()) {
    if (jwt && (nowMs - jwtAt) < 50 * 60 * 1000) return jwt;
    jwt = buildJwt(cfg.keyPem, cfg.keyId, cfg.teamId, Math.floor(nowMs / 1000));
    jwtAt = nowMs;
    return jwt;
  }

  function dropSession(origin, entry) {
    const cur = sessions.get(origin);
    const e = entry || cur;
    if (!e) return;
    if (cur === e) sessions.delete(origin);   // never evict a newer session than the one that failed
    try { e.session.close(); } catch {}
    try { e.session.destroy && e.session.destroy(); } catch {}
  }

  function getSession(origin) {
    const cached = sessions.get(origin);
    if (cached && !cached.session.destroyed && !cached.session.closed) return cached;   // reuse a live session
    const session = connect(origin);
    const entry = { session, origin };
    sessions.set(origin, entry);
    const drop = () => dropSession(origin, entry);
    session.on('error', () => { counters.err++; note('apns transport error'); drop(); });
    session.on('close', drop);
    session.on('goaway', drop);
    // IDLE SELF-CLOSE: real http2 resets this on every request, so a pooled session only closes after it sits unused.
    // (A mock transport has no setTimeout — the guard skips it.)
    if (typeof session.setTimeout === 'function') { try { session.setTimeout(idleTimeoutMs, drop); } catch {} }
    return entry;
  }

  // ONE contentless HTTP/2 POST over a POOLED session. Fire-and-forget; never throws (every stage guarded, incl. the
  // timeout). It uses the token ONLY as the URL path — no pubkey, no graph metadata on the wire or in the log.
  function send(token, env) {
    const e = env === 'sandbox' ? 'sandbox' : 'production';
    counters.sent++;
    let origin = null, entry = null;
    try {
      const u = new URL(apnsUrl(token, e));
      origin = u.origin;
      const headers = { ':method': 'POST', ':path': u.pathname, ...buildHeaders(jwtCached(), cfg.topic) };
      const body = JSON.stringify(contentlessPayload());
      entry = getSession(origin);
      const req = entry.session.request(headers);
      let status = 0, done = false;
      const timer = setTimeout(() => {
        if (done) return; done = true;
        counters.err++; counters.timeout++; note('apns timeout');
        try { (req.destroy ? req.destroy() : req.close && req.close()); } catch {}
        dropSession(origin, entry);
      }, reqTimeoutMs);
      if (timer && timer.unref) timer.unref();
      const settle = () => { if (done) return false; done = true; try { clearTimeout(timer); } catch {} return true; };
      req.on('error', () => { if (!settle()) return; counters.err++; note('apns request error'); dropSession(origin, entry); });
      req.on('response', (h) => { status = h[':status'] || 0; });
      req.on('data', () => {});   // drain the (ignored) response body so the stream can end
      req.on('end', () => {
        if (!settle()) return;   // POOLED: a clean end leaves the session OPEN for the next recipient.
        if (status === 200) { counters.ok++; note('apns ok'); }
        else { counters.err++; note('apns status ' + status); }   // code only — no token, no pub
      });
      req.end(body);
    } catch { counters.err++; note('apns send failed'); if (origin) dropSession(origin, entry); }
  }

  return { send, counters, sessionCount: () => sessions.size };
}

// ── RATE LIMIT — rolling-window counter. A shared instance tracks BOTH the per-token (core) and per-identity
// (best-effort) limits. On each accepted send we record a timestamp; a key is over-limit when its window already
// holds `limit` stamps. Empty keys are pruned opportunistically so the maps cannot grow without bound. NOTHING here
// is logged and the keys (token / pubkey) never leave this closure.
export function makeRateLimiter({ now = Date.now } = {}) {
  const hits = new Map();   // key => number[] of accept times (ms)
  function prune(key, cutoff) {
    const arr = hits.get(key);
    if (!arr) return [];
    let i = 0; while (i < arr.length && arr[i] <= cutoff) i++;
    const kept = i ? arr.slice(i) : arr;
    if (kept.length) hits.set(key, kept); else hits.delete(key);
    return kept;
  }
  return {
    // Would this key be allowed right now? (does NOT record — call record() on accept)
    allowed(key, limit, windowMs) {
      const t = now();
      return prune(key, t - windowMs).length < limit;
    },
    record(key) {
      const t = now();
      const arr = hits.get(key) || [];
      arr.push(t);
      hits.set(key, arr);
    },
    size: () => hits.size,
  };
}

// Parse the NIP-98 Authorization header: "Nostr <base64(event JSON)>". Returns the event object or null.
function parseAuthEvent(header) {
  if (!header || typeof header !== 'string') return null;
  const m = /^Nostr\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  let json;
  try { json = Buffer.from(m[1], 'base64').toString('utf8'); } catch { return null; }
  try { return JSON.parse(json); } catch { return null; }
}

function tagVal(ev, name) {
  if (!ev || !Array.isArray(ev.tags)) return undefined;
  for (const t of ev.tags) if (Array.isArray(t) && t[0] === name) return t[1];
  return undefined;
}

// VERIFY the signed envelope binds this exact request: valid sig, right kind, method+path match, payload hash matches
// the body bytes, timestamp fresh. Returns { ok:true, pub } or { ok:false }. The HOST is deliberately NOT bound: TLS
// and the public hostname are terminated upstream by the tunnel/DNS, and this signature is defence-in-depth, not the
// core gate — so we bind pathname+method+payload+freshness, which is what the relay can honestly sign.
function verifyEnvelope(ev, { method, path, rawBody, nowSec, freshnessSec }) {
  if (!ev || typeof ev !== 'object') return { ok: false };
  try { if (!verifyEvent(ev)) return { ok: false }; } catch { return { ok: false }; }
  if (ev.kind !== NIP98_KIND) return { ok: false };
  if ((tagVal(ev, 'method') || '').toUpperCase() !== method.toUpperCase()) return { ok: false };
  const u = tagVal(ev, 'u');
  if (!u) return { ok: false };
  let uPath; try { uPath = u.startsWith('/') ? u : new URL(u).pathname; } catch { return { ok: false }; }
  if (uPath !== path) return { ok: false };
  if (tagVal(ev, 'payload') !== sha256hex(rawBody)) return { ok: false };
  const ts = Number(ev.created_at);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > freshnessSec) return { ok: false };
  return { ok: true, pub: ev.pubkey };
}

// ── THE SERVICE. Returns { server, sender, rateLimiter, close() }. The server is created but NOT listening — the
// caller (or a test) calls server.listen(). `cfg` null => every /wake returns 503 (not configured) and the service
// still serves (never crashes).
export function createPushService({
  cfg = null,
  apnsTransport = http2Connect,
  log = () => {},                  // COARSE sink — default silent; startFromEnv wires console.log
  now = Date.now,
  reqTimeoutMs,
  idleTimeoutMs,
  tokenLimit = 3,                  // CORE GATE: max wakes per rolling window PER RECIPIENT TOKEN
  tokenWindowMs = 60 * 1000,
  identityLimit = 200,            // best-effort per relay-identity pubkey (DEFEATABLE by key rotation — not load-bearing)
  identityWindowMs = 60 * 1000,
  freshnessSec = 60,              // signed-envelope timestamp window (±)
  maxBodyBytes = 8 * 1024,
} = {}) {
  const sender = cfg ? makePooledSender(cfg, { connect: apnsTransport, log, reqTimeoutMs, idleTimeoutMs }) : null;
  const rateLimiter = makeRateLimiter({ now });
  const note = (m) => { try { log(m); } catch {} };   // coarse only — never a token/pubkey/path content

  function reply(res, code, text) { try { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(text + '\n'); } catch {} }

  const server = http.createServer((req, res) => {
    // ROUTE: only POST /wake. (Trim any query string — we match the path exactly.)
    const path = (req.url || '').split('?')[0];
    if (req.method !== 'POST' || path !== WAKE_PATH) { reply(res, 404, 'not found'); return; }

    const chunks = []; let total = 0, aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      total += c.length;
      if (total > maxBodyBytes) { aborted = true; note('wake oversize'); reply(res, 400, 'bad request'); try { req.destroy(); } catch {} return; }
      chunks.push(c);
    });
    req.on('error', () => { if (!aborted) { aborted = true; reply(res, 400, 'bad request'); } });
    req.on('end', () => {
      if (aborted) return;
      const rawBody = Buffer.concat(chunks);

      // 1. AUTH (defence-in-depth): the relay-identity-signed NIP-98 envelope must bind this exact request.
      const ev = parseAuthEvent(req.headers['authorization']);
      const v = verifyEnvelope(ev, { method: 'POST', path: WAKE_PATH, rawBody, nowSec: Math.floor(now() / 1000), freshnessSec });
      if (!v.ok) { note('wake bad-sig'); reply(res, 401, 'unauthorized'); return; }

      // 2. BODY: contentless — recipient token + env ONLY. Any sender/church/message/content field is rejected.
      let body;
      try { body = JSON.parse(rawBody.toString('utf8') || '{}'); } catch { note('wake bad-json'); reply(res, 400, 'bad request'); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { note('wake bad-body'); reply(res, 400, 'bad request'); return; }
      for (const f of FORBIDDEN_BODY_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, f)) { note('wake forbidden-field'); reply(res, 400, 'bad request'); return; }
      }
      const token = body.token, env = body.env;
      if (typeof token !== 'string' || !/^[0-9a-fA-F]{8,200}$/.test(token)) { note('wake bad-token'); reply(res, 400, 'bad request'); return; }
      if (env !== 'sandbox' && env !== 'production') { note('wake bad-env'); reply(res, 400, 'bad request'); return; }

      // 3. RATE LIMIT. CORE GATE first: a hard cap PER RECIPIENT TOKEN. Then best-effort per relay identity.
      if (!rateLimiter.allowed('t:' + token, tokenLimit, tokenWindowMs)) { note('wake rate-limited token'); reply(res, 429, 'rate limited'); return; }
      if (!rateLimiter.allowed('p:' + v.pub, identityLimit, identityWindowMs)) { note('wake rate-limited identity'); reply(res, 429, 'rate limited'); return; }

      // 4. CONFIG. No .p8 => serve but refuse to send (never crash).
      if (!sender) { note('wake not-configured'); reply(res, 503, 'not configured'); return; }

      // 5. SEND the contentless push. Record the accept against both limits, then fire-and-forget.
      rateLimiter.record('t:' + token);
      rateLimiter.record('p:' + v.pub);
      note('wake accepted');
      sender.send(token, env);
      reply(res, 202, 'accepted');
    });
  });

  return { server, sender, rateLimiter, close: () => new Promise((r) => { try { server.close(() => r()); } catch { r(); } }) };
}

// ── STANDALONE ENTRYPOINT. host/port + APNs config from env. A missing/unreadable .p8 is NOT fatal: the service
// starts and every /wake returns 503 until it is configured. Logs are coarse — no token, no pubkey, no .p8 contents
// (the key FILE PATH may appear in loadConfig's own error, which we deliberately do not print).
export function startFromEnv(env = process.env) {
  const host = env.PUSH_SERVICE_HOST || '127.0.0.1';
  const port = Number(env.PUSH_SERVICE_PORT || 8787);
  let cfg = null;
  try { cfg = loadConfig(env); } catch { cfg = null; }   // graceful: unconfigured => /wake 503 (do NOT log the reason/path)
  const opts = { cfg, log: (m) => console.log('[push-service] ' + m) };
  if (env.PUSH_RATE_PER_TOKEN) opts.tokenLimit = Number(env.PUSH_RATE_PER_TOKEN);
  if (env.PUSH_RATE_WINDOW_MS) opts.tokenWindowMs = Number(env.PUSH_RATE_WINDOW_MS);
  const svc = createPushService(opts);
  svc.server.listen(port, host, () => {
    console.log('[push-service] listening on ' + host + ':' + port + (cfg ? ' (APNs configured)' : ' (APNs NOT configured — /wake returns 503)'));
  });
  return svc;
}

// Start only when run directly, never on import (so the test can import the factory without binding a port).
const _invokedDirect = (() => { try { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } })();
if (_invokedDirect) startFromEnv();
