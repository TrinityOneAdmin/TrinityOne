#!/usr/bin/env node
// apns-auth-smoke.mjs — NO-DEVICE APNs auth smoke check (the priority ops tool).
//
// Proves the Apple push CREDENTIALS (the .p8 key + key id + team id + topic) are accepted by APNs, WITHOUT ever
// delivering a real push: it POSTs the contentless §15.2 payload to a DELIBERATELY BOGUS device token (64 hex of
// 'a') at BOTH hosts (sandbox and production), reads Apple's status + reason, and interprets it:
//
//   400 BadDeviceToken / 410  -> CREDS VALID  (auth passed; Apple rejected the bogus DEVICE, exactly as expected)
//   403 InvalidProviderToken / ExpiredProviderToken / 401  -> CREDS INVALID (key / keyId / team wrong)
//   403 TopicDisallowed       -> TOPIC WRONG
//   anything else             -> printed raw (unexpected)
//
// Because the token is invalid, NO notification is ever delivered to any device. Exit 0 only if EVERY requested
// host returned the creds-valid signal.
//
// USAGE:
//   TRINITY_APNS_KEY_FILE=/path/AuthKey_XXXX.p8 \
//   TRINITY_APNS_KEY_ID=XXXXXXXXXX \
//   TRINITY_APNS_TEAM_ID=YYYYYYYYYY \
//   [TRINITY_APNS_TOPIC=com.trinityone.app] \
//     node scripts/apns-auth-smoke.mjs [--host sandbox|prod] [--topic <bundle-id>]
//
// This tool is STANDALONE: it does not import or start scripts/gateway.mjs.

import { pathToFileURL } from 'node:url';
import { loadConfig, sendOne } from './apns-cli-lib.mjs';

const BOGUS_TOKEN = 'a'.repeat(64);   // well-formed length, clearly not a real token -> APNs rejects the DEVICE

// PURE status -> verdict mapping. Factored out and exported so it is unit-testable with synthetic responses.
// Returns { kind, ok, text }. ok === true ONLY for the creds-valid signal (a bogus token auth-passed by Apple).
export function verdict(status, reason) {
  if (status === 400 && reason === 'BadDeviceToken') return { kind: 'creds-valid', ok: true, text: 'CREDS VALID (auth passed; device rejected as expected)' };
  if (status === 410) return { kind: 'creds-valid', ok: true, text: 'CREDS VALID (auth passed; device rejected as expected)' };
  if (status === 403 && (reason === 'InvalidProviderToken' || reason === 'ExpiredProviderToken')) return { kind: 'creds-invalid', ok: false, text: 'CREDS INVALID (key/keyId/team wrong)' };
  if (status === 401) return { kind: 'creds-invalid', ok: false, text: 'CREDS INVALID (key/keyId/team wrong)' };
  if (status === 403 && reason === 'TopicDisallowed') return { kind: 'topic-wrong', ok: false, text: 'TOPIC WRONG' };
  return { kind: 'unexpected', ok: false, text: 'UNEXPECTED: status ' + status + (reason ? ' (' + reason + ')' : '') };
}

function parseArgs(argv) {
  const out = { host: 'both', topic: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') {
      const v = argv[++i];
      if (v !== 'sandbox' && v !== 'prod' && v !== 'production') { throw new Error('--host must be sandbox or prod'); }
      out.host = (v === 'production') ? 'prod' : v;
    } else if (a === '--topic') {
      out.topic = argv[++i];
      if (!out.topic) throw new Error('--topic needs a value');
    } else {
      throw new Error('unknown argument: ' + a);
    }
  }
  return out;
}

// sandbox -> 'sandbox' env; prod -> 'production' env (apnsUrl treats anything != 'sandbox' as production).
function hostsFor(sel) {
  if (sel === 'sandbox') return [{ label: 'sandbox', env: 'sandbox' }];
  if (sel === 'prod') return [{ label: 'production', env: 'production' }];
  return [{ label: 'sandbox', env: 'sandbox' }, { label: 'production', env: 'production' }];
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('ERROR: ' + e.message); process.exit(2); }

  let cfg;
  try { cfg = loadConfig(); }
  catch (e) { console.error('ERROR: ' + e.message); process.exit(2); }
  if (args.topic) cfg = { ...cfg, topic: args.topic };

  const hosts = hostsFor(args.host);
  console.log('APNs auth smoke check — topic=' + cfg.topic + ', keyId=' + cfg.keyId + ', teamId=' + cfg.teamId);
  console.log('(sending the contentless payload to a BOGUS token ' + BOGUS_TOKEN.slice(0, 8) + '… — no real push is delivered)\n');

  let allValid = true;
  for (const h of hosts) {
    let res, err = null;
    try { res = await sendOne({ cfg, token: BOGUS_TOKEN, env: h.env }); }
    catch (e) { err = e; }
    if (err) {
      allValid = false;
      console.log('[' + h.label + '] NETWORK/TRANSPORT ERROR: ' + err.message);
      continue;
    }
    const v = verdict(res.status, res.reason);
    if (!v.ok) allValid = false;
    console.log('[' + h.label + '] HTTP ' + res.status + '  apns-id=' + (res.apnsId || '(none)') + '  reason=' + (res.reason || '(none)'));
    console.log('[' + h.label + '] => ' + v.text);
  }
  console.log('');
  if (allValid) { console.log('RESULT: creds valid on every requested host.'); process.exit(0); }
  console.log('RESULT: at least one host did NOT return the creds-valid signal.');
  process.exit(1);
}

// Entry-point guard: importing this module (the verdict unit test does) must NOT fire a network call.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error('ERROR: ' + (e && e.message || e)); process.exit(2); });
}
