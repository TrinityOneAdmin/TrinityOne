// A YOUNG PERSON MUST BE MARKED AS A CHILD BEFORE THEY ARE LET INTO THE CHURCH, NOT AFTER.
//   Run: node --test scripts/a-child-is-marked-before-they-are-let-in.test.mjs
//
// THE GAP, measured on d0696eb before this file existed.
//
// A young person reaches an open-join church on their own device, off an invite or a join link
// (reference/DOMAIN.md, 2026-08-30: "a young person can arrive by SEVERAL routes, not one" — the parent
// minting an account is only one of them). They land in the console's "Requests to join" queue. The
// steward presses Approve.
//
// From that press until the moment a steward happens to open the Members list and tap "Mark as a child",
// that young person is an ADULT to every machine in the church:
//
//   · the relay's safeguardAllows() lets ANY member open a private message with a key that no church
//     document calls a minor — `minors:<churchpub>` is the only thing it reads, and the key is not on it;
//   · their own phone has no sealed clearance yet, so it falls back to the `minors:` list, which the relay
//     refuses to serve an ordinary member — absence READS AS ADULTHOOD;
//   · and the whole-roster back-fill in DashMembers can seal {minor:false} to that key in the meantime,
//     which their phone then trusts OVER the fallback.
//
// AND THERE WAS NO WAY TO CLOSE IT FROM THE SCREEN. This is the part that makes it a gap rather than a
// race: a person waiting to join is filtered OUT of both member lists —
//
//     const activeM   = members.filter(m => … && !pendingSet.has(m.pubkey) && …);
//     const inactiveM = members.filter(m => … && !pendingSet.has(m.pubkey) && …);
//
// — so "Mark as a child" does not exist for them. The steward CANNOT mark the child first. They must admit
// the child as an adult and then correct it. The order is forced by the UI, and the safe order was
// unreachable.
//
// Compare reseatMember in src/steward.src.js, which has had the right rule since 2026-08-02 and says so:
// "(2) SAFEGUARDING BEFORE ADMISSION. If the child marking will not save, the alternative to stopping is a
// child in the church whom no list names as a child — and safeguardAllows() then lets any adult DM them."
// This file holds the ordinary admit path to the same standard.
//
// NOT A POLICY CHANGE, and deliberately not one. The software does not decide who is a child
// (reference/DOMAIN.md: "TrinityOne does not decide who is a child; it decides what follows from that
// mark"). Plain Approve still admits, unchanged — the CONTROL test below is what keeps that honest. All
// this adds is a second way in for the case where the steward already knows, so that the window has a
// door. Fails CLOSED by construction: a mis-tap marks an ADULT as a child, which is the safe way to be
// wrong, and a refused mark admits NOBODY.
//
// IT IS NOT, HOWEVER, "ONE TAP TO UNDO" — this header said so, and so did c247462's message, and both were
// false (corrected 2026-10-13, CLAUDE.md rule 4). toggleMinor also adds the person to the NO-PHOTO list and
// un-marking deliberately LEAVES them there (owner, reference/DOMAIN.md 2026-10-12), so the undo is a second,
// conditionally-rendered control; and if the mis-tapped person is a confirmed guardian, toggleMinor ends
// their guardian role over every one of their children and writes a `closed` pair for each, which un-marking
// restores none of and which suppresses their own re-request. The screen now says so
// (scripts/a-cold-console-cannot-empty-the-list-of-children.test.mjs holds that sentence in place); no
// confirm step was added, and the reasoning for that is on the guardian branch of toggleMinor.
//
// WHAT IS REAL HERE. `joinRow`, `admitMember` and `toggleMinor` are sliced out of the shipped
// app/stew-dashboard.jsx by brace-match (scripts/test-slice.mjs), compiled together with the same esbuild
// the packaged build uses, and run in one scope — so the button's onClick calls the real admitMember,
// which calls the real toggleMinor, which calls the injected window.Steward. Nothing here matches text in
// the .jsx: app/*.jsx ships UNBUNDLED (CLAUDE.md rule 3), so `false && ` in front of a condition leaves
// every word of it in the file and any text assertion still passes. The row is RENDERED, the control is
// found by its ACCESSIBLE NAME, its handler is invoked, and what reached window.Steward is asserted.
//
// MEASURED RED/GREEN, 2026-10-13. Each sabotage was scoped to the ENCLOSING FUNCTION, the anchor asserted to
// occur exactly ONCE inside that slice before the edit, and the source restored byte-for-byte after:
//   · the shipped console                                                            8 pass / 0 fail
//   · joinRow:      `admitMember(m.pubkey, true)` -> `admitMember(m.pubkey)`         4 pass / 4 fail
//   · admitMember:  `if (asChild && …` -> `if (false && asChild && …`                4 pass / 4 fail
//   · admitMember:  `if (!marked) return null;` -> `if (false) return null;`          7 pass / 1 fail
//
// The first sabotage leaves the button, its label and its tooltip untouched and only mis-wires the press —
// which is the whole reason nothing here matches text in the .jsx. It does NOT redden "THE JOIN ROW OFFERS A
// WAY…", correctly: that test's job is the control's existence and its accessible name, and the four tests
// that press it are what prove the wiring.
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

