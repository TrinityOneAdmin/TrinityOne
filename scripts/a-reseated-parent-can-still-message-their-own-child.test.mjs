// A PARENT RECONNECTED ONTO A NEW PHONE MUST STILL BE ABLE TO MESSAGE THEIR OWN CHILD.
//   Run: node --test scripts/a-reseated-parent-can-still-message-their-own-child.test.mjs
//
// GAP (b), measured on d0696eb.
//
// A parent loses their 12 words. A steward reconnects them onto a new key from the Members list. The
// re-seat moves the parent link in the church's `guardians:` map, tells the PARENT'S phone, and reports
// "their parent link moved across with them, and their new phone has been told."
//
// THE CHILD'S PHONE IS NEVER TOLD. It is not a race; there is no push at all. Traced through the shipped
// member engine:
//
//   · the child's only answer is `myGuardians` (src/fellowship.src.js), read ONLY from `clr.guardians`
//     inside its own sealed `clearance:<child>` document;
//   · `reseatMember` re-sealed `[newH]` — the re-seated key and nothing else — so the child's clearance
//     was not re-issued;
//   · the church's `guardians:` map is owner / safeguarding-steward only at the relay (the
//     MINORS_D/GUARDIANS_D branch of gateway.mjs's read gate), so a child is NEVER served it and that
//     fallback is permanently `{}`;
//   · a `guardnotice:` is d-tagged AND p-tagged to a PARENT, and its payload is `children` — a child is
//     never a recipient, and the handler writes `trinityone.family`, never `myGuardians`;
//   · the `reseat:` doc DOES reach the child and `_noteReseat` ingests it, but `_superseded()` is consulted
//     by exactly four lists (a parent's children, a parent's pending guardreq rebuild, the member count and
//     the member directory) and `myGuardians` is not one of them — so nothing maps the old parent key to
//     the new one;
//   · and the docs-hub cache replays the STALE clearance on every boot, before any network answer.
//
// So until a steward happened to reopen the Members tab and DashMembers' whole-roster back-fill happened to
// re-run, the child's sealed clearance went on naming a parent key nobody holds.
//
// WHICH DIRECTION WAS ACTUALLY BROKEN — corrected 2026-10-13 (CLAUDE.md rule 4). The first version of this
// header, and cbdb85a's commit message, said "a parent could not message their own child". That was NOT
// measured and is not true. Running the real `canDMPeer` (app/app.jsx) for the PARENT's phone: `guardians` is
// {}, `minors` is [] and `myGuardians` is [] on a parent's device, so the trailing guardian check cannot
// fire — and the relay permits the send anyway, because `guardianLinkedIn` reads the church map that
// `setGuardians` had already updated. The parent -> child direction was never blocked, before or after.
//
// What WAS genuinely broken, and is what this file proves is fixed, is one-directional and at screen level:
// THE CHILD'S PHONE. Its only answer is the sealed clearance, so on the child's screen the re-seated parent
// is filtered OUT of the chat people list (app/screens-chat.jsx:1822) and the child cannot reply (:2047).
// The child could not reach their parent, and docs/security/SAFEGUARDING.md:161 promises they can. No test
// in the suite drove that direction.
//
// WHAT THIS FILE PROVES, and what it deliberately does not. `reseatMember` is lifted out of the SHIPPED
// vendor/steward.js by brace-match and run, with setters we control — the same instrument as
// scripts/reseat-write-results.test.mjs, for the same reason: the assertions are about what the function
// does, not how its source is spelled. The child-side half (that `myGuardians` comes only from the sealed
// clearance) is already covered by scripts/child-parent-dm.test.mjs and scripts/can-dm-peer-runs.test.mjs;
// what was missing, and is here, is that anything ever re-issues the CHILD'S clearance.
//
// POINT OF USE. The console screen that reaches this is ReseatModal.confirm in app/stew-dashboard.jsx, and
// the last test in this file runs that handler — so this goes red if the guardian map stops being handed to
// the engine from the screen, not only if the engine stops using it (CLAUDE.md rule 1). Nothing here matches
// text in the .jsx: app/*.jsx ships unbundled, so `false && ` leaves every word in place.
//
// MEASURED RED/GREEN, 2026-10-13. Each sabotage scoped to the enclosing function, the anchor asserted to
// occur exactly ONCE inside that slice before the edit, and the source restored byte-for-byte after:
//   · shipped                                                                      6 pass / 0 fail
//   · reseatMember: `[newH, ...relinkedChildren]` -> `[newH]`   (the gap restored)  4 pass / 2 fail
//   · reseatMember: `relinkedChildren.push(...)` removed                            4 pass / 2 fail
//   · ReseatModal.confirm: `guardians: guardiansNow` -> `guardians: {}`             5 pass / 1 fail
// The two src/ sabotages were REBUILT into vendor/steward.js before the run and the bundle rebuilt again
// after the restore: this file lifts out of vendor/, so a sabotage left unbuilt measures the old artefact
// and reports a pass over broken code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { fnBody } from './test-slice.mjs';
import { miniReact } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const K = () => getPublicKey(generateSecretKey());

