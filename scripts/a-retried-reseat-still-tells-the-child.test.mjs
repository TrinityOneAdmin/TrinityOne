// A RECONNECTION THE STEWARD HAD TO PRESS TWICE MUST STILL TELL THE CHILD, AND MUST SAY WHOSE PHONE IS BEHIND.
//   Run: node --test scripts/a-retried-reseat-still-tells-the-child.test.mjs
//
// Two defects, both measured on cbdb85a, both in the code that cbdb85a itself added.
//
// (1) A RETRY LOST THE CHILD. `relinkedChildren` collected a child only when
//         parents.indexOf(oldH) !== -1 && parents.indexOf(newH) === -1
//     — "the link changed on this run". Run 1 of a re-seat can get PAST setGuardians, so the new key is on
//     the child's list, and then be refused at setReseats or setAdmitted and throw: `created_at` is whole
//     seconds, reseatMember rewrites four replaceable church documents, the relay refuses the loser of a
//     NIP-01 tie, and `w()` gives exactly ONE retry. The steward presses Reconnect again. Run 2 sees the new
//     key already on the link, collects NOTHING, and the child is never told — the exact gap cbdb85a exists
//     to close, surviving a retry. Measured (case D): with g[child] = [oldKey, newKey], setGuardians was not
//     called and refreshClearances got [newH] only.
//     THE FIX: the map write stays conditional on the link actually changing; the RE-SEAL is collected for
//     every child this parent is on, either way. A re-seal the child already holds is idempotent
//     (refreshClearances de-dupes per member and skips on read-before-write); a re-seal missed is a child who
//     cannot reach their parent.
//
// (2) `failed:['clearance']` CONFLATED TWO PHONES. cbdb85a widened the re-seal from [newH] to
//     [newH, ...relinkedChildren] but left both sharing one aggregate result, so a CHILD's failure made
//     ReseatModal print "their parent link moved across with them, though their NEW PHONE has not confirmed
//     it yet" — about the re-seated member's phone, not the child's — with nothing naming the one person who
//     could no longer reach their parent. Measured (case G). Before cbdb85a that sentence was true, because
//     [newH] was the only entry.
//     THE FIX: two calls, 'clearance' for the member and 'childclearance' + a count for the children.
//
// HOW THIS ASSERTS. `reseatMember` is lifted out of the SHIPPED vendor/steward.js by brace-match and RUN
// — the same instrument as scripts/reseat-write-results.test.mjs and
// scripts/a-reseated-parent-can-still-message-their-own-child.test.mjs, and for the same reason: the claims
// are about what the function does, not how its source is spelled. The bundle, not src/, because esbuild
// renames locals — so a sabotage left unbuilt would measure the old artefact and report a pass over broken
// code (CLAUDE.md, "a silent build failure makes sabotage pass").
//
// POINT OF USE. The last two tests RUN the shipped screen: the done-screen paragraph is sliced out of
// ReseatModal in app/stew-dashboard.jsx and RENDERED, so the sentence going missing from the SCREEN reddens
// this file, not only the engine losing the flag. Nothing here matches text in the .jsx (CLAUDE.md rule 3):
// app/*.jsx ships unbundled, so `false && ` would leave every word in place and a text match would pass.
//
// MEASURED RED/GREEN, 2026-10-13. Each sabotage scoped to the ENCLOSING FUNCTION, the anchor asserted to
// occur exactly ONCE inside that slice before the edit, the bundle REBUILT for each src/ case and again
// after the restore, and the source restored byte-for-byte (git status clean):
//   · the shipped engine and screen                                                  11 pass /  0 fail
//   · reseatMember: `if (parents.indexOf(oldH) === -1) continue;` + the push after it,
//     put back to the old two-term condition with the push inside it
//     (the retry defect restored)                                                     10 pass /  1 fail
//   · reseatMember: `failed.push('childclearance')` -> `failed.push('clearance')`     10 pass /  1 fail
//   · ReseatModal: `{res && res.failed && res.failed.includes(` -> `{false && …`, so
//     the child sentence never renders                                                10 pass /  1 fail
//   · ReseatModal.confirm: the blind-re-seat refusal -> `if (false) {`               10 pass /  1 fail
//
// AND THE ONE THAT SHOWS WHY THIS FILE HAD TO EXIST: under the FIRST sabotage,
// scripts/a-reseated-parent-can-still-message-their-own-child.test.mjs — the six tests cbdb85a shipped for
// this very feature — stayed at 6 pass / 0 fail. Every one of them drives a FIRST attempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const OLD = 'a1'.repeat(32), NEW = 'a2'.repeat(32), KID = 'c1'.repeat(32), KID2 = 'c2'.repeat(32);

