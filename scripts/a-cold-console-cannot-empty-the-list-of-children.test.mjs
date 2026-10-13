// MARKING ONE CHILD MUST NOT TAKE EVERY OTHER CHILD OFF THE CHURCH'S LIST.
//   Run: node --test scripts/a-cold-console-cannot-empty-the-list-of-children.test.mjs
//
// THE DEFECT, measured on cbdb85a by rendering the real joinRow and pressing the real control:
//
//     WARM (the minors: document had arrived):  setMinors [['childAlice','childBen','joinerpubkey']]
//     COLD (it had not)                      :  setMinors [['joinerpubkey']]
//
// `window.Steward.setMinors` REPLACES the whole list, and `toggleMinor` built the list it sends out of
// `sg.minors` — which is `[]` on a console whose `minors:<churchpub>` document has not arrived yet. So the
// first press of "Child", of the phone sheet's "Mark as child", or of the join queue's "Approve as a child"
// published a list of ONE key and dropped every other child in the church.
//
// WHO IS HARMED: EVERY OTHER CHILD, not the one being marked.
//   · their keys leave `minors:`, so minorOf() is false for them at the relay and safeguardAllows()
//     (scripts/../scripts/gateway.mjs) lets ANY member open a private message with them;
//   · DashMembers' whole-roster back-fill then seals {minor:false} to each of their phones from the same
//     emptied list, and a member's app trusts its sealed clearance OVER the list fallback — so the damage
//     outlives the document being republished;
//   · the no-guardian / child pills come off their rows, so the console stops showing the steward that
//     anything is wrong.
//
// WHY IT IS REACHABLE AND NOT A THEORETICAL WINDOW. The join queue is gated on `joinApproval &&
// mRosterLoaded` — the MEMBER roster — not on the safeguarding subscription. `minors:` is served only to a
// NIP-42-authenticated reader, so it can arrive materially later than the roster. The queue is the TOP
// panel of the Members tab, and the whole purpose of "Approve as a child" is to be pressed at once, on a
// console the steward has just opened. The members-list "Child" button reaches the identical replace through
// the identical function, which is a hole that exists on main today.
//
// THE FIX. `toggleMinor` refuses the write until `sg.minorsKnown === true` and says so on the row. That is
// the same question ClearPersonModal already holds its own list behind, and `minorsKnown` rather than
// `loaded` for the reason subscribeSafeguard states: `loaded` is sawMinors && sawEose, permanently false in
// a church that has never marked a child, so gating on it would make the FIRST child in every church
// unmarkable. Fails CLOSED — the hook's own default carries no minorsKnown at all.
//
// WHAT IS REAL HERE. `joinRow`, `memberRow`, `admitMember` and `toggleMinor` are sliced out of the shipped
// app/stew-dashboard.jsx by brace-match (scripts/test-slice.mjs), compiled with the same esbuild the
// packaged build uses, and run in ONE scope — so each button's onClick calls the real toggleMinor, which
// calls the injected window.Steward. Nothing here matches text in the .jsx: app/*.jsx ships UNBUNDLED
// (CLAUDE.md rule 3), so `false && ` in front of the guard would leave every word of it in the file and any
// text assertion would still pass. The rows are RENDERED, the controls are found by their ACCESSIBLE NAME,
// and what reached window.Steward is asserted.
//
// AND THE COLD STATE IS THE ONE THE APP REALLY PRODUCES. `sg` here is exactly what
// `window.useStewardSafeguard()` emits before the document lands — minors [], minorsKnown absent — not an
// invented shape. The WARM cases carry two other children, so a shrink is visible as a shrink rather than
// as "nothing was written".
//
// MEASURED RED/GREEN, 2026-10-13. Each sabotage scoped to the ENCLOSING FUNCTION, the anchor asserted to
// occur exactly ONCE inside that slice before the edit, and the source restored byte-for-byte after
// (git status clean):
//   · the shipped console                                                          8 pass / 0 fail
//   · toggleMinor: `if (sg.minorsKnown !== true) {` -> `if (false) {`               4 pass / 4 fail
//   · toggleMinor: `sg.minorsKnown !== true` -> `sg.loaded !== true`                4 pass / 4 fail
//   · toggleMinor: the "Un-marking them will not put those links back." sentence
//     removed from the guardian notice                                              7 pass / 1 fail
// The second is the near-miss worth having: `loaded` is TRUE in the cold fixture, because it is a different
// question (sawMinors && sawEose), so a guard built on it lets the whole cold write through and the four
// COLD tests go red exactly as they do with no guard at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const PK = 'tamsinhexpubkey';
const NAME = 'Tamsin Oyelaran';
const KID_A = 'childalicepubkey';
const KID_B = 'childbenpubkey';

