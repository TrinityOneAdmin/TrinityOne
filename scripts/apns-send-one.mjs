#!/usr/bin/env node
// apns-send-one.mjs — fire ONE real contentless push at a given device token.
//
// For ringing the iOS Simulator (or a real device) with a real token: it mints the ES256 JWT, POSTs the contentless
// §15.2 payload to the token at the chosen environment's host, and prints the status + apns-id + reason. Exit 0 only
// on HTTP 200. Unlike apns-auth-smoke.mjs this sends to a REAL token, so it DOES deliver a push.
//
// USAGE:
//   TRINITY_APNS_KEY_FILE=/path/AuthKey_XXXX.p8 \
//   TRINITY_APNS_KEY_ID=XXXXXXXXXX \
//   TRINITY_APNS_TEAM_ID=YYYYYYYYYY \
//   [TRINITY_APNS_TOPIC=com.trinityone.app] \
//     node scripts/apns-send-one.mjs --token <hex-device-token> --env sandbox|production [--topic <bundle-id>]
//
// This tool is STANDALONE: it does not import or start scripts/gateway.mjs. It shares the ONE CLI implementation in
// apns-cli-lib.mjs with apns-auth-smoke.mjs.

import { pathToFileURL } from 'node:url';
import { loadConfig, sendOne } from './apns-cli-lib.mjs';

function parseArgs(argv) {
  const out = { token: null, env: null, topic: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--token') { out.token = argv[++i]; if (!out.token) throw new Error('--token needs a value'); }
    else if (a === '--env') {
      const v = argv[++i];
      if (v !== 'sandbox' && v !== 'production') throw new Error('--env must be sandbox or production');
      out.env = v;
    } else if (a === '--topic') { out.topic = argv[++i]; if (!out.topic) throw new Error('--topic needs a value'); }
    else throw new Error('unknown argument: ' + a);
  }
  if (!out.token) throw new Error('--token <hex> is required');
  if (!out.env) throw new Error('--env sandbox|production is required');
  if (!/^[0-9a-fA-F]+$/.test(out.token)) throw new Error('--token must be hex');
  return out;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('ERROR: ' + e.message); process.exit(2); }

  let cfg;
  try { cfg = loadConfig(); }
  catch (e) { console.error('ERROR: ' + e.message); process.exit(2); }
  if (args.topic) cfg = { ...cfg, topic: args.topic };

  console.log('Sending ONE contentless push -> ' + args.env + ' host, topic=' + cfg.topic + ', token=' + args.token.slice(0, 8) + '…');
  let res;
  try { res = await sendOne({ cfg, token: args.token, env: args.env }); }
  catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }

  console.log('HTTP ' + res.status + '  apns-id=' + (res.apnsId || '(none)') + '  reason=' + (res.reason || '(none)'));
  if (res.status === 200) { console.log('OK: Apple accepted the push.'); process.exit(0); }
  console.log('NOT ACCEPTED (status ' + res.status + ').');
  process.exit(1);
}

// Entry-point guard: importing this module must not fire a network call.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error('ERROR: ' + (e && e.message || e)); process.exit(1); });
}
