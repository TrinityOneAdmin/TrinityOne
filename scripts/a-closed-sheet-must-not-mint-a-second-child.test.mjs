// CLOSING THE "ADD A CHILD" SHEET MUST NOT COST THE CHILD A SECOND ACCOUNT.
// Run: node --test scripts/a-closed-sheet-must-not-mint-a-second-child.test.mjs
//
// AUDIT 2026-08-30, and this is the SECOND time this claim has been made. Commit 99cf72b moved the child's
// key out of Fellowship.createChildAccount so that "try again" would finish the same account, and said so —
// but it held the key in FamilySheet's own `useState`, and app/identity.jsx mounts that sheet conditionally
// (`{family ? <FamilySheet …/> : null}`). Closing it unmounts the component and destroys the key. Measured
// on the shipped handler:
//
//     retry without closing the sheet:  seed-1 , seed-1
//     retry after closing the sheet:    seed-1 , seed-2      ← a second child account
//
// The failure copy invites exactly that ("Try again in a moment"). The second account is a member of the
// church whose recovery words nobody has ever seen; it has no guardian request; and because the engine
// writes the local row only when everything landed, it has no row in the parent's Children list either. It
// is invisible and unrecoverable, and the steward is asked to confirm two links for one child.
//
// CLAUDE.md rule 4 already records "a retry reuses the key" as a claim that was made and was not true. So
// this file does not lift the handler and hand it a shared object — that would pass with the key back
// inside the component, which is the whole defect. It COMPILES AND RENDERS the real screen through
// scripts/render-jsx-screen.mjs and mounts it TWICE from one evaluation of the module, with a fresh hook
// store each time. That is what an unmount is. If the key lives in component state, the second mount starts
// with nothing and mints again — which is the failure, reported as the failure.
//
// Rule 3: nothing here matches text in app/identity.jsx. Everything asserted is either a call the screen
// made or a string the screen rendered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const tick = () => new Promise(r => setTimeout(r, 0));

// exactly what the engine hands back: the words come home even when ok is false, so the caller can retry.
const words = (seed) => seed;
const FAILED = (seed, published) => ({ ok: false, published, mnemonic: words(seed), childPub: 'c'.repeat(64), npub: 'npub1child', name: '' });
const MADE = (seed) => ({ ok: true, published: { join: true, k0: true, name: true, req: true }, mnemonic: words(seed), childPub: 'c'.repeat(64), npub: 'npub1child', name: '' });

