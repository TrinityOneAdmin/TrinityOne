// FIVE CONTROLS THAT SAID "DONE" BEFORE ANYTHING CAME BACK — OR SAID IT WHEN NOTHING HAD.
// Run: node --test scripts/a-control-that-reports-before-it-knows.test.mjs
//
// AUDIT 2026-09-04. Each of these is the same shape and each was left when its sibling was fixed:
//
//   · the meal-slot note      — "✓ Saved" was drawn synchronously, so the failure toast added that same
//                               morning arrived under a green tick. The note ("no nuts") is the one field
//                               here other people act on.
//   · "I'm here to help" OFF  — the ON direction was fixed and the OFF direction was not. A member who
//                               believes they withdrew, and did not, is still being counted on.
//   · a member's profile      — INVERTED IN BOTH DIRECTIONS. A refused publish returned the event, so the
//                               screen said "Profile saved"; and an ordinary name change (which since Stage 2
//                               puts nothing new on the wire) returned null, so the screen said the church
//                               still saw the old name. Worse, the null came from an early return that also
//                               skipped the LOCAL save and the re-seal — so a second name edit in one session
//                               was dropped entirely.
//   · syncDisable             — syncEnable was fixed on 2026-09-02 and its twin was not. "Sync turned off."
//                               over a refused publish, while the relays go on mirroring. That is pressed
//                               when a church is decommissioning a box or reacting to a seizure.
//   · the console's need sheet — closed as saved over a publish nothing accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';

const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };
const ME = 'm'.repeat(64);

function memberScreen(care, extraCtx) {
  const { React, draw } = miniReact();
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
      Fellowship: { myPubkey: ME, subscribeCareRequests: () => () => {}, childCareAudience: async () => [] },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } },
  };
  const mod = loadScreen('app/screens-today.jsx', ['CareNeedRow', 'CareAvailability'], globals);
  return { draw, ...mod, ctx: { care, safeguard: { minors: [] }, ...(extraCtx || {}) } };
}

// ── the meal-slot note ────────────────────────────────────────────────────────────────────────────────────
const NEED = { id: 'care-1', type: 'meals', displayLabel: 'The Ellis family', dates: ['2026-09-10'] };
const MY_SLOT = [{ needId: 'care-1', isoDate: '2026-09-10', pubkey: ME, note: '' }];

async function saveTheNote(setNoteResult) {
  const said = [];
  const care = { myPub: ME, slots: MY_SLOT, skips: [], setNote: async () => setNoteResult,
                 fill: async () => setNoteResult, toast: (m, o) => said.push({ m, e: !!(o && o.error) }) };
  const { draw, CareNeedRow } = memberScreen(care);
  const props = { need: NEED, slots: MY_SLOT, skips: [], care, canManage: false, expanded: true, onToggle() {} };
  let tree = draw(CareNeedRow, props);
  const b = button(tree, 'Save')[0];
  assert.ok(b, 'no Save control on an expanded slot I am filling — re-anchor this test');
  await b.props.onClick({ stopPropagation() {} });
  tree = draw(CareNeedRow, props);
  return texts(tree).join(' ');
}

test('the note does NOT say "✓ Saved" when it did not save', async () => {
  const words = await saveTheNote(null);
  assert.ok(!/✓ Saved/.test(words),
    'a green "✓ Saved" was drawn beside the error toast saying the same note had not reached the church');
});

test('CONTROL: a note that DID save still says so', async () => {
  const words = await saveTheNote({ id: 'evt' });
  assert.match(words, /✓ Saved/, 'the confirmation was lost — without this control the fix could be "never confirm"');
});

// ── "I'm here to help", coming OFF the list ───────────────────────────────────────────────────────────────
async function takeMeOff(clearResult) {
  const said = [];
  const care = { myPub: ME, avail: [{ pubkey: ME, tags: ['lifts'], note: '' }],
                 clearAvail: async () => clearResult, setAvail: async () => ({ id: 'e' }) };
  const ctxToast = (m, o) => said.push({ m: String(m), e: !!(o && o.error) });
  const { draw, CareAvailability, ctx } = memberScreen(care, { toast: ctxToast });
  const props = { ctx: { ...ctx, toast: ctxToast }, part: 'mine' };
  let tree = draw(CareAvailability, props);
  const b = button(tree, 'Take a break')[0];
  assert.ok(b, 'no control to come off the list — re-anchor this test (buttons: ' +
    find(tree, n => n.type === 'button').map(n => texts(n).join('')).join(' / ') + ')');
  await b.props.onClick({ stopPropagation() {} });
  await new Promise(r => setTimeout(r, 0));   // the report comes back off a promise, not on the click
  draw(CareAvailability, props);
  return said;
}

test('coming OFF the list says so when it did not reach the church', async () => {
  const said = await takeMeOff(null);
  assert.ok(said.some(t => t.e && /still see you as ready to help|couldn/i.test(t.m)),
    'the switch moved and nothing was said, so a member who can no longer help is still listed as able to');
});

test('CONTROL: coming off the list quietly when it DID land', async () => {
  const said = await takeMeOff({ id: 'evt' });
  assert.equal(said.filter(t => t.e).length, 0, 'a successful withdrawal now reports a failure');
});

