// A SCREEN MUST NOT ANSWER A SAFEGUARDING QUESTION IT CANNOT YET ANSWER.
// Run: node --test scripts/safeguarding-lists-fail-closed-while-loading.test.mjs
//
// AUDIT 2026-09-02 #3, #17-checkin, #24. The safeguarding lists arrive over a subscription, so for the
// first moments of every console mount the minors list is EMPTY — and an empty set answers "is this from a
// child?" with "no" exactly as confidently as a loaded one does. A care request arriving in that window was
// filed with the adults, under the "Set up help" button, and that button publishes a NEED which the whole
// congregation reads and signs up to. A child's private disclosure becomes a notice-board item with their
// name on it, and nothing about the screen looks wrong.
//
// THE SIGNAL HAD TO BE CHOSEN CAREFULLY, and this file exists as much for that as for the bug. The obvious
// gate is `loaded`, and `loaded` is WRONG here: it is `sawMinors && sawEose`, it exists for the clearance
// back-fill where being wrong rewrites history, and it therefore never becomes true in a church that has
// never marked a child — no minors document is ever published. Gate these screens on `loaded` and every
// care request in such a church sits in the confidential section for ever, with no "Set up help" anywhere:
// the care module switched off, silently, in exactly the churches least likely to notice.
//
// So subscribeSafeguard now also emits `minorsKnown` — `sawMinors || (sawEose && authed)` — the same shape
// as the `clearedKnown` beside it, and for the same stated reason. The third test below is the one that
// guards that decision, and it is the test I would keep if I could keep only one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function loadFrom(file, name, anchor, globals) {
  const src = fnBody(readFileSync(join(ROOT, file), 'utf8'), anchor, name);
  const tmp = join(tmpdir(), 'sgfc-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__sgfc_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

const CHILD = 'c0ffee'.padEnd(64, '0');
const REQ = { id: 'r1', from: CHILD, type: 'meal', forSelf: true, note: 'please can someone help', sealed: false, status: 'open' };

async function careRequests(sg) {
  const { React, draw } = miniReact();
  const Comp = await loadFrom('app/stew-meals.jsx', 'StewCareRequests', 'function StewCareRequests()', {
    React,
    window: {
      useStewardSafeguard: () => sg,
      useStewardChurch: () => ({}),
      useStewardMembers: () => [{ pubkey: CHILD, name: 'Josh' }],
      // the requests arrive through a subscription started in an effect, so the component only has them
      // on its SECOND draw — which is why this renders twice below
      StewardMeals: {
        subscribeCareRequests: (cb) => { cb([REQ]); return () => {}; },
        declineCareRequest() {},
      },
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
    Icon: Stub('Icon'), SkPill: Stub('SkPill'),
    MEALS_TYPE_ICON: {}, mealsTypeLabel: () => 'Meal', mealsLbl: {},
    CareApproveModal: Stub('CareApproveModal'), CareChatModal: Stub('CareChatModal'),
    setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} },
  });
  draw(Comp, {});               // first draw starts the subscription
  const tree = draw(Comp, {});  // second draw sees the requests it delivered
  const setUpHelp = find(tree, n => n.type === 'button' && /Set up help/.test(texts(n).join(' ')));
  return { words: texts(tree).join(' '), setUpHelp };
}

test('WHILE THE LISTS ARE STILL ARRIVING, NO REQUEST GETS THE PUBLISH-A-NEED BUTTON', async () => {
  const r = await careRequests({ minors: [], approved: [], minorsKnown: false });
  assert.equal(r.setUpHelp.length, 0,
    'a care request was offered "Set up help" before the console knew who the children are. That control ' +
    'publishes a need the whole congregation reads — if the request was a child’s, their disclosure has ' +
    'just been put on the notice board under their name');
  assert.doesNotMatch(r.words, /FROM A YOUNG PERSON/,
    'the console asserted these requests ARE from a young person while it was still checking. Do not fix ' +
    'a lie in one direction with a lie in the other — say it is checking');
  assert.match(r.words, /CHECKING WHO THESE ARE FROM/,
    'the section gives no honest account of why it is holding these back');
});

test('A REQUEST FROM A CHILD STAYS CONFIDENTIAL ONCE THE LISTS ARE KNOWN', async () => {
  const r = await careRequests({ minors: [CHILD], approved: [], minorsKnown: true });
  assert.equal(r.setUpHelp.length, 0, 'a child’s request was offered the publish-a-need button');
  assert.match(r.words, /FROM A YOUNG PERSON/);
});

// THE ONE THAT GUARDS THE DESIGN DECISION.
test('A CHURCH THAT HAS NEVER MARKED A CHILD STILL HAS A WORKING CARE MODULE', async () => {
  // minors: [] and minorsKnown: true is the normal, permanent state of such a church — the relay has
  // answered, there is simply nobody on the list. `loaded` would be FALSE here for ever (it needs the
  // minors DOCUMENT, which is never published), so gating on `loaded` would hide every request behind the
  // confidential heading and remove every "Set up help" in the church, permanently.
  const r = await careRequests({ minors: [], approved: [], minorsKnown: true });
  assert.equal(r.setUpHelp.length, 1,
    'an adult’s request in a church that has never marked a child got no "Set up help". If this fails ' +
    'after a change to the gate, the gate is probably back on `loaded` — read subscribeSafeguard’s note');
  assert.doesNotMatch(r.words, /FROM A YOUNG PERSON|CHECKING WHO THESE ARE FROM/,
    'a church with no children marked is showing a confidential section it should not have at all');
});

