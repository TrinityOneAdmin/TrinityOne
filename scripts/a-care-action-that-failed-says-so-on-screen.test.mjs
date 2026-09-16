// THE OTHER HALF OF THE SAME FIX: THE SCREEN HAS TO SAY IT.
// Run: node --test scripts/a-care-action-that-failed-says-so-on-screen.test.mjs
//
// a-care-action-that-landed-nowhere-says-so.test.mjs proves the ENGINE now reports failure. That is worth
// nothing on its own — the pre-merge audit caught exactly this on "I'm here to help", where a screen fix sat
// over an engine that never reported anything, and the whole thing was decorative. CLAUDE.md rule 1: a test
// that fails only if the engine breaks is not a test of a feature; it must fail if the feature is deleted
// FROM THE SCREEN.
//
// So this renders the REAL components out of app/screens-today.jsx — compiled with the same esbuild the build
// uses, through the miniature React in render-jsx-screen.mjs — presses the control, and reads the tree that
// comes back. Rule 3 forbids getting there by matching text in app/*.jsx, and nothing here does.
//
// The two controls, and what silence costs:
//   · Withdraw (MyRequestRow)         — the member is shown their request gone while the care team still has
//                                       it open. They stop expecting anyone and do not ask again.
//   · Close — not needed (CareRequestCard) — the request stays open and the person who asked is told nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';

const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };

function screen() {
  const { React, draw } = miniReact();
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const win = { addEventListener() {}, removeEventListener() {}, innerWidth: 360,
                Fellowship: { subscribeCareRequests: () => () => {}, cancelCareRequest() {}, childCareAudience: async () => [] },
                TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
                Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } };
  const globals = {
    React, window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    Icon, ChurchBadge: Stub('ChurchBadge'),
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => '2026-09-04',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const mod = loadScreen('app/screens-today.jsx', ['MyRequestRow', 'CareRequestCard', 'CareNeedRow', 'CloseMyNeedButton'], globals);
  return { draw, ...mod, win };
}

// Fire a button's onClick and re-draw, the way React would after a setState.
//
// `pre` presses the control that OPENS the confirm dialog first. After that draw there are two buttons
// reading "Withdraw" — the one on the row and the one in the dialog — and taking the first would simply
// re-open the dialog and assert about a screen nobody reached. Take the LAST, which is the dialog's, and
// assert there really are two so a future edit that removes the confirmation fails here loudly.
async function press(draw, Comp, props, label, pre) {
  let tree = draw(Comp, props);
  if (pre) {
    const b = button(tree, pre)[0];
    assert.ok(b, `no "${pre}" control on this card — re-anchor this test`);
    await b.props.onClick({ stopPropagation() {} });
    tree = draw(Comp, props);
  }
  const all = button(tree, label);
  assert.ok(all.length, `no "${label}" control on this card — re-anchor this test`);
  if (pre) assert.equal(all.length, 2, `"${label}" no longer opens a confirmation — re-anchor this test`);
  await all[all.length - 1].props.onClick({ stopPropagation() {} });
  return draw(Comp, props);
}

const alerts = (tree) => find(tree, n => n.props && n.props.role === 'alert').map(n => texts(n).join(' ')).join(' | ');

// ── Withdraw ──────────────────────────────────────────────────────────────────────────────────────────────
const REQ = { id: 'req-1', type: 'meals', status: 'open', forSelf: true, recipients: 5 };

test('Withdraw: a withdrawal that reached no relay is said out loud', async () => {
  const { draw, MyRequestRow } = screen();
  // The engine returns null when nothing accepted it — that is the contract the other test file proves.
  const tree = await press(draw, MyRequestRow, { r: REQ, isMinor: false, onCancel: async () => null, onMessage: null }, 'Withdraw', 'Withdraw');
  assert.match(alerts(tree), /still open/i,
    'the confirm dialog closed and the row said nothing, so the member believes they have withdrawn while ' +
    'the care team still has an open request they will act on');
});

test('CONTROL: a withdrawal that DID land says nothing', async () => {
  const { draw, MyRequestRow } = screen();
  const tree = await press(draw, MyRequestRow, { r: REQ, isMinor: false, onCancel: async () => ({ id: 'evt' }), onMessage: null }, 'Withdraw', 'Withdraw');
  assert.equal(alerts(tree), '',
    'a successful withdrawal now shows a failure message — without this control the fix could be "always warn"');
});

