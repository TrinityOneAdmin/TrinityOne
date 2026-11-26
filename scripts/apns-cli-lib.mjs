// SHARED CLI implementation for the two STANDALONE iOS-APNs ops tools (apns-auth-smoke.mjs + apns-send-one.mjs).
//
// Node built-ins ONLY (http2, crypto, fs) — no new npm dependency.
//
// THIS MODULE MUST NOT IMPORT scripts/gateway.mjs. Importing the gateway boots the relay HTTP server as a side
// effect; these are separate ops tools that run with no relay. So the §15.2 contract (buildPayload / apnsUrl /
// buildHeaders / buildJwt) is REPLICATED here, byte-for-byte, from the shipped sender in gateway.mjs. The drift
// guard in apns-cli-lib.test.mjs lifts the gateway's own functions and asserts they still agree with these, so the
// two implementations cannot silently diverge.

import { readFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { connect as http2Connect } from 'node:http2';

// §15.2 CONTRACT — CONTENTLESS. No message body, no sender, no church name, no content-available. Literal title/body
// (owner decision 2026-11-26: pilot app is English-only, no Localizable.strings); the wire carries no church/graph
// data. Must stay identical to gateway.mjs.
export function buildPayload() {
  return { aps: { alert: { title: 'TrinityOne', body: 'New message' }, sound: 'default', 'thread-id': 'trinityone-msgs' } };
}

// production vs sandbox is the TOKEN's environment. Any value that is not the literal 'sandbox' is production.
export function apnsUrl(token, env) {
  const host = env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  return 'https://' + host + '/3/device/' + token;
}

function _b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

// ES256 (ECDSA P-256) JWT signed with the .p8. Apple requires a JOSE r||s signature, NOT DER — dsaEncoding
// 'ieee-p1363'. iat is unix SECONDS. kid is the key id in the HEADER; iss is the team id in the CLAIMS.
export function buildJwt(keyPem, keyId, teamId, iat) {
  const signingInput = _b64url(JSON.stringify({ alg: 'ES256', kid: keyId })) + '.' + _b64url(JSON.stringify({ iss: teamId, iat }));
  const sig = cryptoSign('sha256', Buffer.from(signingInput), { key: createPrivateKey(keyPem), dsaEncoding: 'ieee-p1363' });
  return signingInput + '.' + _b64url(sig);
}

export function buildHeaders(jwt, topic) {
  return {
    'authorization': 'bearer ' + jwt,
    'apns-topic': topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-collapse-id': 'trinityone-msgs',
  };
}

// CONFIG from env. Unlike the gateway's readApnsConfig (which returns null to stay a graceful startup no-op), a CLI
// operator wants to know WHY, so this FAILS FAST with a clear message: a missing var, an unreadable file, or a .p8
// that is not a parseable private key each throw with the offending detail named.
export function loadConfig(env = process.env) {
  const keyFile = env.TRINITY_APNS_KEY_FILE, keyId = env.TRINITY_APNS_KEY_ID, teamId = env.TRINITY_APNS_TEAM_ID;
  const topic = env.TRINITY_APNS_TOPIC || 'com.trinityone.app';
  const missing = [];
  if (!keyFile) missing.push('TRINITY_APNS_KEY_FILE');
  if (!keyId) missing.push('TRINITY_APNS_KEY_ID');
  if (!teamId) missing.push('TRINITY_APNS_TEAM_ID');
  if (missing.length) throw new Error('missing required env var(s): ' + missing.join(', '));
  let keyPem;
  try { keyPem = readFileSync(keyFile, 'utf8'); } catch (e) { throw new Error('cannot read TRINITY_APNS_KEY_FILE (' + keyFile + '): ' + e.message); }
  if (!keyPem || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(keyPem)) throw new Error('the .p8 at ' + keyFile + ' is not a PEM private key');
  try { createPrivateKey(keyPem); } catch (e) { throw new Error('the .p8 at ' + keyFile + ' does not parse as a private key: ' + e.message); }
  return { keyPem, keyId, teamId, topic };
}

// Send ONE contentless HTTP/2 POST and resolve { status, apnsId, reason, body }. reason is Apple's JSON `reason`
// string when the body carries one (BadDeviceToken / InvalidProviderToken / TopicDisallowed / …), else ''. The
// transport is injectable (`connect`) so a test can observe a send with no network call; it defaults to node:http2.
export function sendOne({ cfg, token, env, iat = Math.floor(Date.now() / 1000), timeoutMs = 10000, connect = http2Connect }) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(apnsUrl(token, env)); } catch (e) { reject(e); return; }
    let jwt, headers, body;
    try {
      jwt = buildJwt(cfg.keyPem, cfg.keyId, cfg.teamId, iat);
      headers = { ':method': 'POST', ':path': u.pathname, ...buildHeaders(jwt, cfg.topic) };
      body = JSON.stringify(buildPayload());
    } catch (e) { reject(e); return; }
    let session;
    try { session = connect(u.origin); } catch (e) { reject(e); return; }
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; try { session.close(); } catch {} fn(arg); };
    session.on('error', (e) => finish(reject, e));
    const req = session.request(headers);
    const timer = setTimeout(() => { try { (req.destroy ? req.destroy() : req.close && req.close()); } catch {} finish(reject, new Error('APNs request timed out after ' + timeoutMs + 'ms')); }, timeoutMs);
    let status = 0, apnsId = '';
    const chunks = [];
    req.on('response', (h) => { status = h[':status'] || 0; apnsId = h['apns-id'] || ''; });
    req.on('data', (c) => chunks.push(c));
    req.on('error', (e) => { try { clearTimeout(timer); } catch {} finish(reject, e); });
    req.on('end', () => {
      try { clearTimeout(timer); } catch {}
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      let reason = '';
      if (bodyStr) { try { reason = JSON.parse(bodyStr).reason || ''; } catch { reason = bodyStr; } }
      finish(resolve, { status, apnsId, reason, body: bodyStr });
    });
    req.end(body);
  });
}
