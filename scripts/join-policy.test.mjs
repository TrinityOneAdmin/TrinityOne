// A new church must end up gated, on a relay that already hosts another church.
// Run: node --test scripts/join-policy.test.mjs
//
// AUDIT-2026-07-28 F10. "A new church gates joins by default" was published at wizard step 0, before the
// relay had been told the church exists. accept() refuses any kind-30078 write from a key that is not a
// configured church of that relay — and its first line is `if (!CHURCH_PUBS.size) return true`, so an
// UNCONFIGURED relay accepts everything. Measured against a real gateway:
//
//     relay hosts NOTHING,        new church sets approval  -> accepted
//     relay hosts church A,       church A sets approval    -> accepted
//     relay hosts church A,   NEW church B sets approval    -> REFUSED  "blocked: not a member…"
//
// The wizard swallowed the refusal and advanced, and the relay reads "no policy published" as OPEN. So every
// church set up on a relay that already hosts a congregation — which is every shared relay, and a8 — was
// created open to anyone holding the join link, silently. Same shape as the publishClearance bug earlier the
// same week: right against the one empty relay it was tried on, wrong against a real one.
//
// The relay behaviour under test is deliberately NOT changed. Refusing writes from a church a relay has never
// heard of is the tenancy rule, and weakening it would let anyone squat a relay. The fix is that the console
// stops firing once at the worst possible moment and instead converges.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8974;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const JP = 'trinityone/joinpolicy:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const hosted = K();      // the church this relay already serves
const control = K();     // hosted too, and touched by nothing except the CONTROL test
const fresh = K();       // a brand-new church, unknown to the relay
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'join-policy.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-jp-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    // A relay with a church ALREADY on it. Testing against an empty relay is exactly how this shipped:
    // accept() short-circuits to "unconfigured = open" and every write passes.
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: [hosted, control].map(c => npubEncode(c.pub)).join(',') },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const conn = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const rawPublish = (w, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); } };
  w.on('message', on); w.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => { w.off('message', on); res(['(no reply)', '']); }, 4000);
});
const policyEvent = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', JP + who.pub], ['t', 'trinityone']], content: JSON.stringify({ approval: true }) }, who.sk);

// ── the relay behaviour this whole finding rests on ──────────────────────────────────────────────────────
test('the relay refuses a join policy from a church it has never been told about', async () => {
  const w = await conn();
  const mine = await rawPublish(w, policyEvent(hosted));
  const theirs = await rawPublish(w, policyEvent(fresh));
  w.close();
  assert.equal(mine[0], true, 'control: the hosted church must be able to set its own join policy');
  assert.equal(theirs[0], false,
    'a church unknown to this relay was allowed to write church documents — that is a tenancy hole, not the bug under test');
  assert.match(theirs[1], /blocked|not a member|not permitted/i, 'unexpected refusal reason: ' + theirs[1]);
});