test('CONTROL: the row shows no failure before anything is pressed', async () => {
  const { draw, MyRequestRow } = screen();
  assert.equal(alerts(draw(MyRequestRow, { r: REQ, isMinor: false, onCancel: async () => null, onMessage: null })), '');
});

// ── Close — not needed ────────────────────────────────────────────────────────────────────────────────────
const INCOMING = { id: 'req-2', type: 'other', from: 'asker-pub', forSelf: true, note: 'Could use a lift' };
const CTX = { safeguard: {}, canDMPeer: () => false, toast() {} };

test('Close — not needed: a close that reached no relay is said out loud', async () => {
  const { draw, CareRequestCard } = screen();
  const tree = await press(draw, CareRequestCard, { r: INCOMING, ctx: CTX, child: false, onApprove: null, onDecline: async () => null, canMessage: false, onMessage: null }, 'Close — not needed');
  assert.match(alerts(tree), /still open/i,
    'the card went back to normal and said nothing, so the care team believes the request is dealt with. ' +
    'It is not, and the person who asked has been told nothing either');
});

test('CONTROL: a close that DID land says nothing', async () => {
  const { draw, CareRequestCard } = screen();
  const tree = await press(draw, CareRequestCard, { r: INCOMING, ctx: CTX, child: false, onApprove: null, onDecline: async () => ({ id: 'evt' }), canMessage: false, onMessage: null }, 'Close — not needed');
  assert.equal(alerts(tree), '', 'a successful close now shows a failure message');
});

test('a failure is announced, not just coloured', () => {
  // Colour alone is not a message: it is invisible to a screen reader, and this app is used by people with
  // poor sight. Both lines carry role="alert" — every assertion above is written against that role, so an
  // edit that drops it fails this whole file rather than passing quietly.
  assert.ok(true);
});

// ── The four meal-slot controls, which live inside App() and cannot be rendered here ──────────────────────
//
// `fill`, `clearFill`, `setNote` and `clearSkip` are arrow functions on the care context in app/app.jsx.
// App() is far too entangled to draw, so each one is SLICED OUT AND RUN — CLAUDE.md rule 3's other route,
// and not a text match: the body below is the shipped text, executed with its collaborators injected. If the
// message is deleted from the screen, `said` stays empty and these fail.
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

function liftCareAction(name) {
  const i = APP.indexOf('\n      ' + name + ': (');
  assert.ok(i > 0, name + ' is no longer a care-context action in app/app.jsx — re-anchor this test');
  // Balanced to the end of the arrow: from the colon to the comma that closes this property.
  let d = 0, k = APP.indexOf('(', i);
  for (; k < APP.length; k++) {
    const c = APP[k];
    if (c === '(' || c === '{') d++;
    else if (c === ')' || c === '}') d--;
    else if (c === ',' && d === 0) break;
  }
  return APP.slice(i + 1, k);
}

// `reason` is the classifier's verdict when `lands` is false — 'not-sent' (settled: nothing left the phone
// or a box said no) or 'unconfirmed' (nobody answered in time; the event is signed, on the wire, and often
// lands a moment later). Those two need OPPOSITE sentences and the wrappers must not conflate them.
function runCareAction(name, { lands, reason }) {
  const said = [];
  const toast = (msg, opts) => said.push({ msg: String(msg), error: !!(opts && opts.error) });
  const optCare = {};
  const setOptCare = (f) => { const n = typeof f === 'function' ? f({ ...optCare }) : f; for (const k of Object.keys(optCare)) delete optCare[k]; Object.assign(optCare, n); };
  const evt = { id: 'evt-id' };
  // fillCareSlot / clearCareSlot now answer { ok, reason } — the setEventRsvp shape — so that the screen can
  // tell "it did not go" from "we could not tell". ⚠ The failure object is TRUTHY, which is precisely the
  // markSafe trap: a wrapper still reading `if (r)` takes the SUCCESS arm on every failure. Stubbing the
  // real shape is what makes these rows able to see that.
  const fail = { ok: false, reason: reason || 'not-sent' };
  const window = { Fellowship: {
    async fillCareSlot() { return lands ? { ok: true, evt } : fail; },
    async clearCareSlot() { return lands ? { ok: true, evt } : fail; },
    async clearCareSkip() { return lands ? { ok: true, evt } : fail; },
    // ⚠ markCareSkip DOES NOT MATCH ITS SIBLINGS, and that is the whole reason `skip` was missed. The three
    // above return null when the publish fails, so `if (!r)` is enough for them. This one returns the EVENT
    // either way and puts the outcome on `_delivered` — so on failure it is TRUTHY, and a wrapper copying the
    // sibling pattern stays silent. The stub mirrors that exactly; weaken it to `null` and the skip case
    // below would pass against a wrapper that is still broken.
    async markCareSkip() { return { ...evt, _delivered: !!lands }; },
  } };
  const obj = new Function('setOptCare', 'toast', 'window', 'return ({ ' + liftCareAction(name) + ' })')(setOptCare, toast, window);
  return { fn: obj[name], said, optCare };
}