// Brace-match the shipped function out of the BUNDLE (comment- and quote-aware).
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

// `clearanceFails(who)` -> true makes THAT re-seal come back with a failure. `who` is the first argument of
// the refreshClearances call, which is what the two calls are distinguished by.
function reseater({ clearanceFails = () => false } = {}) {
  const body = grab(STEWARD, 'async reseatMember(oldPub, newPub, o) {');
  const calls = [];
  const setter = (name) => async (...args) => { calls.push({ name, args }); return { id: name + '-evt' }; };
  const Steward = {};
  for (const n of ['setReseats', 'setAdmitted', 'setMinors', 'setApproved', 'setBlocked', 'setGuardians']) Steward[n] = setter(n);
  Steward.notifyGuardianList = async (...args) => { calls.push({ name: 'notifyGuardianList', args }); return true; };
  Steward.refreshClearances = async (...args) => {
    calls.push({ name: 'refreshClearances', args });
    const bad = clearanceFails(args[0] || []);
    return { results: [], failed: bad ? 1 : 0, skipped: 0, total: 1, unverified: false, pending: 0 };
  };
  const scope = {
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x).toLowerCase() : null),
    now: () => Math.floor(Date.now() / 1000),
    window: { Steward },
  };
  const names = Object.keys(scope);
  const obj = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  return {
    run: (o) => obj.reseatMember(OLD, NEW, o),
    calls,
    named: (n) => calls.filter(c => c.name === n),
    resealed: () => calls.filter(c => c.name === 'refreshClearances').flatMap(c => (c.args[0] || []).map(x => String(x).toLowerCase())),
  };
}

const opts = (guardians) => ({ name: 'Dapo Oyelaran', reseats: [], admitted: [OLD], minors: [KID], approved: [], guardians, guardiansClosed: {}, blocked: [] });

// ── (1) the retry ─────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: a FIRST re-seat moves the link and re-seals the child', async () => {
  // Without this, every assertion below passes just as well over an engine that re-seals nobody.
  const r = reseater();
  const res = await r.run(opts({ [KID]: [OLD] }));
  assert.equal(r.named('setGuardians').length, 1, 'the parent link was not moved to the new key at all');
  assert.ok(r.resealed().includes(KID), 'the child was not re-sealed on a first run: ' + JSON.stringify(r.resealed()));
  assert.equal(res.childrenToldOf, 1, 'the result does not report the child it re-sealed');
});

test('A RETRY, with the new key ALREADY on the link, STILL re-seals the child', async () => {
  // This is the defect. Run 1 landed setGuardians and was then refused further down and threw; run 2 sees
  // the link already carrying the new key. The child's phone has no other way to learn it: its answer is
  // `myGuardians`, read only from its own sealed clearance, and the church's guardians: map is never served
  // to a child.
  const r = reseater();
  const res = await r.run(opts({ [KID]: [OLD, NEW] }));
  assert.ok(r.resealed().includes(KID),
    'A RETRIED RECONNECTION LEFT THE CHILD ON THE DEAD PARENT KEY. The steward pressed Reconnect twice — ' +
    'which the same-second tie this function documents makes routine — and the child was told on neither ' +
    'press. Re-sealed: ' + JSON.stringify(r.resealed()));
  assert.equal(res.childrenToldOf, 1, 'the result does not report the child it re-sealed: ' + JSON.stringify(res));
});

test('a retry does NOT republish the guardian map it does not need to change', async () => {
  // The other half of the same decision. `created_at` is whole seconds and the relay refuses the loser of a
  // NIP-01 tie, so a document republished for nothing is a refusal the console shows the steward.
  const r = reseater();
  await r.run(opts({ [KID]: [OLD, NEW] }));
  assert.equal(r.named('setGuardians').length, 0,
    'the retry rewrote the guardian document although the link was already correct: ' +
    JSON.stringify(r.named('setGuardians').map(c => c.args[0])));
});

test('a child this parent is NOT on is never re-sealed', async () => {
  // The guard against over-collecting: a re-seal for an unrelated child is a safeguarding document published
  // about somebody the press had nothing to do with.
  const r = reseater();
  await r.run(opts({ [KID]: [OLD, NEW], [KID2]: ['f1'.repeat(32)] }));
  assert.ok(!r.resealed().includes(KID2),
    'a child with no link to this parent was re-sealed: ' + JSON.stringify(r.resealed()));
});