// Brace-match the shipped function out of the BUNDLE (comment- and quote-aware). Same helper as
// scripts/reseat-write-results.test.mjs. Note the bundle is what is anchored on, not src/ — esbuild renames
// locals, so a test that lifts out of a bundle must use the bundle's names (and `reseatMember`, its
// parameters and `window.Steward.*` all survive, being a method name, parameters and property reads).
function grab(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, or rebuild');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
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

function reseater(refuse = []) {
  const body = grab(STEWARD, 'async reseatMember(oldPub, newPub, o) {');
  const calls = [];
  const setter = (name) => async (...args) => {
    calls.push({ name, args });
    return refuse.includes(name) ? false : { id: name + '-evt' };
  };
  const Steward = {};
  for (const n of ['setReseats', 'setAdmitted', 'setMinors', 'setApproved', 'setBlocked', 'setGuardians']) Steward[n] = setter(n);
  Steward.notifyGuardianList = async (...args) => { calls.push({ name: 'notifyGuardianList', args }); return true; };
  Steward.refreshClearances = async (...args) => {
    calls.push({ name: 'refreshClearances', args });
    return refuse.includes('refreshClearances')
      ? { results: [], failed: 1, skipped: 0, total: 1, unverified: false, pending: 0 }
      : { results: [], failed: 0, skipped: 0, total: 1, unverified: false, pending: 0 };
  };
  const scope = {
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x).toLowerCase() : null),
    now: () => Math.floor(Date.now() / 1000),
    window: { Steward },
  };
  const names = Object.keys(scope);
  const obj = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  return {
    run: (a, b, o) => obj.reseatMember(a, b, o),
    calls,
    // who the clearance re-seal was issued FOR, flattened across however many calls there were
    resealed: () => calls.filter(c => c.name === 'refreshClearances').flatMap(c => (c.args[0] || []).map(x => String(x).toLowerCase())),
    resealArgs: () => calls.filter(c => c.name === 'refreshClearances').map(c => c.args),
  };
}

// THE PARENT IS THE ONE RECONNECTED. Every existing re-seat test moves the CHILD; this direction had none.
const parentOld = K(), parentNew = K(), childK = K(), otherParent = K(), otherChild = K();
const parentReseat = () => ({
  reseats: [], admitted: [], minors: [childK, otherChild], approved: [], blocked: [],
  guardians: { [childK]: [parentOld, otherParent], [otherChild]: [otherParent] },
  guardiansClosed: {},
});

// ── the premise ─────────────────────────────────────────────────────────────
test('CONTROL: the link itself still moves to the new parent key', async () => {
  // Without this, everything below passes just as well over a re-seat that has stopped moving the link at
  // all — which is the bug reseatMember was written for in the first place.
  const r = reseater();
  const out = await r.run(parentOld, parentNew, parentReseat());
  const g = (r.calls.find(c => c.name === 'setGuardians') || {}).args;
  assert.ok(g, 'the re-seat published no guardian map at all');
  assert.ok((g[0][childK] || []).includes(parentNew),
    'the child’s parent list does not name the new parent key, so the link did not move');
  assert.equal(out.guardiansCarried, true);
});

test('CONTROL: the old parent key is KEPT on the link — the fail-closed half, unchanged', async () => {
  // Deliberate, and recorded in reseatMember: "the old key stays ON the safeguarding lists rather than being
  // removed: that half fails closed, and a key nobody holds costs nothing." A stolen old phone is handled by
  // the `blockOld` tickbox at step (1), not by trimming the list. Pinned so a later change has to argue with
  // it rather than silently drop it.
  const r = reseater();
  await r.run(parentOld, parentNew, parentReseat());
  const g = (r.calls.find(c => c.name === 'setGuardians') || {}).args;
  assert.ok((g[0][childK] || []).includes(parentOld),
    'the old parent key was dropped from the link. That is the OPEN direction: a parent whose new key has not ' +
    'yet reached their child’s phone would have no route to them at all');
});