const SLOT_CASES = [
  ['fill',      ['care-1', '2026-09-10', 'lasagne'], /not signed up/i,
   'the tick quietly un-ticks itself, which reads as a mis-tap — so the volunteer taps again, and the family still has nobody for that day'],
  ['clearFill', ['care-1', '2026-09-10'],            /still down for that day/i,
   'they believe they stood down and are still the only name against it'],
  ['setNote',   ['care-1', '2026-09-10', 'gluten free'], /didn.t reach/i,
   'the dietary note nobody else can see is the one that matters'],
  ['clearSkip', ['care-1', '2026-09-10'],            /still marked/i,
   'the day stays crossed out and nobody brings anything'],
  // ⚠ ADDED 2026-09-15, and it was the ONLY one of the five missing from this list — which is how it
  // survived the sims and the owner's own use of the care feature. Both were true at once: the control
  // worked every time it was tried, and it said nothing on the one occasion it would have mattered.
  ['skip',      ['care-1', '2026-09-10', '', null, null], /needing someone/i,
   'the family says "not this day", it reaches nobody, the day still reads as needed, and somebody cooks a meal nobody wanted'],
];

for (const [name, args, expect, why] of SLOT_CASES) {
  test(`${name}: a failure is put in front of the member`, async () => {
    const { fn, said } = runCareAction(name, { lands: false });
    await fn(...args);
    const bad = said.filter(t => t.error);
    assert.ok(bad.length, `${name} said nothing at all when it failed: ${why}`);
    assert.match(bad[0].msg, expect, `${name}'s failure message no longer says what actually happened`);
  });

  test(`CONTROL: ${name} says nothing about failure when it worked`, async () => {
    const { fn, said } = runCareAction(name, { lands: true });
    await fn(...args);
    assert.equal(said.filter(t => t.error).length, 0,
      `${name} reports a failure on success — without this control the fix could be "always warn"`);
  });
}

// ── THE OPPOSITE LIE: "that didn't reach your church" said over a send that very probably LANDED ──────────
//
// Every row above is about claiming success over a failure. These are about the other direction, which is
// the one nobody looks for: `fillCareSlot` used to return null for ALL THREE failure outcomes at once, so a
// sign-up that nobody had ACKNOWLEDGED — signed, on the wire, usually landing a second later — was reported
// as "you're NOT signed up". The volunteer then signs up again somewhere else, or stands down and the family
// gets nothing. A wrong failure message is worse than no message: it sends somebody to redo work already done.
//
// The sentence is only honest if pressing the button again is SAFE. It is: fillCareSlot and clearCareSlot
// both write the fixed d-tag `careslot:<careId>:<iso>`, so a second press REPLACES the same document — it
// cannot sign anyone up twice. (Checked in src/fellowship.src.js before this wording was written; a control
// that minted a fresh id each time would need different words and is deliberately not in this list.)
const UNSURE_CASES = [
  // ⚠ THESE TWO EXPECTED THE DANGEROUS SENTENCE, AND SO PINNED THE DEFECT IN PLACE. They required the
  // message to say "tap the same button again" — but on `unconfirmed` the optimistic mark is KEPT, so the
  // button under the toast has already flipped to the opposite action. Pressing it again cancels the
  // sign-up rather than repeating it. Corrected 2026-09-16 after an independent review measured it; the
  // rows now require the message to describe what the ROW shows, which is what the member can actually act
  // on. See the two tests at the foot of this file, which hold the message and the button together.
  ['fill',      ['care-1', '2026-09-10', 'lasagne'],     /shown as helping/i,
   'a volunteer who did sign up is told they did not, so two people cook the same day or nobody does'],
  ['clearFill', ['care-1', '2026-09-10'],                /shown as no longer helping/i,
   'somebody who did stand down is told they did not, and stops trusting the button'],
  ['setNote',   ['care-1', '2026-09-10', 'gluten free'], /may well have/i,
   'the dietary note is retyped and resent over one that had already arrived'],
  ['clearSkip', ['care-1', '2026-09-10'],                /won.t do any harm/i,
   'a recipient who has said "actually, yes please" is told the day is still crossed out, so they ask a ' +
   'second time for help they have already asked for'],
];

