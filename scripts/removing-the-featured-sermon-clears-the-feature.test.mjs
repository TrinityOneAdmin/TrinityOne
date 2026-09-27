// REMOVING THE FEATURED SERMON MUST ALSO CLEAR THE FEATURE.
//   Run: node --test scripts/removing-the-featured-sermon-clears-the-feature.test.mjs
//
// THE DEFECT, measured at ffe0d7b by lifting `removeSermon` and `unpinSermon` whole out of the SHIPPED
// vendor/steward.js and capturing every document they publish:
//
//   CONTROL  unpinSermon()   published  ["trinityone/pinsermon:<church>"]   <- the capture CAN see a pin write
//            removeSermon(s) published  ["trinityone/sermon:<id>"]          <- and nothing else
//
// `trinityone/pinsermon:<church>` is a separate document from `trinityone/sermon:<id>`, so a sermon that was
// FEATURED stayed on every member's Today card after it was removed — advertising a recording whose media
// file that same Remove had just deleted from every host. The record is addressable, so featuring a
// DIFFERENT sermon overwrites it eventually; the case that matters is a TAKEDOWN, where nothing else is
// coming and the recording someone asked to have removed goes on being pushed at the whole church.
//
// THE FIX IS ON THE SCREEN, in `DashSermons`' Remove confirm (app/stew-dashboard.jsx), because the ENGINE
// does not know which sermon is featured: `subscribePinnedSermon` keeps that in local variables inside the
// subscription, and this panel is what holds it (`pinnedId`). `unpinSermon`'s only other caller is
// `togglePin`, on the sermon row's pin button, which is unreachable the moment the row is gone.
//
// CLAUDE.md RULE 3 IS THE TRAP HERE: app/*.jsx ships UNBUNDLED, so `false && ` in front of the whole thing
// would leave every word of it in the file and any text match on the source would still pass. Nothing below
// reads the text of app/stew-dashboard.jsx. The real component is compiled with the real esbuild
// (`loadScreen`), rendered, and the buttons a steward presses are pressed.
//
// FIVE ROWS, and two of them are controls:
//   1. the featured sermon is removed          -> the feature is cleared
//   2. CONTROL: a DIFFERENT sermon is removed  -> the feature is LEFT ALONE (stops an unconditional unpin)
//   3. the relay REFUSES the removal           -> the feature is LEFT ALONE, and the reason is on screen
//   4. the removal lands, the unpin does not   -> the steward is TOLD, not left believing it all worked
//   5. RIG CONTROL: the pin button still reaches unpinSermon through this same harness, so "unpinSermon was
//      not called" in rows 2 and 3 cannot be the wiring being dead.
// …plus one row that joins screen to engine: what the screen calls is the REAL unpinSermon out of the
// shipped bundle, and the document it publishes is the one a member's app forgets the feature from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { miniReact, find, reads, loadScreen } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
const ticks = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

// Two sermons, so that "clears the feature" and "leaves the feature alone" are answerable on the same screen.
const SERMONS = [
  { id: 's1', title: 'Sunday morning', sha256: 'aa', size: 10, mime: 'audio/mp4' },
  { id: 's2', title: 'Evening prayer', sha256: 'bb', size: 20, mime: 'video/mp4' },
];

const STUB = () => function Stub(p) { return { type: 'div', props: {}, kids: [p && p.children].flat().filter(Boolean) }; };
const BASE_GLOBALS = (React, win) => ({
  React, window: win,
  Icon: () => null, SkBadge: STUB(), SkPill: STUB(), SkToggle: STUB(),
  Panel: ({ children }) => children, DismissibleNote: ({ children }) => children,
  useStewDialog: () => ({ current: null }), useStewModalOpen: () => {},
  location: { search: '' },
  setTimeout, clearTimeout, URL, URLSearchParams, Blob,
  Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
});