// Same mechanism as scripts/console-safeguarding-controls-are-wired.test.mjs: the slices go in ONE file so
// joinRow's onClick closes over the REAL admitMember, and admitMember over the REAL toggleMinor.
async function loadSlices(anchors, exportNames, globals) {
  const src = anchors.map(([anchor, what]) => fnBody(STEW, anchor, what)).join('\n');
  const tmp = join(tmpdir(), 'joinrow-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${exportNames.join(', ')} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__joinrow_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const tick = () => new Promise(r => setTimeout(r, 15));

// One waiting person's row, drawn the way the "Requests to join" panel draws it.
// `results` makes a write fail the way _publishToRelays does — FALSE when the document reached some relays
// and not others, which for `minors:` means the child is protected on one relay of three.
async function joinRowFor({ results = {} } = {}) {
  const { React } = miniReact();
  // ORDER IS THE WHOLE POINT, so every write goes into ONE log, in sequence.
  const wrote = [];
  const calls = { notice: [], reseal: [], nophoto: [] };
  // minorsKnown: toggleMinor refuses a whole-list setMinors until the church's list of children has
  // actually arrived (FIX 1, 2026-10-13). This fixture is a WARM console; the cold case has its own file,
  // scripts/a-cold-console-cannot-empty-the-list-of-children.test.mjs.
  const sg = { loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors: [], approved: [], nophoto: [] };
  const win = {
    Steward: {
      setMinors: (l) => { wrote.push(['minors', l]); return 'minors' in results ? results.minors : true; },
      setAdmitted: (l) => { wrote.push(['admitted', l]); return 'admitted' in results ? results.admitted : true; },
      setApproved: (l, o) => { wrote.push(['approved', l, o]); return true; },
      setGuardians: (m, c) => { wrote.push(['guardians', m, c]); return true; },
      setNoPhoto: (l) => { wrote.push(['nophoto', l]); calls.nophoto.push(l); return true; },
      revokeCheckinPermission: (pk) => { wrote.push(['revokeCheckin', pk]); return true; },
      guardNoticeScope: () => null,
      notifyGuardianRemoved: () => {},
      refreshClearances: (...a) => { wrote.push(['reseal', ...a]); calls.reseal.push(a); return Promise.resolve({ failed: 0 }); },
    },
    dispatchEvent: () => true,
  };
  const mod = await loadSlices(
    [['const toggleMinor = async (pk) => {', 'toggleMinor'],
     ['const admitMember = async (pk, asChild) => {', 'admitMember'],
     ['const joinRow = (m) => {', 'joinRow']],
    ['joinRow', 'admitMember'],
    {
      React, window: win, CustomEvent, Promise,
      // toggleMinor's world
      sg, minorsSet: new Set(sg.minors), approvedSet: new Set(sg.approved), nophotoSet: new Set(sg.nophoto),
      parentSet: new Set(), ckClearedSet: new Set(), guardians: {}, guardiansClosed: {},
      kidPhotosAllowed: false,
      nameByPub: { [PK]: NAME },
      setMinorNotice: (n) => calls.notice.push(n),
      _reseal: (...a) => { wrote.push(['reseal', ...a]); calls.reseal.push(a); },
      // admitMember's world
      admittedList: [],
      // the row's own furniture — none of it is the control under test
      minorNotice: null, narrow: false, confirmBlock: null, delegated: false,
      block: () => {}, setConfirmBlock: () => {},
      SkBadge: Stub('SkBadge'), Icon: Stub('Icon'),
      SK_TINT: { gold: { fg: '#000' }, sage: { fg: '#000' } },
      nameHandle: () => '', shortNpub: () => 'npub1tam…',
    });
  const tree = mod.joinRow({ pubkey: PK, npub: 'npub1tam', name: NAME, av: null });
  const byLabel = (starts) => {
    const hits = find(tree, n => n.type === 'button' && String((n.props || {})['aria-label'] || '').startsWith(starts));
    assert.equal(hits.length, 1,
      `the join-queue row no longer carries exactly one control whose accessible name starts "${starts}" ` +
      `(found ${hits.length}) — re-anchor this test rather than deleting it`);
    return hits[0];
  };
  // THE PLAIN Approve, picked out by the ABSENCE of an accessible name. Deliberately not picked by its words:
  // "Approve" is a prefix of "Approve as a child", so a text or label prefix match finds both and the CONTROL
  // test below would be pressing whichever came first. The plain button is the only one on this row with no
  // aria-label, which is also why this test does not touch it — changing its accessible name is a separate
  // decision and not this branch's to make.
  const plainApprove = () => {
    const hits = find(tree, n => n.type === 'button' && !(n.props || {})['aria-label']
      && (n.kids || []).some(k => typeof k === 'string' && k.includes('Approve')));
    assert.equal(hits.length, 1,
      `expected exactly one unlabelled button reading "Approve" on the join row, found ${hits.length} ` +
      `— re-anchor this test rather than deleting it`);
    return hits[0];
  };
  return { tree, wrote, calls, byLabel, plainApprove };
}

// ── the premise ─────────────────────────────────────────────────────────────
// The predicate out of `members.filter(<here>)`, RUN rather than read. CLAUDE.md rule 3: app/*.jsx ships
// unbundled, so `false && !pendingSet.has(m.pubkey)` leaves every word of that term in the file and an
// assert.match on the source still passes. fnBody refuses a call-shaped anchor, correctly, so take the
// argument expression by paren-walk and evaluate it.
function filterPredicate(src, anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, anchor + ' is missing — re-anchor this test rather than deleting it');
  const open = at + anchor.length - 1;   // the '(' of .filter(
  assert.equal(src[open], '(', 'anchor must end at the filter’s open paren');
  let d = 0, end = -1, q = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') d++;
    else if (c === ')' && --d === 0) { end = i; break; }
  }
  assert.notEqual(end, -1, anchor + ' has an unterminated argument list');
  return src.slice(open + 1, end);
}