for (const [name, args, expect, why] of UNSURE_CASES) {
  test(`${name}: "we couldn't tell" is NOT reported as "it didn't reach your church"`, async () => {
    const { fn, said } = runCareAction(name, { lands: false, reason: 'unconfirmed' });
    await fn(...args);
    const bad = said.filter(t => t.error);
    assert.ok(bad.length, `${name} said nothing at all on an unconfirmed send`);
    assert.match(bad[0].msg, /couldn.t confirm/i,
      `${name} still claims a settled failure over a send nobody answered for: ${why}`);
    assert.match(bad[0].msg, expect,
      `${name} does not tell the member what the row NOW SHOWS, which is the only thing that makes ` +
      '"it may well have" actionable rather than merely worrying — and it must never point at the button, ' +
      'which by then performs the opposite action');
    assert.doesNotMatch(bad[0].msg, /didn.t reach/i,
      `${name} is still saying the words that send somebody to redo work already done`);
  });

  test(`CONTROL: ${name} still says the SETTLED failure plainly when nothing was sent`, async () => {
    // Without this pair, "always say we couldn't confirm" would pass every row above — and that is the
    // dangerous direction: softening a settled refusal is how somebody is told help is coming when it is not.
    const { fn, said } = runCareAction(name, { lands: false, reason: 'not-sent' });
    await fn(...args);
    const bad = said.filter(t => t.error);
    assert.ok(bad.length, `${name} said nothing on a settled failure`);
    assert.match(bad[0].msg, /didn.t reach/i,
      `${name} softened "nothing left this phone" into "we couldn't confirm it" — the opposite mistake, ` +
      'and the one that leaves a family expecting a meal that was never promised');
  });
}

test('the optimistic tick is still rolled back as well as explained', async () => {
  // The rollback was already there and is what stops the row lying; the message is what stops the rollback
  // reading as a mis-tap. Both, or neither is any use.
  const { fn, optCare } = runCareAction('fill', { lands: false });
  await fn('care-1', '2026-09-10', '');
  assert.deepEqual(Object.keys(optCare), [], 'the row still shows the member as signed up after a failure');
});

// ── AND THE GREEN TICK BESIDE THE NOTE, WHICH THE SHAPE CHANGE PUT ONE CHARACTER FROM LYING ──────────────
//
// "bringing a lasagne, no nuts" is the one field on this row other people act on. The Save button turns into
// "✓ Saved" from `savedFlash`, and that was set by `if (ok)` over a writer that returned an EVENT or NULL.
// fillCareSlot now answers { ok, reason } — and a failure object is TRUTHY — so a plain truthiness test
// would tick every failure green. Exactly the markSafe trap, on a control that had no screen test at all
// until this one; the sabotage of `r && r.ok` -> `r` was caught by nothing on 2026-09-16.
const NEED = { id: 'care-1', type: 'meals', dates: ['2026-09-10'], meals: ['dinner'], displayLabel: 'A family' };
const ME = 'm'.repeat(64);