async function loadSlices(anchors, exportNames, globals) {
  const src = anchors.map(([anchor, what]) => fnBody(STEW, anchor, what)).join('\n');
  const tmp = join(tmpdir(), 'coldminors-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${exportNames.join(', ')} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__coldminors_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const tick = () => new Promise(r => setTimeout(r, 15));

// `warm`: the church's two existing children have arrived and the relay has answered while authenticated —
// `{ minors: [KID_A, KID_B], minorsKnown: true }`. `cold`: the subscription has started and the document has
// not landed — `{ minors: [], minorsKnown: undefined }`, which is what the hook really emits. `loaded` is
// TRUE in the cold fixture on purpose: it is a different question (sawMinors && sawEose) and a console can
// hold it while still knowing nothing, so a guard built on it would let this write through.
function sgFor(warm, { marked = false, guardianOf = null } = {}) {
  const minors = warm ? [KID_A, KID_B] : [];
  if (marked) minors.push(PK);
  return {
    loaded: true, clearedKnown: true, cleared: {},
    minors, approved: [], nophoto: [],
    ...(warm ? { minorsKnown: true } : {}),
    _guardianOf: guardianOf,
  };
}

// One screen, with whichever row the test wants, over a church whose safeguarding state we set.
async function screen({ warm, row = 'join', marked = false, guardianOf = null }) {
  const { React } = miniReact();
  const wrote = [];
  const calls = { notice: [], reseal: [] };
  const sg = sgFor(warm, { marked, guardianOf });
  const guardians = guardianOf ? { [guardianOf]: [PK] } : {};
  const parentSet = new Set(); Object.values(guardians).forEach(ps => ps.forEach(p => parentSet.add(p)));
  const win = {
    Steward: {
      setMinors: (l) => { wrote.push(['minors', l]); return true; },
      setAdmitted: (l) => { wrote.push(['admitted', l]); return true; },
      setApproved: (l, o) => { wrote.push(['approved', l, o]); return true; },
      setGuardians: (m, c) => { wrote.push(['guardians', m, c]); return true; },
      setNoPhoto: (l) => { wrote.push(['nophoto', l]); return true; },
      revokeCheckinPermission: (pk) => { wrote.push(['revokeCheckin', pk]); return true; },
      guardNoticeScope: () => null,
      notifyGuardianRemoved: (...a) => { wrote.push(['notifyGuardianRemoved', ...a]); },
      refreshClearances: (...a) => { wrote.push(['reseal', ...a]); calls.reseal.push(a); return Promise.resolve({ failed: 0 }); },
    },
    dispatchEvent: () => true,
  };
  const rowAnchor = row === 'join'
    ? ['const joinRow = (m) => {', 'joinRow']
    : ['const memberRow = (m, inactive) => {', 'memberRow'];
  const anchors = [['const toggleMinor = async (pk) => {', 'toggleMinor']];
  if (row === 'join') anchors.push(['const admitMember = async (pk, asChild) => {', 'admitMember']);
  else anchors.push(['const toggleApproved = (pk) => {', 'toggleApproved']);
  anchors.push(rowAnchor);
  const mod = await loadSlices(anchors, [rowAnchor[1]], {
    React, window: win, CustomEvent, Promise,
    // toggleMinor's world
    sg, minorsSet: new Set(sg.minors), approvedSet: new Set(sg.approved), nophotoSet: new Set(sg.nophoto),
    parentSet, ckClearedSet: new Set(), guardians, guardiansClosed: {},
    kidPhotosAllowed: false,
    nameByPub: { [PK]: NAME, [KID_A]: 'Alice', [KID_B]: 'Ben' },
    setMinorNotice: (n) => calls.notice.push(n),
    _reseal: (...a) => { wrote.push(['reseal', ...a]); calls.reseal.push(a); },
    // admitMember's world
    admittedList: [],
    // the rows' own furniture — none of it is the control under test
    minorNotice: null, narrow: false, confirmBlock: null, delegated: false, photosAllowed: false,
    block: () => {}, setConfirmBlock: () => {},
    SkBadge: Stub('SkBadge'), SkPill: Stub('SkPill'), Icon: Stub('Icon'),
    SK_TINT: { gold: { fg: '#000' }, sage: { fg: '#000' }, clay: { fg: '#000' }, ink: { fg: '#000' } },
    nameHandle: () => '', shortNpub: () => 'npub1tam…', ago: () => 'a while ago',
    doCopy: () => {}, copied: null, setLinkChild: () => {}, setReseatFor: () => {}, toggleNoPhoto: () => {},
    stewCapState: () => ({ allowed: false }), moreFor: null, setMoreFor: () => {},
  });
  const tree = row === 'join'
    ? mod.joinRow({ pubkey: PK, npub: 'npub1tam', name: NAME, av: null })
    : mod.memberRow({ pubkey: PK, npub: 'npub1tam', name: NAME, count: 3, lastTs: 1, joined: 1 }, false);
  const byLabel = (starts) => {
    const hits = find(tree, n => n.type === 'button' && String((n.props || {})['aria-label'] || '').startsWith(starts));
    assert.equal(hits.length, 1,
      `no single control on this row has an accessible name starting "${starts}" (found ${hits.length}) ` +
      `— re-anchor this test rather than deleting it`);
    return hits[0];
  };
  return { tree, wrote, calls, byLabel, minorsWrites: () => wrote.filter(w => w[0] === 'minors').map(w => w[1]) };
}

// ── the measurement, both halves ───────────────────────────────────────────────────────────────────────────
test('WARM: "Approve as a child" publishes the church’s WHOLE list of children, plus the joiner', async () => {
  // This is the control for everything below. If a warm console did not keep the other two children, the
  // cold assertions would be proving nothing about a shrink.
  const s = await screen({ warm: true, row: 'join' });
  await s.byLabel('Approve as a child: ').props.onClick();
  await tick();
  assert.deepEqual(s.minorsWrites(), [[KID_A, KID_B, PK]],
    'a warm console no longer republishes the existing children alongside the new one, so the shrink this ' +
    'file is about is no longer observable here — re-anchor it. Wrote: ' + JSON.stringify(s.wrote.map(w => w[0])));
});

test('COLD: pressing "Approve as a child" PUBLISHES NO LIST AT ALL', async () => {
  // The defect: this used to publish [PK] and take Alice and Ben off `minors:` — after which the relay
  // lets any member DM either of them, and the whole-roster back-fill seals {minor:false} to their phones.
  const s = await screen({ warm: false, row: 'join' });
  await s.byLabel('Approve as a child: ').props.onClick();
  await tick();
  assert.deepEqual(s.minorsWrites(), [],
    'A COLD CONSOLE REPLACED THE CHURCH’S LIST OF CHILDREN. Every child not in this write has just become ' +
    'an adult to the relay. Published: ' + JSON.stringify(s.minorsWrites()));
});

test('COLD: and NOBODY IS ADMITTED on the back of a mark that did not happen', async () => {
  // admitMember takes the safeguarding decision FIRST and aborts if it is refused — the rule reseatMember
  // has held since 2026-08-02. A refused mark must not become an admission, or the joiner is in the church
  // as an adult, which is the original gap (a).
  const s = await screen({ warm: false, row: 'join' });
  await s.byLabel('Approve as a child: ').props.onClick();
  await tick();
  assert.equal(s.wrote.filter(w => w[0] === 'admitted').length, 0,
    'the child mark was refused and the console let them in anyway. Wrote: ' + JSON.stringify(s.wrote.map(w => w[0])));
  assert.equal(s.calls.reseal.length, 0,
    'the console sealed a safeguarding answer to a phone from a list it had not read');
  assert.equal(s.wrote.filter(w => w[0] === 'nophoto').length, 0,
    'the console suppressed a photograph off the back of a marking that never landed');
});

test('COLD: the steward is TOLD, on the row they pressed, and told WHY', async () => {
  // Silence here is the worst outcome of all: the row leaves the queue, nothing is published, and a steward
  // who thinks they have marked a child has not. "Nothing was changed" first, then the reason.
  const s = await screen({ warm: false, row: 'join' });
  await s.byLabel('Approve as a child: ').props.onClick();
  await tick();
  const n = s.calls.notice.filter(Boolean).pop();
  assert.ok(n, 'the press did nothing and said nothing');
  assert.equal(n.pk, PK, 'the notice is filed against the wrong person, so it draws on another row');
  assert.equal(n.tone, 'fail', 'a refusal was reported in the success tone');
  assert.match(n.text, /nothing was changed/i, 'the notice does not say that nothing happened: ' + JSON.stringify(n.text));
  assert.match(n.text, /list of children/i, 'the notice does not say WHY: ' + JSON.stringify(n.text));
  assert.match(n.text, /try again/i, 'the notice does not say what to do next: ' + JSON.stringify(n.text));
});

// ── the same door on the members list, which is a hole on main today ───────────────────────────────────────
test('COLD: the members-list "Child" button cannot empty the list either', async () => {
  // Same function, same whole-list replace, reached from the row every steward uses day to day. Guarding
  // toggleMinor closes both doors; this test is what keeps the second one closed.
  const s = await screen({ warm: false, row: 'members' });
  await s.byLabel('Mark as a child: ').props.onClick();
  await tick();
  assert.deepEqual(s.minorsWrites(), [],
    'the members-list control replaced the church’s list of children from a cold console: ' +
    JSON.stringify(s.minorsWrites()));
  const n = s.calls.notice.filter(Boolean).pop();
  assert.ok(n && n.tone === 'fail' && /list of children/i.test(n.text),
    'the members-list control refused in silence: ' + JSON.stringify(n));
});

test('WARM: the members-list "Child" button still publishes the whole list, plus them', async () => {
  const s = await screen({ warm: true, row: 'members' });
  await s.byLabel('Mark as a child: ').props.onClick();
  await tick();
  assert.deepEqual(s.minorsWrites(), [[KID_A, KID_B, PK]],
    'the guard is refusing a WARM console, which would leave children unmarkable — and a child a steward ' +
    'cannot mark is an ADULT to the relay. Wrote: ' + JSON.stringify(s.minorsWrites()));
});

test('UN-MARKING, the one path that legitimately shrinks the list, is untouched', async () => {
  // The guard must not reach this. It cannot: `minors` is only ever assigned in subscribeSafeguard's
  // MINORS_D branch, which sets sawMinors, so a non-empty list implies minorsKnown — and `unmarking` is
  // only true when the person is already on that list. Asserted by RUNNING it rather than by argument.
  const s = await screen({ warm: true, row: 'members', marked: true });
  await s.byLabel('Unmark as a child: ').props.onClick();
  await tick();
  assert.deepEqual(s.minorsWrites(), [[KID_A, KID_B]],
    'un-marking a child no longer takes them off the list, or takes somebody else off with them: ' +
    JSON.stringify(s.minorsWrites()));
});

// ── FIX 3: the notice tells the truth about what un-marking will NOT undo ─────────────────────────────────
test('MARKING A CONFIRMED GUARDIAN SAYS THAT UN-MARKING WILL NOT PUT THEIR LINKS BACK', async () => {
  // c247462 claimed a mis-tap "is one tap to undo on the members list". It is not: this branch removes them
  // as guardian of every one of their children, writes a `closed` pair for each (which suppresses their own
  // re-request) and notifies them, and un-marking restores none of it. The claim is gone from the comments;
  // this is the part the steward can actually act on, so it has to be on the screen.
  const s = await screen({ warm: true, row: 'members', guardianOf: KID_A });
  await s.byLabel('Mark as a child: ').props.onClick();
  await tick();
  const n = s.calls.notice.filter(Boolean).pop();
  assert.ok(n, 'marking a confirmed guardian as a child said nothing at all');
  assert.match(n.text, /no longer listed as a guardian/i,
    'the notice does not say the guardian role ended: ' + JSON.stringify(n.text));
  assert.match(n.text, /un-marking them will not put those links back/i,
    'the notice still implies the press is undoable. It is not — the `closed` pairs this branch writes also ' +
    'suppress the parent’s own re-request. Got: ' + JSON.stringify(n.text));
});