test('CONTROL: a waiting person is filtered OUT of both member lists — why the mark cannot wait', async () => {
  // This is the fact that turns the window into a gap rather than a race. If these filters ever stop
  // excluding the queue, "Mark as a child" reaches a waiting person on its own and the tests below are about
  // convenience rather than safeguarding. So RUN the real predicates over a pending member.
  const pending = { pubkey: PK, name: NAME };
  const world = {
    seen: () => 100, cutoff: 50, isBlocked: () => false, matchQ: () => true,
    pendingSet: new Set([PK]),
  };
  for (const [anchor, what] of [['const activeM = members.filter(', 'active'], ['const inactiveM = members.filter(', 'inactive']]) {
    const expr = filterPredicate(STEW, anchor);
    const keys = Object.keys(world);
    // `seen(m) >= cutoff` for active and `< cutoff` for inactive — flip `seen` so each predicate is being
    // asked about a member it would otherwise WANT, and the only reason to refuse is the pending filter.
    const w = what === 'active' ? world : { ...world, seen: () => 10 };
    const pred = new Function(...keys, 'return (' + expr + ');')(...keys.map(k => w[k]));
    assert.equal(pred(pending), false,
      'the ' + what + ' members list no longer excludes people waiting to join, so a steward can mark a ' +
      'joiner as a child from the members list and this whole control is unnecessary — check that first');
    const notPending = new Function(...keys, 'return (' + expr + ');')(...keys.map(k => (k === 'pendingSet' ? new Set() : w[k])));
    assert.equal(notPending(pending), true,
      'the ' + what + ' predicate refuses this member for some reason OTHER than being pending, so the ' +
      'assertion above proves nothing');
  }
});