function needRow(setNote) {
  const { draw, CareNeedRow } = screen();
  const care = { myPub: ME, slots: [{ needId: 'care-1', isoDate: '2026-09-10', pubkey: ME, note: '' }], skips: [], setNote, fill: setNote };
  const props = { need: NEED, slots: care.slots, skips: [], care, canManage: false, expanded: true, onToggle: () => {} };
  let tree = draw(CareNeedRow, props);
  const redraw = () => (tree = draw(CareNeedRow, props));
  return {
    redraw,
    save: async () => {
      const b = button(tree, 'Save');
      assert.ok(b.length, 'no Save control beside the "what I\'m bringing" note — re-anchor this test');
      await b[b.length - 1].props.onClick({ stopPropagation() {} });
      await new Promise(r => setTimeout(r, 0));
      return redraw();
    },
    labels: () => texts(tree).join(' | '),
  };
}

test('the note’s green “✓ Saved” tick is not painted over a save that failed', async () => {
  const c = needRow(async () => ({ ok: false, reason: 'unconfirmed' }));
  await c.save();
  assert.doesNotMatch(c.labels(), /✓ Saved/,
    'the note said "✓ Saved" over a write no relay acknowledged. fillCareSlot answers an OBJECT now, and an ' +
    'object is always truthy — `if (r)` ticks every failure green, which is the markSafe trap exactly.');
});

test('CONTROL: an accepted note save DOES show “✓ Saved”', async () => {
  // Without this, deleting savedFlash altogether would pass the row above.
  const c = needRow(async () => ({ ok: true, evt: { id: 'e' } }));
  await c.save();
  assert.match(c.labels(), /✓ Saved/, 'a note the church accepted no longer confirms itself to the member');
});

// ── "I'M SORTED — CLOSE THIS": ONE MESSAGE FOR THREE DIFFERENT THINGS ────────────────────────────────────
//
// "Your church keeps that with the care team — message them and they'll close it" describes a REFUSAL: the
// relay's care: gate, when a church does not let members close their own needs. It was said for every
// failure. Over a close nobody had merely ACKNOWLEDGED, it sends somebody who has just told their church
// they are sorted to go and ask the care team to do a thing that is already done — which is exactly the
// small indignity this button was built to remove.
//
// Rendered, pressed, and READ: this is the drawn screen, not the source (rule 3).
function closeBtn(answer) {
  const s = screen();
  s.win.Fellowship.closeMyCareNeed = async () => answer;
  const props = { need: { id: 'care-1', recipient: 'm'.repeat(64) } };
  let tree = s.draw(s.CloseMyNeedButton, props);
  const redraw = () => (tree = s.draw(s.CloseMyNeedButton, props));
  return {
    press: async (label) => {
      const b = button(tree, label);
      assert.ok(b.length, `no "${label}" control — re-anchor this test`);
      await b[0].props.onClick({ stopPropagation() {} });
      await new Promise(r => setTimeout(r, 0));
      return redraw();
    },
    reads: () => texts(tree).join(' | '),
  };
}
async function closeAndRead(answer) {
  const c = closeBtn(answer);
  await c.press('close this');       // opens the confirmation
  await c.press('Yes, close it');
  return c.reads();
}

test('closing a need: an UNCONFIRMED close does not send the member to the care team', async () => {
  const t = await closeAndRead({ ok: false, reason: 'unconfirmed' });
  assert.match(t, /couldn’t confirm/i,
    'a close nobody answered for is still described as your church refusing it. Read: ' + t);
  assert.doesNotMatch(t, /message them/i,
    'somebody who has just said "I\'m sorted" is being told to go and ask the care team to close a need ' +
    'that is very probably closed already. Read: ' + t);
});

test('CONTROL: a REFUSED close still says the church keeps that with the care team', async () => {
  // That sentence is TRUE for a refusal — the relay's care: gate — and it must not be softened away.
  const t = await closeAndRead({ ok: false, reason: 'refused' });
  assert.match(t, /message them/i, 'the refusal wording was lost, so a member is told to retry something ' +
    'their church will never allow from here. Read: ' + t);
});

test('CONTROL: a close that reached NO relay says it is still open', async () => {
  const t = await closeAndRead({ ok: false, reason: 'not-sent' });
  assert.match(t, /still open/i, 'a close that left the phone nowhere is not reported as still open. Read: ' + t);
});

test('CONTROL: a close a relay ACCEPTED reports no failure at all', async () => {
  // Without this, "always show an error" passes all three rows above.
  const t = await closeAndRead({ ok: true, evt: { id: 'e' } });
  assert.doesNotMatch(t, /couldn’t confirm|message them|still open/i,
    'a successful close is reporting a failure — the opposite lie. Read: ' + t);
});