// ── the shipped console-side routine ─────────────────────────────────────────────────────────────────────
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
function grabMethod(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped console bundle — re-anchor this test');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;   // keep `async`, or the body will not compile
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

// A real subscribe/publish pool over one socket, so the read half is exercised too — the routine has to
// distinguish "no policy exists" from "the relay never answered", and only the real thing does that.
function consoleSide(church) {
  const blocked = [];
  const scope = {
    sk: church.sk, pub: church.pub, JOINPOLICY_D: JP, NET: 'trinityone', now,
    publish: async (evt) => {
      const w = await conn();
      const [ok] = await rawPublish(w, evt);
      w.close();
      return ok === true ? evt : false;
    },
    pool: {
      subscribeMany(_relays, filters, handlers) {
        let closed = false, w = null;
        conn().then(sock => {
          if (closed) { sock.close(); return; }
          w = sock;
          sock.on('message', d => {
            const m = JSON.parse(d);
            if (m[0] === 'EVENT' && m[1] === 's1') handlers.onevent(m[2]);
            if (m[0] === 'EOSE' && m[1] === 's1' && handlers.oneose) handlers.oneose();
          });
          sock.send(JSON.stringify(['REQ', 's1', ...filters]));
        }).catch(() => {});
        return { close() { closed = true; try { w && w.close(); } catch (e) {} } };
      },
    },
    relays: () => [WS_URL],
    window: { Steward: {}, dispatchEvent: (e) => { blocked.push(e); } },
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    setTimeout, Promise, JSON,
  };
  const setJP = grabMethod(STEWARD, 'setJoinPolicy(approval)');
  const ensure = grabMethod(STEWARD, 'ensureJoinPolicy()');
  // esbuild renames the nostr-tools import (finalizeEvent2 today). Binding the name I expected instead of the
  // one it emits makes every publish throw — which looks exactly like the relay refusing, i.e. like the bug.
  const feName = (setJP.match(/\bfinalizeEvent\d*\b/) || [])[0];
  assert.ok(feName, 'setJoinPolicy no longer signs an event — re-anchor this test');
  scope[feName] = finalizeEvent;
  const args = Object.keys(scope);
  const api = new Function(...args, `return ({ ${setJP},\n    ${ensure} });`)(...args.map(k => scope[k]));
  Object.assign(scope.window.Steward, api);
  return { api, blocked };
}

async function storedPolicy(cp) {
  const w = await conn();
  let got = null;
  await new Promise(res => {
    const on = d => { const m = JSON.parse(d); if (m[0] === 'EVENT' && m[1] === 'q') got = m[2]; if (m[0] === 'EOSE' && m[1] === 'q') { w.off('message', on); res(); } };
    w.on('message', on); w.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': [JP + cp] }]));
    setTimeout(res, 5000);
  });
  w.close();
  return got;
}

// CONTROL first: if the harness cannot publish at all, every test below "confirms" the finding for the wrong
// reason. (A harness impersonating the bug is how the clearance test nearly went out wrong today.)
test('CONTROL: the harness can actually PUBLISH for a hosted church', async () => {
  // Its own church, written by nothing else. My first version reused `hosted`, for which an earlier test had
  // already stored a policy — so ensureJoinPolicy returned already:true and the control passed while the
  // harness could not publish at all. A control that can be satisfied without doing the thing is not a control.
  const { api } = consoleSide(control);
  const r = await api.ensureJoinPolicy();
  assert.equal(r.published, true, 'the harness did not publish for a church the relay DOES host — the TEST is broken, not the console');
  const stored = await storedPolicy(control.pub);
  assert.ok(stored, 'nothing stored for the control church');
  assert.equal(JSON.parse(stored.content).approval, true);
});

test('a policy that already exists is never overwritten', async () => {
  // A steward who deliberately chose OPEN must stay open. Self-healing that ignores an existing choice is a
  // different bug wearing the fix's clothes.
  // Replaceable docs are newest-wins to the SECOND, and an earlier test already wrote a policy for this
  // church — so publishing again inside the same second is REFUSED and the old value survives. Wait FIRST,
  // and assert the write was actually accepted: without that, this test read back the earlier document and
  // reported the console as having overwritten a choice it never touched. It only failed under full-suite
  // load, which is exactly how a race hides. HANDOFF warns about this shape; I still walked into it.
  await sleep(1100);
  const w = await conn();
  const [wrote] = await rawPublish(w, finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', JP + hosted.pub], ['t', 'trinityone']], content: JSON.stringify({ approval: false }) }, hosted.sk));
  w.close();
  assert.equal(wrote, true, 'the fixture could not store "anyone may join" — the test would then check the wrong document');
  const { api } = consoleSide(hosted);
  const r = await api.ensureJoinPolicy();
  assert.equal(r.already, true, 'ensureJoinPolicy did not notice an existing policy');
  const stored = await storedPolicy(hosted.pub);
  assert.equal(JSON.parse(stored.content).approval, false, 'a deliberate "anyone may join" was overwritten');
});

test('a church the relay does not know is TOLD, instead of silently left open', async () => {
  const { api, blocked } = consoleSide(fresh);
  const r = await api.ensureJoinPolicy();
  assert.equal(r.ok, false, 'the relay accepted a write from a church it does not host — re-check the fixture');
  assert.equal(r.reason, 'refused');
  assert.equal(blocked.length, 1, 'the refusal reached no screen: the church is open to anyone with the link and nobody was told');
  assert.match(blocked[0].detail.message, /join/i);
  assert.match(blocked[0].detail.message, /relay/i, 'the message must say what to actually do about it');
});

test('and once the relay knows the church, it applies itself', async () => {
  // The self-heal. This is the whole point: the wizard no longer needs to win a race it cannot win.
  const r = await fetch(`http://127.0.0.1:${PORT}/status`);
  assert.ok(r.ok);
  // Register `fresh` the way the relay's own config endpoint does, then re-run the same routine.
  const admin = readFileSync(join(dataDir, 'admin.json'), 'utf8');
  const token = JSON.parse(admin).token;
  const reg = await fetch(`http://127.0.0.1:${PORT}/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ churches: [hosted, control, fresh].map(c => ({ npub: npubEncode(c.pub) })) }),
  });
  assert.ok(reg.ok, 'could not register the new church with the relay fixture: ' + reg.status);
  await sleep(600);
  const { api } = consoleSide(fresh);
  const out = await api.ensureJoinPolicy();
  assert.equal(out.ok, true, 'the join policy still did not apply after the church was registered: ' + out.reason);
  const stored = await storedPolicy(fresh.pub);
  assert.ok(stored, 'no policy stored for the new church — it is still open to anyone with the join link');
  assert.equal(JSON.parse(stored.content).approval, true);
});

test('the wizard calls the self-healing version, not the one-shot', () => {
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = D.indexOf('const saveName = async () =>');
  assert.notEqual(at, -1, 'the wizard name step is gone — re-anchor this test');
  const body = D.slice(at, at + 700);
  assert.match(body, /ensureJoinPolicy/, 'the wizard still fires the one-shot setJoinPolicy, which the relay refuses');
  assert.doesNotMatch(body, /setJoinPolicy\(true\)/, 'the one-shot is still there');
  assert.match(D, /registerWithRelay[\s\S]{0,400}?ensureJoinPolicy/,
    'nothing re-applies the policy after the church registers with its relay');
  assert.match(D, /setTimeout\(\(\) => \{ try \{ if \(window\.Steward\.ensureJoinPolicy\)/,
    'nothing re-applies the policy on console boot, so churches already created open stay open');
});