// Render the REAL DashSermons with a given featured sermon, and hand back the controls on it.
// `removeSermon` / `unpinSermon` answer exactly as the shipped engine answers: removeSermon THROWS when the
// relay refuses the tombstone, unpinSermon RESOLVES FALSY when no relay took it.
function panel({ pinned, refuseRemoval = false, unpinAnswer = true }) {
  const { React, draw } = miniReact();
  const calls = [];
  const win = {
    Steward: {
      subscribeSermons: (cb) => { cb(SERMONS); return () => {}; },
      subscribePinnedSermon: (cb) => { cb(pinned ? { id: pinned } : null); return () => {}; },
      subscribeMediaKey: () => () => {},
      mediaHosts: () => [],
      removeSermon: async (s) => {
        calls.push(['removeSermon', s && s.id]);
        // Verbatim from src/steward.src.js' `_tomb === false` arm.
        if (refuseRemoval) throw new Error('Couldn’t remove that sermon — no relay accepted the change, so nothing was deleted.');
        return true;
      },
      unpinSermon: async () => { calls.push(['unpinSermon']); return unpinAnswer; },
      pinSermon: async (s) => { calls.push(['pinSermon', s && s.id]); return true; },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashSermons'], BASE_GLOBALS(React, win));
  const render = () => draw(mod.DashSermons, {});
  // TWO DRAWS BEFORE READING. The subscription that fills the list runs in an EFFECT, and this harness runs
  // effects after the draw — so the first tree is the empty-list one every real console shows for a moment.
  let tree = render(); tree = render();
  const row = (id) => {
    const hits = find(tree, n => n.props && n.props.key === id && n.type === 'div');
    assert.equal(hits.length, 1, `re-anchor this test: expected exactly one sermon row keyed ${id}, found ${hits.length}`);
    return hits[0];
  };
  const press = async (node, pred, what) => {
    const hits = find(node, n => n.type === 'button' && pred(n) && n.props.onClick);
    assert.equal(hits.length, 1, `re-anchor this test: expected exactly one ${what}, found ${hits.length}`);
    hits[0].props.onClick();
    await ticks();
    tree = render();
  };
  return {
    calls,
    said: () => reads(tree),
    // The full Remove journey a steward makes: the trash button on ONE row, then Remove in the sheet.
    // reads(), not texts(): texts() also collects string PROPS, so the row's trash button reads
    // 'Remove Remove sermon' from its title and aria-label and the sheet's button would not be unique.
    remove: async (id) => {
      await press(row(id), n => (n.props['aria-label']) === 'Remove sermon', `Remove (trash) button on row ${id}`);
      await press(tree, n => reads(n).trim() === 'Remove', 'Remove button in the confirmation dialog');
      await ticks();
      tree = render();
    },
    tapPin: async (id) => press(row(id), n => /members’ Today/.test(String(n.props.title || '')), `pin button on row ${id}`),
  };
}

test('THE SCREEN: removing the FEATURED sermon clears the feature', async () => {
  const p = panel({ pinned: 's1' });
  await p.remove('s1');
  assert.deepEqual(p.calls.filter(c => c[0] === 'removeSermon'), [['removeSermon', 's1']],
    're-anchor this test: the confirmation did not reach removeSermon once for s1');
  assert.ok(p.calls.some(c => c[0] === 'unpinSermon'),
    'THE REMOVED SERMON IS STILL FEATURED ON EVERY MEMBER’S TODAY. removeSermon publishes only ' +
    '`trinityone/sermon:<id>`; `trinityone/pinsermon:<church>` is a separate document and nothing cleared ' +
    'it, so the church goes on advertising a recording whose media file this Remove has just deleted from ' +
    'every host — and the pin button that could have cleared it went with the row. Calls: ' + JSON.stringify(p.calls));
  // The clearing must come AFTER the removal is known to have landed, not alongside it.
  assert.deepEqual(p.calls.map(c => c[0]), ['removeSermon', 'unpinSermon'],
    'the feature was not cleared strictly after a successful removal: ' + JSON.stringify(p.calls));
  assert.doesNotMatch(p.said(), /still featured/,
    'the panel warned that the sermon is still featured when the unpin was accepted: ' + p.said());
});

test('CONTROL: removing a DIFFERENT sermon does NOT clear the feature', async () => {
  // Without this row, a fix that unpinned on EVERY removal would pass the row above — and a steward tidying
  // up an old recording would silently pull this week's sermon off the whole church's Today screen.
  const p = panel({ pinned: 's1' });
  await p.remove('s2');
  assert.deepEqual(p.calls, [['removeSermon', 's2']],
    'REMOVING ONE SERMON UNFEATURED A DIFFERENT ONE. Only the sermon that was actually featured may clear ' +
    'the feature. Calls: ' + JSON.stringify(p.calls));
});

test('CONTROL: with NOTHING featured, a removal clears nothing', async () => {
  const p = panel({ pinned: null });
  await p.remove('s1');
  assert.deepEqual(p.calls, [['removeSermon', 's1']],
    'a removal wrote to `pinsermon:` on a church that had featured nothing — an empty-then-deleted record ' +
    'is a write nobody asked for. Calls: ' + JSON.stringify(p.calls));
});

test('A REFUSED REMOVAL LEAVES THE FEATURE ALONE, and says why', async () => {
  // removeSermon THROWS when no relay took the tombstone. On that path the sermon is still there, still
  // playable, and must stay featured — clearing it would take a live sermon off Today over a failure.
  const p = panel({ pinned: 's1', refuseRemoval: true });
  await p.remove('s1');
  assert.deepEqual(p.calls, [['removeSermon', 's1']],
    'THE FEATURE WAS CLEARED OVER A REMOVAL THAT NEVER HAPPENED. The sermon is still live in every ' +
    'member’s app; all this did was stop pointing at it. Calls: ' + JSON.stringify(p.calls));
  assert.match(p.said(), /no relay accepted the change/,
    'the refusal is not on screen — the steward watches the sheet close exactly as it does on success. ' +
    'Screen read: ' + p.said());
});

test('A REMOVAL WHOSE UNPIN WAS REFUSED DOES NOT READ AS SUCCESS', async () => {
  // unpinSermon resolves FALSY when no relay took it. The sermon is then gone from this console's list while
  // its Today card lives on for every member — the worst version of the defect, because the steward has
  // watched it disappear. [[fix-the-control-not-the-label]]: this codebase has shipped a success label over
  // a send that never happened three times.
  const p = panel({ pinned: 's1', unpinAnswer: false });
  await p.remove('s1');
  assert.deepEqual(p.calls.map(c => c[0]), ['removeSermon', 'unpinSermon'], 're-anchor: ' + JSON.stringify(p.calls));
  const said = p.said();
  assert.match(said, /still featured on members’ Today/,
    'THE STEWARD IS NOT TOLD. The unpin reached no relay, so the removed sermon is still on every member’s ' +
    'Today screen, and this screen said nothing about it. Screen read: ' + said);
  assert.match(said, /Sunday morning/, 'the warning does not name which sermon it is about: ' + said);
  assert.match(said, /✗/, 'the warning is not in this panel’s existing failure style: ' + said);
});

test('RIG CONTROL: the pin button still reaches unpinSermon through this same harness', async () => {
  // Without this, "unpinSermon was not called" in the two control rows above would go green over a harness
  // whose Steward object never reaches the screen at all — a rig where every row passes for the same wrong
  // reason. This is the pin button's own unpin, which existed before this fix and is untouched by it.
  const p = panel({ pinned: 's1' });
  await p.tapPin('s1');
  assert.deepEqual(p.calls, [['unpinSermon']],
    'THE RIG CANNOT SEE A PIN WRITE AT ALL, so every "the feature was left alone" assertion in this file is ' +
    'vacuous. Calls: ' + JSON.stringify(p.calls));
});

test('SCREEN MEETS ENGINE: what the screen calls really does clear the featured record', async () => {
  // The two halves joined. Neither is allowed to be right on its own: the screen calling `unpinSermon` is
  // worth nothing unless the REAL unpinSermon publishes the document a member's app forgets the feature
  // from, and vice versa. `unpinSermon` is lifted whole out of the SHIPPED bundle — not re-typed.
  const CHURCH = 'c'.repeat(64);
  const published = [];
  const scope = {
    sk: new Uint8Array(32).fill(3), pub: CHURCH,
    PINSERMON_D: 'trinityone/pinsermon:', NET: 'trinityone',
    now: () => 1759000000,
    feChurch: (t) => ({ ...t, pubkey: CHURCH }),
    publish: async (evt) => { published.push(evt); return true; },
    JSON, Object, Array, String, Number, Boolean, Promise, Error, Math, Date, Uint8Array,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : (k in t ? t[k] : globalThis[k])),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const engine = new Function('scope', `with (scope) { return { ${fnBody(BUNDLE, '    unpinSermon() {', 'unpinSermon in the shipped bundle')} }; }`)(proxy);

  // The screen decides WHETHER to call it; the engine decides WHAT that call publishes.
  const p = panel({ pinned: 's1', unpinAnswer: true });
  await p.remove('s1');
  assert.ok(p.calls.some(c => c[0] === 'unpinSermon'), 're-anchor: the screen did not call unpinSermon');
  await engine.unpinSermon();

  assert.equal(published.length, 1, 're-anchor: unpinSermon no longer publishes exactly one document');
  const d = (published[0].tags.find(t => t[0] === 'd') || [])[1];
  assert.equal(d, 'trinityone/pinsermon:' + CHURCH,
    're-anchor: the featured record is no longer at d=trinityone/pinsermon:<church>, so clearing it clears ' +
    'nothing a member reads. Got: ' + d);
  assert.ok(published[0].tags.some(t => t[0] === 'deleted'),
    'the cleared record carries no `deleted` marker — `subscribePinnedSermon`’s `_forgetById` arm in ' +
    'src/fellowship.src.js is what takes the card off a member’s Today, and it is that marker it reads');
  assert.equal(published[0].content, '',
    're-anchor: the cleared record still carries content, so a reader that ignores the marker would ' +
    'go on rendering the removed sermon');
});