// ONE module evaluation, MANY mounts. `rt.cur` is the live miniReact; the React handed to the screen
// delegates to it, so a new mount is a new hook store while `app/identity.jsx`'s module scope — where the
// pending key must live — is the same one throughout, exactly as in the running app.
function app({ outcome }) {
  const rt = { cur: null };
  const calls = [];          // every { name, mnemonic } handed to the engine
  const minted = [];         // every key the screen minted, so a second account shows as a second key
  const React = {
    useState: (i) => rt.cur.React.useState(i),
    useEffect: (f, d) => rt.cur.React.useEffect(f, d),
    useRef: (i) => rt.cur.React.useRef(i),
    useMemo: (f, d) => rt.cur.React.useMemo(f, d),
    useCallback: (f, d) => rt.cur.React.useCallback(f, d),
    createElement: (...a) => rt.cur.React.createElement(...a),
    Fragment: 'Fragment',
  };
  const win = {
    Fellowship: {
      myPubkey: 'mehex',
      myChildren: () => [],
      createChildAccount: async (npub, n, opts) => {
        calls.push({ church: npub, name: n, mnemonic: opts && opts.mnemonic });
        // the real engine hands back the key it was actually given
        const r = outcome(calls.length - 1);
        return { ...r, mnemonic: (opts && opts.mnemonic) || r.mnemonic };
      },
    },
    // a REAL minter: a different phrase every call, so "it minted a second key" is visible as a different
    // string rather than hidden behind one constant.
    TrinityIdentity: { makeInvite: () => { const m = 'seed-' + (minted.length + 1); minted.push(m); return { mnemonic: m }; }, qrSVG: () => '<svg/>' },
    addEventListener: () => {}, removeEventListener: () => {},
    Capacitor: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { href: 'https://app.trinityone.church/', origin: 'https://app.trinityone.church', search: '' },
  };
  const mod = loadScreen('app/identity.jsx', ['FamilySheet'], {
    React,
    window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    navigator: { clipboard: null },
    location: win.location,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    // shells and leaf icons: render children, nothing else, so the sheet's own markup is what is read below
    Overlay: ({ open, children }) => (open ? children : null),
    // IdentityOnboarding calls useDialogA11y (app/ui.jsx) so the first-run wizard is a real modal dialog —
    // added 2026-09-05 with finding 6. In the app both are classic scripts and ui.jsx loads first, so it is a
    // plain global; here it has to be supplied or the component throws before rendering anything. Its own
    // behaviour is app/ui.jsx's business and is covered by the-first-run-wizard-is-a-real-dialog.test.mjs.
    useDialogA11y: () => {},
    Icon: () => null,
    IconBtn: ({ name, onClick }) => React.createElement('button', { title: name, onClick }),
    Group: ({ children }) => children,
    Row: () => null,
    inviteUrlFor: () => 'https://app.trinityone.church/#s=x',
    D: { RELAYS: [] },
  });

  // ONE MOUNT of the sheet: a fresh hook store, the same module. Returns a driver for it.
  const mount = (church = { npub: 'npub1church', name: 'Trinity LA' }) => {
    rt.cur = miniReact();
    const ctx = { church, safeguard: { guardians: {} }, toast: () => {}, openInvite: () => {}, openRelays: () => {} };
    const props = { open: true, onClose: () => {}, ctx };
    const draw = () => { rt.cur = rt.cur; return rt.cur.draw(mod.FamilySheet, props); };
    // the sheet opens on the children LIST; walk it to the name form the way a parent does
    const add = find(draw(), n => n.type === 'button' && texts(n).join(' ').includes('Add a child'));
    assert.equal(add.length, 1, 'the "Add a child" button is gone from the family sheet — re-anchor this test');
    add[0].props.onClick();
    return {
      draw,
      type: (v) => { const i = find(draw(), n => n.type === 'input')[0]; assert.ok(i, 'the name box is gone — re-anchor this test'); i.props.onChange({ target: { value: v } }); },
      create: async () => {
        const b = find(draw(), n => n.type === 'button' && !n.props.title && texts(n).join(' ').includes('Create the account'));
        assert.equal(b.length, 1, 'the "Create the account" button is gone — re-anchor this test');
        await b[0].props.onClick();
        await tick(); await tick();
        return draw();
      },
    };
  };
  return { mount, calls, minted };
}

// the banner the sheet puts up when an attempt failed — read out of the RENDERED tree, never out of the file
const errorText = (tree) => {
  const box = find(tree, n => n.type === 'div' && n.props.style && n.props.style.color === 'var(--clay-ink)');
  return box.map(n => texts(n).join(' ')).join(' | ');
};

const ALL_LANDED = () => MADE('unused');
const NO_REQUEST = (seed) => FAILED(seed, { join: true, k0: true, name: true });

test('CONTROL: typing a name and tapping Create reaches the engine with a real key', async () => {
  // If this fails, every assertion below is meaningless.
  const a = app({ outcome: () => ALL_LANDED() });
  const m = a.mount();
  m.type('Ellie');
  await m.create();
  assert.equal(a.calls.length, 1, 'the family sheet no longer asks the engine to create anything at all');
  assert.equal(a.calls[0].name, 'Ellie');
  assert.match(String(a.calls[0].mnemonic || ''), /\S/,
    'the screen passed no key, so the engine mints its own and every retry mints another');
});

