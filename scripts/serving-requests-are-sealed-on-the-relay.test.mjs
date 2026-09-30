// SERVING REQUESTS AND REPLIES ARE SEALED UNDER THE CHURCH NAME KEY (C-4).
//   Run: node --test scripts/serving-requests-are-sealed-on-the-relay.test.mjs
//
// THE DEFECT. sendServingRequest wrote the role, team, date, time, service name and note as plain JSON
// beside a ['p', <member>] tag. So a seized relay disk mapped "Kids Church / Children's worker / 4 Oct"
// onto a named person — undoing the 2026-08-15 sealing of the timetable that publishService, three lines
// away in the same file, already did. respondToServingRequest wrote its reply in the clear too.
//
// THE FIX. sendServingRequest seals with _sealChurchDocReady (the same call publishService makes) and
// REFUSES rather than falling back to cleartext. respondToServingRequest seals with the member-side
// _sealChurchDocMember. All four readers open with _openChurchDoc, which still opens every cleartext
// document written before this. A request that will not open carries `_locked` so the screen can say so.
//
// Callers of the code changed here (CLAUDE.md rule 2):
//   sendServingRequest        <- app/stew-schedule.jsx (the Ask flow, and sendRequestsFor)
//   respondToServingRequest   <- app/app.jsx serving handlers <- app/screens-serving.jsx svRespond
//   subscribeRequests         <- app/stew-schedule.jsx (the console's request board)
//   subscribeRequestReplies   <- app/stew-schedule.jsx (joins replies to slots)
//   subscribeMyServingRequests<- app/app.jsx -> ctx.servPending -> app/screens-serving.jsx
//   subscribeMyReqReplies     <- app/app.jsx -> ctx servReplies
//   maybePush (scripts/gateway.mjs) — read the same fields to build the push body; now generic.
//
// _sealChurchDocReady is shared with publishService, publishRota, publishRoster, publishRunsheet and
// publishBooking; none of their call sites change — this adds a seventh caller, it does not alter the
// helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url);
const STEW = readFileSync(new URL('vendor/steward.js', ROOT), 'utf8');
const FELLOW = readFileSync(new URL('vendor/fellowship.js', ROOT), 'utf8');
const PORT = 21101;