// ── (2) whose phone did not confirm ───────────────────────────────────────────────────────────────────────
test('THE CHILD’S PHONE FAILING IS REPORTED AS THE CHILD’S, NOT AS THE MEMBER’S', async () => {
  const r = reseater({ clearanceFails: (who) => who.includes(KID) && !who.includes(NEW) });
  const res = await r.run(opts({ [KID]: [OLD] }));
  assert.ok(res.failed.includes('childclearance'),
    'a child whose phone was not told is not reported at all, so the steward cannot know: ' + JSON.stringify(res.failed));
  assert.ok(!res.failed.includes('clearance'),
    'the CHILD’S failure was filed against the re-seated member’s own new phone, which is what the screen ' +
    'then describes — the one person who can no longer reach their parent goes unmentioned: ' + JSON.stringify(res.failed));
  assert.equal(res.childrenNotTold, 1, 'the count the screen needs to write the sentence is wrong: ' + JSON.stringify(res));
});

test('THE MEMBER’S OWN PHONE FAILING IS STILL REPORTED AS THEIRS', async () => {
  const r = reseater({ clearanceFails: (who) => who.includes(NEW) });
  const res = await r.run(opts({ [KID]: [OLD] }));
  assert.ok(res.failed.includes('clearance'),
    'the re-seated member’s own phone failing is no longer reported: ' + JSON.stringify(res.failed));
  assert.ok(!res.failed.includes('childclearance'),
    'the member’s failure was blamed on a child: ' + JSON.stringify(res.failed));
  assert.equal(res.childrenNotTold, 0, 'a child was reported as uncontacted when their re-seal succeeded');
});

// ── point of use: the screen the steward actually reads ───────────────────────────────────────────────────
// The done-screen paragraph, sliced out of ReseatModal and RENDERED. Found by walking out from the first
// statement about `res` to the enclosing <p> — so deleting the sentence fails this file, and so does
// deleting the paragraph.
const MODAL = fnBody(DASH, 'function ReseatModal(', 'ReseatModal');
function donePara() {
  const anchor = '{res && (res.minorCarried';
  const at = MODAL.indexOf(anchor);
  assert.notEqual(at, -1, 'the Reconnect done-screen paragraph is gone — re-anchor this test rather than deleting it');
  assert.equal(MODAL.indexOf(anchor, at + 1), -1, anchor + ' appears twice in ReseatModal');
  const open = MODAL.lastIndexOf('<p ', at);
  const close = MODAL.indexOf('</p>', at);
  assert.ok(open !== -1 && close !== -1, 'could not find the paragraph around ' + anchor);
  return MODAL.slice(open, close + 4);
}