// ── the gap ─────────────────────────────────────────────────────────────────
test('THE CHILD’S OWN CLEARANCE IS RE-ISSUED when their parent is reconnected', async () => {
  const r = reseater();
  await r.run(parentOld, parentNew, parentReseat());
  const who = r.resealed();
  assert.ok(who.includes(childK.toLowerCase()),
    'the parent was reconnected and the CHILD’S phone was never told. Its `myGuardians` comes only from its ' +
    'own sealed clearance; the church’s guardians: map is refused to a child by the relay, a guardnotice is ' +
    'addressed to parents only, and the reseat: map is not consulted by myGuardians. So the child goes on ' +
    'naming a key nobody holds and canDMPeer refuses the real parent. Re-sealed for: ' + JSON.stringify(who));
  assert.ok(who.includes(parentNew.toLowerCase()),
    'the re-seated member’s own clearance stopped being re-issued — that half was already right');
});

test('…and that clearance NAMES THE NEW PARENT KEY, which is the fact the child needs', async () => {
  // Re-sealing the child with a map that still says the old key would be the same bug with an extra publish.
  const r = reseater();
  await r.run(parentOld, parentNew, parentReseat());
  const args = r.resealArgs().find(a => (a[0] || []).map(x => String(x).toLowerCase()).includes(childK.toLowerCase()));
  assert.ok(args, 'no re-seal covered the child');
  const map = args[3] || {};
  const parents = (map[childK] || []).map(x => String(x).toLowerCase());
  assert.ok(parents.includes(parentNew.toLowerCase()),
    'the child’s clearance was re-issued from a guardian map that does NOT name the new parent key, so their ' +
    'phone is sealed the old answer a second time. Parents in the map: ' + JSON.stringify(parents));
});

test('A CHILD WHOSE PARENT WAS NOT TOUCHED IS LEFT ALONE', async () => {
  // Default-deny does not mean re-publish everything. `created_at` is whole seconds and the relay refuses the
  // loser of a tie on its NIP-01 tie-break, so a re-seal nobody needs is not free: it is a refusal that the
  // console shows the steward as a child who did not receive their safeguarding record (measured at 8 of 12
  // toggles before read-before-write was added). Only the children whose list actually changed.
  const r = reseater();
  await r.run(parentOld, parentNew, parentReseat());
  const who = r.resealed();
  assert.ok(!who.includes(otherChild.toLowerCase()),
    'a child whose parent list did not change was re-sealed anyway: ' + JSON.stringify(who));
  assert.ok(!who.includes(otherParent.toLowerCase()),
    'an untouched parent was re-sealed anyway: ' + JSON.stringify(who));
});

// ── point of use ──────────────────────────────────────────────────────────
test('THE SCREEN HANDS THE ENGINE THE LIVE GUARDIAN MAP — without it none of the above can fire', async () => {
  // A well-tested engine nobody is required to consult is not a feature. Every assertion above injects
  // `guardians` directly; this one runs the REAL ReseatModal.confirm out of the shipped app/stew-dashboard.jsx
  // and asserts what it passed. If the screen stops reading the guardian map, reseatMember's `g` is `{}`,
  // `relinkedChildren` is empty, and the fix above is dead code with six green tests over it.
  const { React } = miniReact();
  const seen = [];
  const src = fnBody(DASH, 'const confirm = async () => {', 'ReseatModal.confirm');
  const tmp = join(tmpdir(), 'reseatconfirm-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { confirm };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const globals = {
    React, Promise,
    newPub: parentNew, same: false, busy: false, member: parentOld, realName: 'Dapo Oyelaran',
    reseats: [], admittedList: [],
    sgNow: { minors: [childK], approved: [] },
    guardiansNow: { [childK]: [parentOld] },
    guardiansClosedNow: {},
    blockedNow: [], taken: false,
    rostersNow: [], rotasNow: [], careTeamIdNow: '',
    setBusy: () => {}, setErr: () => {}, setRes: () => {}, setDone: () => {},
    window: { Steward: { reseatMember: async (a, b, o) => { seen.push({ a, b, o }); return {}; } } },
  };
  const keys = Object.keys(globals);
  globalThis.__reseatconfirm = globals;
  const preamble = keys.map(k => `const ${k} = globalThis.__reseatconfirm.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  await mod.confirm();
  assert.equal(seen.length, 1, 'the Reconnect screen did not call reseatMember at all');
  const passed = seen[0].o.guardians || {};
  assert.ok((passed[childK] || []).includes(parentOld),
    'the Reconnect screen handed the engine a guardian map that does not contain the live link. reseatMember ' +
    'then has nothing to move and nobody to re-seal, and every other test in this file still passes. Got: ' +
    JSON.stringify(passed));
});