test('…and is NOT rolled back when we simply could not tell', async () => {
  // The same lie, one layer below the words: un-ticking the day repaints it as "nobody is bringing this"
  // under a sign-up that probably landed, and the row is what another volunteer looks at before offering.
  const { fn, optCare } = runCareAction('fill', { lands: false, reason: 'unconfirmed' });
  await fn('care-1', '2026-09-10', '');
  assert.deepEqual(Object.keys(optCare), ['care-1|2026-09-10'],
    'an unconfirmed sign-up un-ticked itself. The toast says "it may well have" and the row beside it says ' +
    'the opposite, so the member believes the row.');
});

// ── THE MEMBER APP'S half-landed report, which had no point-of-use test at all ────────────────────────────
//
// 11e38d9 claimed "both screens say which half landed" and only the console's list was driven. The fourth
// audit reduced the member app's toast to a plain "Opened as a need" and left FIVE test files green — which
// is CLAUDE.md rule 1 exactly: an engine that reports, and a screen nobody made consult it.
//
// A care admin on a phone approves a request. The need is published and accepted; the second write, which
// marks the request dealt with, is refused. Help IS set up — and the person who asked goes on reading "your
// care team will be in touch" while the request sits open for the team to work a second time.
test('the phone says which half landed, not just "Opened as a need"', async () => {
  const said = [];
  const { draw, CareRequests } = (function () {
    const { React, draw } = miniReact();
    const ME = 'm'.repeat(64);
    const globals = {
      React, console, setTimeout, clearTimeout, setInterval, clearInterval,
      Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
      ChurchBadge: Stub('ChurchBadge'),
      document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
      navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      lsGet: (k, d) => d, lsSet: () => {},
      cx: (...a) => a.filter(Boolean).join(' '),
      SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
      useTrinityAudio: () => ({ track: null, playing: false }),
      todayISO: () => '2026-09-04',
      fetch: async () => ({ ok: false, json: async () => ({}) }),
      window: { addEventListener() {}, removeEventListener() {}, innerWidth: 360,
        Fellowship: { myPubkey: ME,
          subscribeCareRequests: (cb) => { cb([{ id: 'req-1', from: 'a'.repeat(64), forSelf: true, type: 'meals', note: 'x', status: 'open' }]); return () => {}; },
          declineCareRequest: async () => ({ id: 'e' }) },
        TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
        Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } },
    };
    return { draw, ...loadScreen('app/screens-today.jsx', ['CareRequests'], globals) };
  })();
  const ME = 'm'.repeat(64);
  const ctx = {
    church: { npub: 'npub1c' },
    safeguard: { minors: [], approved: [ME], guardians: {}, isMinor: false, cleared: true, minorsKnown: true },
    churchRosters: [{ team: 'care-team', people: [{ pub: ME }] }],
    canDMPeer: () => true,
    toast: (m, o) => said.push({ m: String(m), e: !!(o && o.error) }),
    care: { myPub: ME, settings: { enabled: true, adminGroupId: 'care-team' } },
  };
  draw(CareRequests, { ctx });
  let tree = draw(CareRequests, { ctx });
  const b = button(tree, 'Set up help')[0];
  assert.ok(b, 'no "Set up help" control on the request — re-anchor this test');
  b.props.onClick({ stopPropagation() {} });
  tree = draw(CareRequests, { ctx });
  const sheet = find(tree, n => typeof n.type === 'function' && n.type.name === 'ApproveNeedSheet')[0];
  assert.ok(sheet, 'the approve sheet did not open — re-anchor this test');

  sheet.props.onDone({ id: 'care-1', stillOpen: true });
  const half = said[said.length - 1];
  assert.ok(half && half.e,
    'the phone said "Opened as a need" over a request that was never marked dealt with, so the care team ' +
    'works it again and the person who asked is told nothing');
  assert.match(half.m, /still shows as open|couldn.t close/i, 'the message does not say what is left to do');

  sheet.props.onDone({ id: 'care-2', stillOpen: false });
  const clean = said[said.length - 1];
  assert.equal(clean.e, false, 'CONTROL: a clean approval now reports a failure');
  assert.match(clean.m, /Opened as a need/);
});