test('CONTROL: the join row still carries a plain Approve, and it still admits', async () => {
  // Without this, every test below passes just as well over a screen that refuses to admit anybody, and
  // over one that marks every single joiner as a child. The software does not decide who is a child.
  const r = await joinRowFor();
  await r.plainApprove().props.onClick();
  await tick();
  assert.deepEqual(r.wrote.map(w => w[0]), ['admitted'],
    'plain Approve must admit and do nothing else — it wrote: ' + JSON.stringify(r.wrote.map(w => w[0])));
  assert.deepEqual(r.wrote[0][1], [PK], 'the admission was published without the person it was pressed on');
});

// ── the gap ─────────────────────────────────────────────────────────────────
test('THE JOIN ROW OFFERS A WAY TO ADMIT SOMEBODY AS A CHILD, NAMING THEM', async () => {
  const r = await joinRowFor();
  const label = r.byLabel('Approve as a child: ').props['aria-label'];
  assert.ok(label.startsWith('Approve as a child: ' + NAME),
    'the control does not name the person it acts on, which is the fault Rev. Miriam reported about the ' +
    'members list: every row read the same words with nothing naming the person. Got: ' + JSON.stringify(label));
  assert.match(label, /mark|child/i, 'the control does not say what pressing it does');
});

test('THE CHILD MARK IS PUBLISHED BEFORE THE ADMISSION, NOT AFTER', async () => {
  // The whole fix, in one assertion. `minors:<churchpub>` is what the relay's minorOf() reads before it
  // decides anything — which rooms a young person is served, and whether an adult may DM them. If the
  // admission lands first, there is a window in which every machine in the church treats a child as an
  // adult, and the back-fill can seal {minor:false} to their key inside it.
  const r = await joinRowFor();
  await r.byLabel('Approve as a child: ').props.onClick();
  await tick();
  const order = r.wrote.map(w => w[0]);
  const iMinors = order.indexOf('minors'), iAdmitted = order.indexOf('admitted');
  assert.notEqual(iMinors, -1,
    'the steward pressed "Approve as a child" on ' + NAME + ' and NO child mark was published. They are in ' +
    'the church and no document calls them a child: safeguardAllows() lets any member DM them, and their ' +
    'own phone falls back to a list the relay will not serve them. Writes seen: ' + JSON.stringify(order));
  assert.notEqual(iAdmitted, -1, '"Approve as a child" did not admit them at all');
  assert.ok(iMinors < iAdmitted,
    'the admission was published BEFORE the child mark, so the window this control exists to remove is ' +
    'still open. Order: ' + JSON.stringify(order));
  assert.deepEqual(r.wrote[iMinors][1], [PK], 'the child mark was published without the person it was pressed on');
  assert.deepEqual(r.wrote[iAdmitted][1], [PK], 'the admission was published without the person it was pressed on');
});