// ── the member's profile, out of the SHIPPED bundle ───────────────────────────────────────────────────────
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

function liftFellowship(name) {
  const i = FELLOWSHIP.indexOf('async ' + name + '(');
  assert.ok(i > 0, name + ' is not in the bundle — re-anchor this test');
  let d = 0;
  for (let k = FELLOWSHIP.indexOf('{', i); k < FELLOWSHIP.length; k++) {
    if (FELLOWSHIP[k] === '{') d++;
    else if (FELLOWSHIP[k] === '}') { d--; if (!d) return FELLOWSHIP.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

function profileRunner({ publishFails, alreadyPublished }) {
  const state = { stored: null, sealedNames: 0, toasts: [] };
  const profiles = { [ME]: { name: 'Jane Smith', about: '', picture: '', hidden: false } };
  const names  = ['sk', 'pub', 'window', 'profiles', '_k0Seen', '_publishAny', 'finalizeEvent2', '_churchPhotosOff',
                  '_myPhotoReset', '_stripPhoto', 'PROFILE_KEY', 'localStorage', 'setTimeout', 'console',
                  '_profilePubFor', '_profilePubBody', 'JSON', 'Date', 'Math', 'String', 'CustomEvent'];
  const values = ['sk-bytes', ME,
    { Fellowship: { ready: Promise.resolve(), relays: ['wss://r/relay'], myProfile: null,
                    syncSealedNames() { state.sealedNames++; } },
      trinityToast: (m) => state.toasts.push(String(m)),
      dispatchEvent() {} },
    profiles, new Set([ME]),
    async () => { if (publishFails) throw new Error('NO_NETWORK_RELAY: nothing accepted it'); return true; },
    (e) => ({ ...e, id: 'evt-id' }), () => false, () => false, (p, av) => av, 'trinityone.profile',
    { setItem: (k, v) => { state.stored = v; }, getItem: () => null }, setTimeout, { warn() {} },
    alreadyPublished ? ME : '', alreadyPublished ? JSON.stringify({ about: '', picture: '' }) : '',
    JSON, Date, Math, String, function CustomEvent() {}];
  const obj = new Function(...names, 'return ({ ' + liftFellowship('setProfile') + ' })')(...values);
  return { setProfile: obj.setProfile, state };
}

test('a profile the relay refused does NOT come back as saved', async () => {
  const { setProfile } = profileRunner({ publishFails: true, alreadyPublished: false });
  assert.equal(await setProfile({ name: 'Jane Smith', about: 'new bio' }), null,
    'setProfile returned its event after every relay refused it, so the sheet said "Profile saved" while the ' +
    'church went on showing the old profile — the exact failure its caller was fixed to stop');
});

test('a NAME-ONLY edit is a success, and is actually saved', async () => {
  // Since Stage 2 the name does not travel in kind-0, so an ordinary rename leaves the wire copy identical.
  // That used to hit an early return: null to the screen ("your church still sees the old name") AND the
  // local write, the localStorage copy and syncSealedNames all skipped — so a second rename in one session
  // vanished without trace.
  const { setProfile, state } = profileRunner({ publishFails: false, alreadyPublished: true });
  const out = await setProfile({ name: 'Jane Smith-Jones' });
  await new Promise(r => setTimeout(r, 0));   // syncSealedNames is queued on a 0ms timer, as it is in the app
  assert.ok(out, 'a rename with nothing new to publish was reported to the member as a failure');
  assert.match(String(state.stored || ''), /Smith-Jones/, 'the new name was never written to this device');
  assert.equal(state.sealedNames, 1, 'the new name was never re-sealed, so the church never learns it');
});

test('CONTROL: a profile that published cleanly still comes back saved', async () => {
  const { setProfile } = profileRunner({ publishFails: false, alreadyPublished: false });
  assert.ok(await setProfile({ name: 'Jane Smith', about: 'new bio' }), 'a clean save now reports failure');
});

// ── syncDisable, out of the SHIPPED console bundle ────────────────────────────────────────────────────────
test('"Sync turned off" is not said over a refused publish', async () => {
  const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const i = BUNDLE.indexOf('async syncDisable(');
  assert.ok(i > 0, 'syncDisable is not in vendor/steward.js — re-anchor this test');
  let d = 0, end = i;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) { end = k + 1; break; } }
  }
  // esbuild renames it `finalizeEvent2` in this bundle — pass the name the SHIPPED text actually uses, or the
  // lifted function resolves it from the global scope and the test asserts about nothing.
  const mk = (lands) => new Function('sk', 'pub', 'publish', 'finalizeEvent2', 'now',
    'return ({ ' + BUNDLE.slice(i, end) + ' })')('sk', 'p', async () => (lands ? { id: 'e' } : false),
      (t) => t, () => 1756900000).syncDisable;
  await assert.rejects(() => mk(false)(),
    /STILL mirroring|could not be switched off/,
    'the console said "Sync turned off." over a document no relay accepted — the boxes go on mirroring each ' +
    'other, and this is pressed when a church is decommissioning a relay or reacting to a seizure');
  const ok = await mk(true)();
  assert.deepEqual(ok, { relays: 0 }, 'CONTROL: switching sync off for real must still succeed');
});