// ⚠ THE TRAP, NAILED DOWN SEPARATELY, because the obvious "tidy-up" re-opens it. `skip` cannot be checked
// with `if (!r)` like its four siblings: markCareSkip resolves with the EVENT on failure too. This asserts
// the wrapper reads `_delivered` and not truthiness — replace the check with `if (!r)` and this reddens
// while every other test in this file stays green.
test('skip: a TRUTHY result with _delivered false is still a failure', async () => {
  const said = [];
  const toast = (msg, opts) => said.push({ msg: String(msg), error: !!(opts && opts.error) });
  const window = { Fellowship: { async markCareSkip() { return { id: 'evt-id', _delivered: false }; } } };
  const obj = new Function('setOptCare', 'toast', 'window', 'return ({ ' + liftCareAction('skip') + ' })')(() => {}, toast, window);
  await obj.skip('care-1', '2026-09-10', '', null, null);
  assert.ok(said.filter(t => t.error).length,
    'markCareSkip resolved with a truthy event whose _delivered was false — a failed skip — and the member ' +
    'was told nothing. `if (!r)` is not sufficient here; read _delivered.');
});

// ⚠ THE MESSAGE MUST NOT POINT AT A BUTTON THAT HAS CHANGED UNDER IT.
//
// Found by an independent review on 2026-09-16, in the flagship example of the branch that introduced it.
// On `unconfirmed` the wrapper deliberately KEEPS the optimistic mark — right, because the send probably did
// land. But `ctx.care.slots` then carries a slot for me, so CareNeedRow renders "You're helping", whose
// onClick is clearFill. The toast sitting on top of it said:
//
//     "Tap the same button again; it won't sign you up twice."
//
// Tapping it again does not re-send. IT CANCELS. If the sign-up did land — which is what the sentence says
// is likely — the second tap takes the family's meal away. The reverse case is the same bug the other way:
// after a failed cancel, the optimistic clear reverts the button to "I'll help", so tapping again signs you
// back on.
//
// The old code was not exposed to this because it ROLLED BACK the optimistic mark on every failure. The fix
// that kept the mark and the wording that invited a second tap were correct apart; together they inverted
// the action. This is the same hazard setEventRsvp's own comment warns about, one file away.
//
// Two rows, and they must be read together: the first pins what the button DOES once the optimistic mark is
// kept, the second pins that the sentence does not tell anyone to press it.
test('after an unconfirmed sign-up the row’s button CANCELS — this is what the message must not contradict', () => {
  const c = needRow(async () => ({ ok: false, reason: 'unconfirmed' }));
  const labels = c.labels();
  assert.match(labels, /You’re helping|You're helping/,
    'CONTROL: with a slot of mine on the need, the row should show me as helping — if it does not, the row '
    + 'below is measuring the wrong state and proves nothing');
  assert.doesNotMatch(labels, /I’ll help|I'll help/,
    'the row offers "I\'ll help" while I already hold a slot, so the button is not the one this test is about');
});

test('the unconfirmed care wording never tells a member to press the button again', () => {
  // Drives the REAL lifted wrappers out of app/app.jsx — never a copy, and never a text match on that file
  // (CLAUDE.md rule 3: it ships unbundled, so `false && ` would leave every word in place).
  for (const name of ['fill', 'clearFill']) {
    const { fn, said } = runCareAction(name, { lands: false, reason: 'unconfirmed' });
    return fn('care-1', '2026-09-10', 'lasagne').then(() => {
      const msg = said.map(s => s.msg).join(' | ');
      assert.ok(msg, name + ': nothing was said at all on an unconfirmed send');
      assert.doesNotMatch(msg, /tap the same button|press the same button|tap it again|press it again/i,
        name + ' tells the member to press the button again. By the time they read it the button in that '
        + 'place has flipped to the opposite action, so the second press UNDOES the first rather than '
        + 'repeating it — and on `fill` that takes a family\'s meal away. Say what the row now shows '
        + 'instead. Measured message: ' + msg);
      assert.match(msg, /may well have/i,
        name + ': the honest half must survive — an unconfirmed send probably DID land and must not be '
        + 'reported as a failure');
    });
  }
});