test('A CHILD MARK THE RELAY REFUSED ADMITS NOBODY', async () => {
  // Default-deny. The alternative to stopping is a child in the church whom no list names as a child —
  // reseatMember has refused to cross that line since 2026-08-02 and says so in its own comment.
  const r = await joinRowFor({ results: { minors: false } });
  await r.byLabel('Approve as a child: ').props.onClick();
  await tick();
  assert.equal(r.wrote.filter(w => w[0] === 'admitted').length, 0,
    'the relay refused the child mark and the console let the child in anyway. Writes: ' +
    JSON.stringify(r.wrote.map(w => w[0])));
  assert.equal(r.calls.reseal.length, 0,
    'the console sealed a safeguarding answer to the phone of somebody whose church document was refused');
  const last = r.calls.notice.filter(Boolean).pop();
  assert.ok(last, 'the steward was told nothing: the row simply stops looking like a request to join');
  assert.equal(last.tone, 'fail', 'a refused admission was reported as success');
  assert.match(last.text, new RegExp(NAME.split(' ')[0]), 'the failure does not name the person it is about');
});

test('AND THE CHILD’S OWN PHONE IS TOLD, so it never has to infer adulthood from an absent record', async () => {
  // A new key has no sealed clearance at all, and the relay refuses an ordinary member the `minors:` list it
  // would otherwise fall back to — so without this seal the child's own app reads "not a child" on the one
  // route it has. reseatMember re-issues the clearance for exactly this reason.
  const r = await joinRowFor();
  await r.byLabel('Approve as a child: ').props.onClick();
  await tick();
  assert.ok(r.calls.reseal.length >= 1,
    'nothing sealed the answer to ' + NAME + '’s own phone, so their app has only the fallback the relay ' +
    'refuses to serve it');
  const who = r.calls.reseal.flatMap(a => (Array.isArray(a[2]) ? a[2] : [a[2]]));
  assert.ok(who.includes(PK), 'the reseal went out for somebody else: ' + JSON.stringify(r.calls.reseal.map(a => a[2])));
  const mins = r.calls.reseal.map(a => a[0]).filter(Array.isArray).pop() || [];
  assert.ok(mins.includes(PK),
    'the sealed clearance was issued from a minors list that does NOT contain them, so their phone was ' +
    'sealed {minor:false} by the very press that was meant to mark them a child');
});

test('THEIR EXISTING PHOTOGRAPH IS SUPPRESSED, as marking an existing member already does', async () => {
  // reference/DOMAIN.md, confirmed on the phone 2026-08-27: the relay refuses a NEW photo from a minor whose
  // church has children's photos off, but it cannot rewrite a kind-0 somebody already signed — and a joiner
  // arrives with a picture already set. toggleMinor handles this for an existing member; admitting as a
  // child goes through the same path so it cannot drift from it.
  const r = await joinRowFor();
  await r.byLabel('Approve as a child: ').props.onClick();
  await tick();
  assert.deepEqual(r.calls.nophoto, [[PK]],
    'a church with children’s photos off admitted a child whose photograph still renders on every other ' +
    'member’s device');
});

test('THE ADMISSION ITSELF IS STILL CHECKED — a refused Approve-as-a-child is not painted as done', async () => {
  // The mark landed, so the child IS protected; what failed is the admission. They are still waiting, and
  // the steward must know that rather than wondering why the new member never appears.
  const r = await joinRowFor({ results: { admitted: false } });
  await r.byLabel('Approve as a child: ').props.onClick();
  await tick();
  const last = r.calls.notice.filter(Boolean).pop();
  assert.ok(last, 'a refused admission said nothing on the row it was pressed on');
  assert.equal(last.tone, 'fail');
  assert.match(last.text, /still waiting|didn’t accept|could not be reached/i,
    'the notice does not say the person is still waiting: ' + JSON.stringify(last.text));
});