const hex = (u) => [...u].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(String(s).match(/.{1,2}/g).map(b => parseInt(b, 16)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const keypair = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// The exact words a steward types on the Ask flow. Every assertion below hunts for these on the disk.
const SECRETS = ['Kids Church', 'Children’s worker', '2026-10-04', 'St Aidan hall'];
const REQ = {
  serviceId: 'svc1', teamId: 'kids', roleId: 'r1', role: 'Children’s worker', teamName: 'Kids Church',
  icon: 'hand', accent: 'var(--clay)', date: '2026-10-04', time: '10:30',
  service: 'Kids Church — St Aidan hall', from: 'St Aidan', note: 'Can you serve on Kids Church?',
};

// ── lift the console's writer, with a name key in the ring ────────────────────────────────────────────
function liftConsole({ church, nameKey }) {
  const S = {
    sk: church.sk, pub: church.pub, actingChurch: null, NET: 'trinityone',
    REQUEST_D: 'trinityone/request:', SERVICE_D: 'trinityone/service:',
    _nameKeyRing: nameKey ? [nameKey] : [],
    _unhex: unhex, encrypt3: nip44.encrypt, decrypt3: nip44.decrypt,
    feChurch: (t) => finalizeEvent(t, church.sk), now, captured: [], _reqSeq: 0, _svcSeq: 0,
    publish: async (e) => { S.captured.push(e); return true; },
  };
  const sealFn = fnBody(STEW, 'function _sealChurchDoc(', '_sealChurchDoc');
  const readyFn = fnBody(STEW, 'function _sealChurchDocReady(', '_sealChurchDocReady');
  const openFn = fnBody(STEW, 'function _openChurchDoc(', '_openChurchDoc');
  const svcFn = fnBody(STEW, 'async publishService(', 'publishService');
  const reqFn = fnBody(STEW, 'async sendServingRequest(req) {', 'sendServingRequest');
  // If the bundler renames these the lift silently tests nothing — anchor on what the body must contain.
  assert.match(sealFn, /encrypt3/, 'bundle rename: _sealChurchDoc no longer calls encrypt3');
  assert.match(reqFn, /_sealChurchDocReady/,
    'sendServingRequest does not call _sealChurchDocReady — the request is written in the clear (C-4)');
  const api = new Function('S', `with (S) { const NAME_KEY_WAIT_MS = 10; ${sealFn}\n${readyFn}\n${openFn}\n return ({ ${svcFn}, ${reqFn}, _open: _openChurchDoc }); }`)(S);
  return { S, api };
}

// ── ENGINE: the writer seals, and refuses when no key ever arrives ────────────────────────────────────

test('a serving request leaves the console sealed, not as plain JSON', async () => {
  const church = keypair(), mary = keypair();
  const nameKey = hex(crypto.getRandomValues(new Uint8Array(32)));
  const { S, api } = liftConsole({ church, nameKey });

  const out = await api.sendServingRequest({ ...REQ, memberPub: mary.pub });
  assert.ok(out, 'sendServingRequest returned null with a name key in the ring');
  assert.equal(S.captured.length, 1, 'expected exactly one published event');

  const content = S.captured[0].content;
  for (const s of SECRETS) {
    assert.ok(!content.includes(s),
      `"${s}" is in the published content in the clear — the request is not sealed (C-4)`);
  }
  const env = JSON.parse(content);
  assert.equal(typeof env.e, 'string', 'sealed content must be the { e: <ciphertext> } envelope');
});

test('the caller still gets the role, team and date back — not the ciphertext envelope', async () => {
  const church = keypair(), mary = keypair();
  const nameKey = hex(crypto.getRandomValues(new Uint8Array(32)));
  const { api } = liftConsole({ church, nameKey });

  // stew-schedule.jsx spreads this return value straight onto its board row. If sendServingRequest hands
  // back JSON.parse(content) after sealing, every field here is undefined and the row renders blank.
  const out = await api.sendServingRequest({ ...REQ, memberPub: mary.pub });
  assert.equal(out.role, 'Children’s worker', 'the returned request lost its role');
  assert.equal(out.teamName, 'Kids Church', 'the returned request lost its team name');
  assert.equal(out.date, '2026-10-04', 'the returned request lost its date');
  assert.equal(out.memberPub, mary.pub, 'the returned request lost the member it is for');
  assert.ok(!('e' in out), 'the returned request carries the ciphertext envelope instead of the document');
});

test('with no name key the request is NOT sent, and never in the clear', async () => {
  const church = keypair(), mary = keypair();
  const { S, api } = liftConsole({ church, nameKey: null });   // ring empty: the key never arrived

  const out = await api.sendServingRequest({ ...REQ, memberPub: mary.pub });
  assert.equal(out, null, 'sendServingRequest must answer null when it cannot seal — "not saved"');
  assert.equal(S.captured.length, 0,
    'a request was published with no key to seal it — this is the cleartext fallback C-4 removes');
});

// ── ENGINE: the reader opens both shapes ──────────────────────────────────────────────────────────────

test('the console reader opens a sealed request, and still opens an old cleartext one', async () => {
  const church = keypair();
  const nameKey = hex(crypto.getRandomValues(new Uint8Array(32)));
  const { api } = liftConsole({ church, nameKey });

  const sealed = JSON.stringify({ e: nip44.encrypt(JSON.stringify(REQ), unhex(nameKey)) });
  const opened = api._open(sealed);
  assert.equal(opened.role, 'Children’s worker', '_openChurchDoc did not open a sealed request');

  // CONTROL: every request written before C-4 is plain JSON and must still render.
  const old = api._open(JSON.stringify(REQ));
  assert.equal(old.role, 'Children’s worker',
    '_openChurchDoc no longer opens a cleartext request — every request sent before C-4 would vanish');
});

test('a request sealed with a key this console does not hold opens as null, not as a wrong answer', () => {
  const church = keypair();
  const mine = hex(crypto.getRandomValues(new Uint8Array(32)));
  const theirs = hex(crypto.getRandomValues(new Uint8Array(32)));
  const { api } = liftConsole({ church, nameKey: mine });

  const sealed = JSON.stringify({ e: nip44.encrypt(JSON.stringify(REQ), unhex(theirs)) });
  assert.equal(api._open(sealed), null,
    'a document sealed with an unheld key must answer null so the caller can mark it locked');
});

// ── ENGINE: the member's reply is sealed too ──────────────────────────────────────────────────────────

test('a member’s reply leaves the phone sealed when the phone holds the church name key', () => {
  const church = keypair();
  const nameKey = crypto.getRandomValues(new Uint8Array(32));
  const sealFn = fnBody(FELLOW, 'function _sealChurchDocMember(', '_sealChurchDocMember');
  // ⚠ THE BUNDLE NAME, NOT THE SOURCE NAME. esbuild renames `nip44e` to `encrypt` here. Stubbing the
  // source name leaves the real one undefined, the call throws, and _sealChurchDocMember's own catch
  // returns the body AS CLEARTEXT — so a mis-named stub makes this test fail as if the fix were missing.
  // (It did, first run.) Anchor on the name the bundle actually calls so a future rename says so.
  assert.match(sealFn, /\bencrypt\(body, k\)/,
    'bundle rename: _sealChurchDocMember no longer calls encrypt(body, k) — re-anchor this stub, or it ' +
    'will silently test the cleartext fallback instead of the sealing');
  const F = {
    _nameKeys: new Map([[church.pub, [nameKey]]]),
    encrypt: (body, k) => nip44.encrypt(body, k),
  };
  const seal = new Function('F', `with (F) { ${sealFn}\n return _sealChurchDocMember; }`)(F);

  const content = seal(church.pub, { request: 'req1', v: 'accept', swapTo: '' });
  assert.ok(!content.includes('accept'),
    'the verdict is in the reply content in the clear — respondToServingRequest is not sealing (C-4)');
  assert.equal(typeof JSON.parse(content).e, 'string', 'the reply must be the { e: <ciphertext> } envelope');
});

test('respondToServingRequest calls the sealer rather than JSON.stringify', () => {
  // vendor/*.js, NOT app/*.jsx: the bundler strips dead code, so `false && _sealChurchDocMember(...)`
  // removes the text and this match fails. CLAUDE.md rule 3 permits the match against a bundle.
  const fn = fnBody(FELLOW, 'async respondToServingRequest(', 'respondToServingRequest');
  assert.match(fn, /_sealChurchDocMember/,
    'respondToServingRequest no longer seals its reply — the verdict is stored readable on the relay');
});

// ── THE SEIZED DISK: a real relay, real sockets, and then read its sqlite ──────────────────────────────

test('a seized relay disk holds no role, team or date for a serving request', async (t) => {
  const church = keypair(), mary = keypair();
  const nameKey = hex(crypto.getRandomValues(new Uint8Array(32)));
  const { S, api } = liftConsole({ church, nameKey });

  // Exactly what stew-schedule.jsx sends when a steward taps Ask on a rota slot.
  await api.publishService({ id: 'svc1', date: '2026-10-04', time: '10:30', name: 'Kids Church — St Aidan hall' });
  await api.sendServingRequest({ ...REQ, memberPub: mary.pub });
  const [svcEvt, reqEvt] = S.captured;
  assert.ok(svcEvt && reqEvt, 'the console produced fewer than the two events this test sends');

  const DATA = mkdtempSync(join(tmpdir(), 'c4-relay-'));
  const relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('.', ROOT).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: DATA, CHURCH_NPUB: npubEncode(church.pub), RELAY_MAX_EVENTS: '5000' },
    stdio: 'ignore',
  });
  t.after(() => { try { rmSync(DATA, { recursive: true, force: true }); } catch {} });

  try {
    let up = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) { up = true; break; } } catch {}
      await sleep(200);
    }
    assert.ok(up, `the gateway did not come up on ${PORT}`);

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/relay`);
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    const waiters = new Map();
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'OK' && waiters.has(m[1])) { waiters.get(m[1])(m); waiters.delete(m[1]); }
      if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', `ws://127.0.0.1:${PORT}/relay`], ['challenge', m[1]]], content: '' }, church.sk)]));
    });
    const send = (e) => new Promise((r) => { waiters.set(e.id, r); ws.send(JSON.stringify(['EVENT', e])); setTimeout(() => r(['OK', e.id, 'timeout']), 4000); });
    await sleep(300);

    await send(finalizeEvent({ kind: 0, created_at: now(), tags: [['t', 'trinityone']], content: '{}' }, church.sk));
    await send(finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: JSON.stringify({ joined: now() }) }, mary.sk));
    const svcOk = await send(svcEvt);
    const reqOk = await send(reqEvt);
    assert.equal(svcOk[2], true, 'the relay refused the service: ' + svcOk[3]);
    assert.equal(reqOk[2], true, 'the relay refused the serving request: ' + reqOk[3]);
    await sleep(800);
    ws.close();
  } finally {
    relay.kill('SIGTERM'); await sleep(800);
    try { relay.kill('SIGKILL'); } catch {}
  }

  const db = new DatabaseSync(join(DATA, 'relay.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT * FROM events').all();
  db.close();

  const find = (pfx) => rows.find(r => JSON.stringify(r).includes('trinityone/' + pfx + ':'));
  const reqRow = find('request');
  const svcRow = find('service');
  assert.ok(reqRow, 'the serving request is not on the relay disk at all — the test proved nothing');
  assert.ok(svcRow, 'the service is not on the relay disk — the CONTROL is missing');

  for (const s of SECRETS) {
    assert.ok(!JSON.stringify(reqRow).includes(s),
      `a seized disk shows "${s}" against the member's pubkey — the serving request is stored readable (C-4)`);
  }
  // CONTROL: the service was already sealed in 2026-08-15, and proves this scan can tell sealed from not.
  for (const s of SECRETS) {
    assert.ok(!JSON.stringify(svcRow).includes(s),
      `CONTROL FAILED: "${s}" is readable in the service row, which has been sealed since 2026-08-15 — ` +
      'the scan is looking in the wrong place, so the request assertions above prove nothing');
  }
});
