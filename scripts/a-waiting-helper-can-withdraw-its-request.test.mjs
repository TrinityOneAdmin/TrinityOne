// A WAITING HELPER CAN WITHDRAW ITS OWN STEWARDREQ from the "Waiting for <church> to approve you" screen.
// Run: node --test scripts/a-waiting-helper-can-withdraw-its-request.test.mjs
// (Rebuild vendor/steward.js first — scripts/build-steward.sh — section A reads the SHIPPED bundle.)
//
// THE FEATURE. StewardAwaitingApproval (app/steward-root.jsx) gained a "Withdraw request" button next to
// "Check again". On click it retracts the helper's OWN STEWARDREQ and exits the waiting screen. The retract
// REUSES the shape the engine already uses on-grant (subscribeStewardedChurches, "RETRACT OUR OWN REQUEST"):
// a deleted+empty kind-30078 at the SAME d-tag (STEWARDREQ_D + cp), ['t', NET], ['p', cp], ['deleted'], signed
// with churchSk — so the owner's console (subscribeStewardRequests, which already drops a deleted/empty
// STEWARDREQ) dismisses it. ONE dismissal path, not two.
//
// Three claims, each at its point of use (CLAUDE.md rules 1 & 3; nothing text-matched in app/*.jsx):
//
//   A. THE ENGINE Steward.withdrawStewardRequest() is LIFTED from the SHIPPED bundle vendor/steward.js and run.
//      A1 asserts the EVENT handed to the lifted publish() is the exact retract tombstone (kind/d/deleted/empty/
//      #t/signed-with-churchSk) and that a truthy publish clears PENDING_CHURCH_KEY + drops cp from the
//      requested-set. A2 is the NO-FALSE-SUCCESS control: a publish that resolves false must NOT clear the
//      pending state and must report { ok:false }. A3: nothing pending -> { ok:false }, nothing published.
//
//   B. THE SCREEN: the real StewardAwaitingApproval is MOUNTED through console-screens.mjs. B1 the button
//      renders while a request is outstanding; B2 clicking it calls Steward.withdrawStewardRequest(cp) and, on
//      a truthy result, reloads (exits the waiting screen); B3 a FAILED withdraw does NOT reload and shows the
//      error (no false "withdrawn").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

// ── A. THE ENGINE METHOD, LIFTED FROM THE SHIPPED BUNDLE ──────────────────────────────────────────────────────
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const PEND_KEY = 'trinityone.steward.pending-church';
const STEWARDREQ_D = 'trinityone/stewardreq:';
const ME = 'ee'.repeat(32);        // the helper's own key (churchPub) — the signer the owner approved
const CHURCH = 'cc'.repeat(32);    // the church we asked to help
const SK = new Uint8Array(32).fill(7);   // churchSk, our own signing key
const REQ_KEY = (ownpub) => 'trinityone.steward.requested.' + ownpub;

// esbuild renames collided imports in the bundle (finalizeEvent -> finalizeEvent2, publish -> publish2, …), so a
// lifted body reads the SUFFIXED name. Strip a trailing number and fall back to the base stub, and let real
// browser builtins through — the same pattern the sibling an-approved-helper-retracts test uses.
function proxyOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

function engine({ publishResult = true, pending = CHURCH, requested = [CHURCH] } = {}) {
  const store = new Map();
  if (pending) store.set(PEND_KEY, pending);
  if (requested) store.set(REQ_KEY(ME), JSON.stringify(requested));
  const published = [];
  const stubs = {
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    PENDING_CHURCH_KEY: PEND_KEY, STEWARDREQ_D, NET: 'trinityone',
    churchSk: SK, churchPub: ME,
    now: () => 1762400000,
    _monotonic: (tmpl) => tmpl,
    finalizeEvent: (tmpl, key) => ({ ...tmpl, _signedWith: key, pubkey: ME, sig: 'sig' }),
    publish: (evt) => { published.push(evt); return Promise.resolve(publishResult); },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  };
  const scope = proxyOf(stubs);
  const fn = new Function('scope', `with (scope) { return ({ ${fnBody(VENDOR, 'withdrawStewardRequest(churchKey) {', 'withdrawStewardRequest')} }).withdrawStewardRequest; }`)(scope);
  return { withdraw: (k) => fn.call(scope, k), store, published, PEND_KEY };
}