test('CHECK-IN SAYS WHICH EMPTY IT IS: no children marked, or the list has not arrived', async () => {
  const render = async (sg) => {
    const { React, draw } = miniReact();
    const Comp = await loadFrom('app/stew-dashboard.jsx', 'DashCheckin', 'function DashCheckin()', {
      React,
      window: { useStewardCheckins: () => [], useStewardSafeguard: () => sg, useStewardGuardians: () => ({}),
                useStewardMembers: () => [], addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true },
      Icon: Stub('Icon'), Panel: function Panel(p) { return p.children; }, SkPill: Stub('SkPill'),
      DismissibleNote: Stub('DismissibleNote'), todayISO: () => '2026-09-03',
      setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} },
    });
    return texts(draw(Comp, {})).join(' ');
  };
  const loading = await render({ minors: [], minorsKnown: false });
  assert.doesNotMatch(loading, /No children marked yet/,
    'check-in told a leader at the door that the church has marked no children, when the list had simply ' +
    'not arrived — they go looking in Members for records that are already there');
  assert.match(loading, /Loading the children’s list/);
  const empty = await render({ minors: [], minorsKnown: true });
  assert.match(empty, /No children marked yet/,
    'a church that really has marked nobody must still get the instruction that tells it what to do');
});

test('A YOUNG PERSON IS NOT TOLD TO ASK PEOPLE WHO DO NOT EXIST', async () => {
  const render = async (approved) => {
    const { React, draw } = miniReact();
    const Comp = await loadFrom('app/screens-chat.jsx', 'RestrictedExplainer', 'function RestrictedExplainer(', {
      React, Icon: Stub('Icon'),
      setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} },
      window: { addEventListener() {}, removeEventListener() {} },
    });
    return texts(draw(Comp, { ctx: { safeguard: { isMinor: true, approved } }, onClose() {} })).join(' ');
  };
  const none = await render([]);
  assert.doesNotMatch(none, /ask one of them/,
    'a young person with nobody cleared in their church was told to "message anyone marked as a leader ... ' +
    'ask one of them". There is no one. An in-app instruction with nobody behind it is worse than silence');
  assert.match(none, /speak to them in person|hasn’t set up any checked adults/,
    'having removed the false instruction, the screen must still tell the young person what they CAN do');
  const some = await render(['a'.repeat(64), 'b'.repeat(64)]);
  assert.match(some, /ask one of them/,
    'a church that HAS cleared adults must keep the instruction — this fix is about the empty case only');
});

// ── THE COLD-START CASE, which the first version of this file missed entirely ──────────────────────────────
// Every test above passes `minorsKnown` explicitly. The hook's own PRE-SUBSCRIPTION default did not carry
// the key at all (`{ minors: [], approved: [] }` — app/steward-root.jsx), which is what every screen sees on
// its FIRST PAINT. Both consumers read an absent key as "known", so the bug this file is named for was still
// live at cold start, and these tests were green over it. Found by the batch 3-7 audit, 2026-09-03.
test('AN ABSENT minorsKnown IS NOT "KNOWN" — the first paint must fail closed', async () => {
  const r = await careRequests({ minors: [], approved: [] });   // no minorsKnown key at all
  assert.equal(r.setUpHelp.length, 0,
    'with the safeguarding answer missing entirely, a care request was still offered "Set up help" — the ' +
    'control that publishes a need to the whole congregation. An absent answer is not a "no"');
  assert.match(r.words, /CHECKING WHO THESE ARE FROM/);
});

test('…and check-in says loading rather than claiming the church marked nobody', async () => {
  const { React, draw } = miniReact();
  const Comp = await loadFrom('app/stew-dashboard.jsx', 'DashCheckin', 'function DashCheckin()', {
    React,
    window: { useStewardCheckins: () => [], useStewardSafeguard: () => ({ minors: [] }), useStewardGuardians: () => ({}),
              useStewardMembers: () => [], addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true },
    Icon: Stub('Icon'), Panel: function Panel(p) { return p.children; }, SkPill: Stub('SkPill'),
    DismissibleNote: Stub('DismissibleNote'), todayISO: () => '2026-09-03',
    setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} },
  });
  const words = texts(draw(Comp, {})).join(' ');
  assert.doesNotMatch(words, /No children marked yet/,
    'with no safeguarding answer at all, check-in told a leader at the door that the church has marked no ' +
    'children — a claim about the church made from a list that had not arrived');
  assert.match(words, /Loading the children/);
});

test('the hook default itself says the lists are not known yet', () => {
  // The source of the whole problem: this is what every screen is handed before the first callback.
  const root = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');
  const line = (root.split('\n').find(l => l.includes("makeSub(S, 'subscribeSafeguard'")) || '');
  assert.ok(line, 'useStewardSafeguard is no longer built with makeSub — re-anchor this test');
  assert.match(line, /minorsKnown:\s*false/,
    'the pre-subscription default does not carry minorsKnown:false, so every screen\'s first paint has to ' +
    'guess what an absent key means — and both consumers guessed the unsafe way once already');
});