test('THE FIX: a parent who CLOSES the sheet and comes back finishes the same account', async () => {
  const a = app({ outcome: (n) => (n === 0 ? NO_REQUEST('seed-1') : ALL_LANDED()) });

  const first = a.mount();
  first.type('Ellie');
  const after = await first.create();
  assert.match(errorText(after), /\S/, 'the failed attempt said nothing at all — re-anchor this test');

  // …and now the parent closes the sheet. In app/identity.jsx that is an UNMOUNT: `{family ? <FamilySheet`.
  const second = a.mount();
  second.type('Ellie');
  await second.create();

  assert.equal(a.calls.length, 2, 'the second attempt never reached the engine');
  assert.equal(a.calls[1].mnemonic, a.calls[0].mnemonic,
    'closing the sheet destroyed the child’s key, so tapping Create again made a SECOND account for the ' +
    'same child: a church member whose recovery words nobody has ever seen, with no guardian request and no ' +
    'row in the parent’s Children list, and two links for the steward to judge');
  assert.equal(a.minted.length, 1, 'a second key was minted for a child who already has one');
});

test('…and the retry that succeeds still hands over the words', async () => {
  const a = app({ outcome: (n) => (n === 0 ? NO_REQUEST('seed-1') : ALL_LANDED()) });
  const first = a.mount(); first.type('Ellie'); await first.create();
  const second = a.mount(); second.type('Ellie');
  const tree = await second.create();
  assert.match(texts(tree).join(' '), /Save these 12 words/,
    'the successful retry never reached the screen that hands the parent the recovery words');
});

test('a DIFFERENT child in a fresh sheet never inherits the first child’s key', async () => {
  // Two children sharing one key is worse than the bug being fixed: one account, two people.
  const a = app({ outcome: () => NO_REQUEST('seed-1') });
  const first = a.mount(); first.type('Ellie'); await first.create();
  const second = a.mount(); second.type('Sam Carter'); await second.create();
  assert.notEqual(a.calls[1].mnemonic, a.calls[0].mnemonic,
    'a second child was set up with the first child’s key — one account for two people');
});

test('a different CHURCH never inherits the key, even for the same name', async () => {
  // A parent who stewards or attends two churches: same name, different congregation, different child.
  const a = app({ outcome: () => NO_REQUEST('seed-1') });
  const first = a.mount({ npub: 'npub1church', name: 'Trinity LA' });
  first.type('Ellie'); await first.create();
  const second = a.mount({ npub: 'npub1other', name: 'St Aidan’s' });
  second.type('Ellie'); await second.create();
  assert.notEqual(a.calls[1].mnemonic, a.calls[0].mnemonic,
    'church B’s Ellie was set up with the key minted for church A’s Ellie');
});

test('after a success the key is let go, so the next child gets their own', async () => {
  const a = app({ outcome: () => ALL_LANDED() });
  const first = a.mount(); first.type('Ellie'); await first.create();
  const second = a.mount(); second.type('Ellie'); await second.create();
  assert.notEqual(a.calls[1].mnemonic, a.calls[0].mnemonic,
    'the finished child’s key is still held, so a sibling with the same name would share their account');
});

test('the failure copy promises only what a memory-held key can keep', async () => {
  // The key is deliberately NOT written to disk — a child's twelve words at rest, for as long as a parent
  // never comes back, is a safeguarding credential on a device whose threat model is seizure. So the promise
  // holds while the app is open and not across a restart, and the copy has to say so, or CLAUDE.md rule 4 is
  // broken for the second time on the same sentence. Read off the SCREEN, not out of the file.
  for (const published of [{ join: true, k0: true }, { join: true, k0: true, name: true }]) {
    const a = app({ outcome: (n) => FAILED('seed-' + (n + 1), published) });
    const m = a.mount(); m.type('Ellie');
    const shown = errorText(await m.create());
    assert.match(shown, /try again/i, 'a half-made account does not tell the parent they can retry at all');
    assert.match(shown, /clos(e|ed|ing)/i,
      'the parent is promised "this finishes the same account" with no mention of the one case where it ' +
      'does not — closing the app, which throws the key away: ' + JSON.stringify(shown));
    assert.match(shown, /steward/i, 'the parent who has already closed it is not told who to ask');
  }
});

test('…but "nothing was set up" makes no such promise, because there is nothing to finish', async () => {
  const a = app({ outcome: () => FAILED('seed-1', {}) });
  const m = a.mount(); m.type('Ellie');
  const shown = errorText(await m.create());
  assert.match(shown, /nothing has been set up/i,
    'a parent whose phone never reached the relay is told the account half-exists');
});