test('A1: a successful withdraw publishes the retract tombstone AND clears the pending state', async () => {
  const e = engine({ publishResult: true });
  const r = await e.withdraw(CHURCH);
  assert.equal(e.published.length, 1, 'withdraw published no event');
  const ev = e.published[0];
  assert.equal(ev.kind, 30078, 'the tombstone is not a 30078 replaceable event');
  assert.equal((ev.tags.find(t => t[0] === 'd') || [])[1], STEWARDREQ_D + CHURCH, 'wrong d-tag — it will not replace the request');
  assert.ok(ev.tags.some(t => t[0] === 'deleted'), 'no ["deleted"] tag — subscribeStewardRequests will not read it as a retract');
  assert.equal(ev.content, '', 'the tombstone content is not empty');
  assert.ok(ev.tags.some(t => t[0] === 't' && t[1] === 'trinityone'), 'no #t tag — the owner\'s #t-filtered request feed would never receive it');
  assert.ok(ev.tags.some(t => t[0] === 'p' && t[1] === CHURCH), 'no ["p", church] tag');
  assert.equal(ev._signedWith, SK, 'not signed with churchSk — a tombstone by any other key is not the request author and the relay rejects it');
  assert.deepEqual(r, { ok: true, church: CHURCH }, 'withdraw did not report success');
  assert.equal(e.store.get(e.PEND_KEY), undefined, 'PENDING_CHURCH_KEY was not cleared — the waiting screen would not exit');
  assert.deepEqual(JSON.parse(e.store.get(REQ_KEY(ME))), [], 'the church was not dropped from the requested-set');
});

test('A2: NO FALSE SUCCESS — a failed publish keeps the request and reports { ok:false }', async () => {
  const e = engine({ publishResult: false });
  const r = await e.withdraw(CHURCH);
  assert.equal(e.published.length, 1, 'staging: withdraw should still attempt the publish');
  assert.equal(r.ok, false, 'a failed publish reported success — the request would look withdrawn while still live');
  assert.ok(r.error, 'a failed withdraw returned no error for the screen to show');
  assert.equal(e.store.get(e.PEND_KEY), CHURCH, 'PENDING_CHURCH_KEY was cleared on a FAILED publish — the request is still live but the screen would exit (false success)');
  assert.deepEqual(JSON.parse(e.store.get(REQ_KEY(ME))), [CHURCH], 'the requested-set was mutated on a failed publish');
});

test('A3: with nothing pending, withdraw publishes nothing and reports { ok:false }', async () => {
  const e = engine({ pending: '', requested: null });
  const r = await e.withdraw('');     // no argument, no pending key
  assert.equal(e.published.length, 0, 'a tombstone was published though there was no pending request');
  assert.equal(r.ok, false, 'withdraw claimed success with nothing to withdraw');
});

// ── B. THE SCREEN (real StewardAwaitingApproval, mounted) ─────────────────────────────────────────────────────
function mount({ withdrawResult = { ok: true }, reloadSpy } = {}) {
  const fr = fakeReact();
  const calls = [];
  const Steward = fakeSteward({
    withdrawStewardRequest: (cp) => { calls.push(cp); return Promise.resolve(withdrawResult); },
    selfRegister: () => Promise.resolve(),
  });
  const { window } = fakeBrowser({ Steward });
  if (reloadSpy) window.location.reload = reloadSpy;
  const mods = loadConsole({ React: fr.React, window, expr: '{ StewardAwaitingApproval }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.StewardAwaitingApproval({ church: { church: CHURCH, name: 'St Aidan' } }); fr.flush(); return tree; };
  const btn = () => nodes(draw()).find(n => n && n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes('Withdraw request')));
  return { draw, btn, calls, texts: () => texts(tree) };
}

test('B1: the withdraw button renders while a request is outstanding', () => {
  const m = mount();
  assert.ok(m.btn(), 'StewardAwaitingApproval did not render a "Withdraw request" button');
});

test('B2: clicking Withdraw calls the engine retract with the church, and reloads on success', async () => {
  let reloaded = false;
  const m = mount({ withdrawResult: { ok: true }, reloadSpy: () => { reloaded = true; } });
  await m.btn().props.onClick();
  assert.deepEqual(m.calls, [CHURCH], 'the button did not call Steward.withdrawStewardRequest(church)');
  assert.equal(reloaded, true, 'a successful withdraw did not reload — the waiting screen would never exit');
});

test('B3: a FAILED withdraw does NOT reload and shows the error (no false success in the UI)', async () => {
  let reloaded = false;
  const m = mount({ withdrawResult: { ok: false, error: 'Could not withdraw — your request still stands.' }, reloadSpy: () => { reloaded = true; } });
  await m.btn().props.onClick();
  m.draw();   // re-render so the error state is reflected
  assert.equal(reloaded, false, 'a FAILED withdraw reloaded away from the waiting screen (false success)');
  assert.match(m.texts().join(' '), /still stands/, 'the failed-withdraw error was not shown to the helper');
});