async function renderDone(res) {
  const { React } = miniReact();
  const src = 'const P = (res) => (\n' + donePara() + '\n);\nexport { P };\n';
  const tmp = join(tmpdir(), 'reseatdone-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__reseatdone_' + Math.random().toString(36).slice(2);
  globalThis[key] = { React };
  const mod = await import('data:text/javascript;base64,' + Buffer.from('const React = globalThis.' + key + '.React;\n' + js).toString('base64'));
  return texts(mod.P(res)).join(' ').replace(/\s+/g, ' ');
}

test('THE SCREEN NAMES THE CHILD’S PHONE, and does not claim the member’s phone is behind', async () => {
  const words = await renderDone({ minorCarried: false, clearedCarried: false, guardiansCarried: true,
    teamsMoved: 0, rotasMoved: 0, childrenToldOf: 1, childrenNotTold: 1, failed: ['childclearance'] });
  assert.match(words, /child’s phone/i,
    'the Reconnect screen says nothing about the child whose phone was not told, so the one person who can ' +
    'no longer reach their parent is never mentioned. It said: ' + JSON.stringify(words));
  assert.match(words, /can’t message each other|cannot message each other/i,
    'the screen does not say what the consequence is: ' + JSON.stringify(words));
  assert.doesNotMatch(words, /their new phone has not confirmed it yet/i,
    'a CHILD’S failure is still described as the re-seated member’s own new phone being behind: ' + JSON.stringify(words));
  assert.match(words, /and their new phone has been told/i,
    'the member’s own phone DID confirm and the screen no longer says so — `failed.includes(\'clearance\')` ' +
    'is an exact array match, so the new \'childclearance\' entry must not satisfy it: ' + JSON.stringify(words));
  // The paragraph's other discrimination, /^(team|careteam|rota)/, must not catch the new entry either.
  assert.doesNotMatch(words, /serving places could not be moved/i,
    'the new \'childclearance\' entry is being read as a failed team or rota move, so the screen now blames ' +
    'the serving lists for a child’s phone: ' + JSON.stringify(words));
});

test('THE SCREEN SAYS NOTHING ABOUT A CHILD when every phone confirmed', async () => {
  // A sentence that appears when nothing is wrong is as bad as one that never appears.
  const words = await renderDone({ minorCarried: false, clearedCarried: false, guardiansCarried: true,
    teamsMoved: 0, rotasMoved: 0, childrenToldOf: 1, childrenNotTold: 0, failed: [] });
  assert.doesNotMatch(words, /child’s phone/i, 'the screen warns about a child whose phone was told: ' + JSON.stringify(words));
  assert.match(words, /and their new phone has been told/i, 'the success sentence is gone: ' + JSON.stringify(words));
});

// ── (3) the screen must not re-seat while it is blind to the parent links ─────────────────────────────────
// `window.useStewardGuardians()` is a subscription with NO loaded flag and a default of { links: {} }, so an
// empty map means "not arrived" and "this church has confirmed no links" alike. Measured (case E): handed
// guardians:{}, reseatMember writes no guardian map and re-seals [newH] only -- the parent link stays on the
// DEAD key and the child's phone is never told. That is the same gap by a different door, and it is reachable
// because a steward can open Reconnect the moment the console paints.
//
// So confirm() refuses when the map it holds is EMPTY and `minorsKnown` cannot vouch for that emptiness --
// the same evidence the clearance back-fill uses, and the guardian map rides the same subscription
// (subscribeSafeguard: "the guardian map rides here rather than on its own subscription"). Only when empty: a
// non-empty map has provably arrived. And NOT on a delegated console, which the relay never serves these
// documents to at all -- gating that would delete the Reconnect capability the relay does accept from it.
async function pressConfirm({ guardiansNow, sgNow, actingChurch = '' }) {
  const { React } = miniReact();
  const seen = [], errs = [];
  const src = fnBody(DASH, 'const confirm = async () => {', 'ReseatModal.confirm');
  const tmp = join(tmpdir(), 'blindreseat-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { confirm };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const globals = {
    React, Promise,
    newPub: NEW, same: false, busy: false, member: OLD, realName: 'Dapo Oyelaran',
    reseats: [], admittedList: [],
    sgNow, guardiansNow, guardiansClosedNow: {},
    blockedNow: [], taken: false,
    rostersNow: [], rotasNow: [], careTeamIdNow: '',
    setBusy: () => {}, setErr: (e) => errs.push(e), setRes: () => {}, setDone: () => {},
    window: { Steward: { actingChurch, reseatMember: async (a, b, o) => { seen.push({ a, b, o }); return {}; } } },
  };
  const key = '__blindreseat_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  await mod.confirm();
  return { seen, errs };
}

test('A RE-SEAT IS REFUSED while the console cannot tell "no parent links" from "not arrived yet"', async () => {
  const r = await pressConfirm({ guardiansNow: {}, sgNow: { minors: [], approved: [] } });
  assert.equal(r.seen.length, 0,
    'the screen re-seated a member while blind to the parent links, so a child’s link stays on the dead key ' +
    'and their phone is never told — and the done screen reports it all as moved');
  assert.equal(r.errs.length, 1, 'the refusal said nothing to the steward: ' + JSON.stringify(r.errs));
  assert.match(r.errs[0], /parent and child links/i, 'the refusal does not say what is missing: ' + JSON.stringify(r.errs[0]));
  assert.match(r.errs[0], /try again/i, 'the refusal does not say what to do next: ' + JSON.stringify(r.errs[0]));
});

test('CONTROL: a church that has honestly confirmed NO parent links can still reconnect', async () => {
  // minorsKnown true with an empty map is a real answer from an authenticated relay. Refusing here would
  // break Reconnect for every church with no linked children, which is most of them.
  const r = await pressConfirm({ guardiansNow: {}, sgNow: { minors: [], approved: [], minorsKnown: true } });
  assert.equal(r.seen.length, 1, 'a church with no parent links can no longer reconnect anybody: ' + JSON.stringify(r.errs));
});

test('CONTROL: a DELEGATED console, which the relay never serves these documents to, is unchanged', async () => {
  // The relay serves minors:/guardians: to the church key or a safeguarding steward alone, so a steward
  // holding only `members` can never satisfy minorsKnown — and Reconnect is a capability the relay does
  // accept from them (gateway.mjs, RESEAT_D). Gating them would delete a shipped feature, not close a hole.
  const r = await pressConfirm({ guardiansNow: {}, sgNow: { minors: [], approved: [] }, actingChurch: 'ff'.repeat(32) });
  assert.equal(r.seen.length, 1, 'a delegated steward can no longer reconnect a member who lost their words');
});
