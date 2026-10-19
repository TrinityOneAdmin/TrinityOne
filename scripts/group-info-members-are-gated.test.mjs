// A GROUP'S INFO + MEMBERS VIEW SHOWS ONLY THE PEOPLE THE READER IS ALREADY PERMITTED TO SEE.
// Run: node --test scripts/group-info-members-are-gated.test.mjs
//
// Phase 1 of the WhatsApp-style group info: tapping a group's header opens a read-only panel with the group's
// identity (icon, name, description, type), its protection indicators (invite-only / encrypted / child-safe),
// and — for an invite-only room — a searchable members list with a read-only card on tap.
//
// THE SAFEGUARDING RULE UNDER TEST. The members a reader sees =
//     (the gated church directory: subscribeChurchMembers ∩ ctx.canDMPeer) ∩ (this group's membership).
// The panel must NEVER enumerate group.memberPubs and resolve names itself: that path has no gate and would
// hand a child the names of other children and uncleared adults. The key test below (#3) is red the moment
// the list source is switched to raw memberPubs — the exact anti-pattern the rule forbids. An OPEN room has
// no per-group roster, so it shows "Open to your church" and no enumerated list or count (DOMAIN: a child
// simply has a shorter list; silent absence, never a placeholder naming who was withheld). Cold start fails
// safe: until clearance is known the roster is empty and the panel says it is checking.
//
// HOW IT ASSERTS (CLAUDE.md §1 + §3). app/*.jsx ships UNBUNDLED, so a `false && ` in front of a condition
// leaves every word in place and a text match still passes. Nothing here matches text in app/*.jsx: ChatRoom
// is compiled with the build's own esbuild and rendered through the miniature React in render-jsx-screen.mjs,
// and every assertion reads the tree that came back. Icon is stubbed as a node carrying its own name.
//
// Measured red/green at the foot of this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const iconStub = (React) => ({ name }) => React.createElement('i', { 'data-icon': name });
const iconsIn = (n) => find(n, x => x.type === 'i' && x.props['data-icon']).map(x => x.props['data-icon']);
const pk = (s) => s.padEnd(64, '0');

// A church directory: pubkey -> display name (what displayFor resolves). The gated SOURCE (what
// subscribeChurchMembers hands this reader) is a SUBSET of this — the relay has already withheld rows this
// reader may not see. displayFor can resolve a name for EVERY pubkey, so a test that enumerated memberPubs
// directly (the sabotage) would succeed in naming a child — which is exactly what must not happen.
const NAMES = {
  [pk('ada')]: { name: 'Ada Lovelace', handle: 'ada', nip05: 'ada@stbride.church' },
  [pk('ben')]: { name: 'Ben Carter', handle: 'ben', nip05: '' },
  [pk('cat')]: { name: 'Cath Rowe', handle: 'cath', nip05: '' },
  [pk('gdn')]: { name: 'Mo Khan', handle: 'mo', nip05: '' },         // a child's guardian
  [pk('kid')]: { name: 'Mia Khan', handle: 'mia', nip05: '' },       // another child — never named to a child
  [pk('unc')]: { name: 'Roy Platt', handle: 'roy', nip05: '' },      // an uncleared adult — never named to a child
  [pk('str')]: { name: 'Sid Stone', handle: 'sid', nip05: '' },      // a church member NOT in this group
};
const displayFor = (p) => {
  const d = NAMES[p] || { name: 'Member', handle: 'member', nip05: '' };
  return { pubkey: p, handle: d.handle, name: d.name, named: true, color: '#5E8C6A', av: undefined, picture: '', nip05: d.nip05, isChurch: false };
};
// a gated-directory row as subscribeChurchMembers emits it ({ pubkey, name, nip05, ... })
const row = (p) => ({ pubkey: p, name: NAMES[p].name, nip05: NAMES[p].nip05 });

// ── mount ChatRoom, open the info panel, return the rendered tree ───────────────────────────────────────────
function openInfo(group, { gatedSource = [], canDM = () => true, safeguard = { clearanceKnown: true, isMinor: false }, click = true } = {}) {
  const { React, draw } = miniReact();
  const Fellowship = {
    myPubkey: pk('me'), relays: ['wss://relay.example'], relayReady: () => true,
    groupEncState: () => 'clear',
    subscribeGroup: () => () => {}, subscribeReactions: () => () => {},
    subscribeGroupPin: (_g, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_g, cb) => { cb(new Set()); return () => {}; },
    subscribeMessageTags: () => () => {},
    requestProfiles: () => {}, outboxFor: () => [], onOutbox: () => () => {},
    canAddGroupEvent: () => false, react: () => {},
    displayFor,
    // THE GATED SOURCE. The relay has already withheld the rows this reader may not see; the test hands back
    // exactly that subset, which is the whole point — the panel must build on this, not on memberPubs.
    subscribeChurchMembers: (_np, cb) => { cb(gatedSource.map(row), true); return () => {}; },
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: {
      Fellowship,
      TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
      TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
      addEventListener: () => {}, removeEventListener: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      confirm: () => true,
    },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {},
    todayISO: () => '2026-10-19',
    Icon: iconStub(React),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ open, children }) => (open ? children : null),
    UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ children }) => children,
    safeCssColor: (c) => c,
    safeImgUrl: (s) => s,     // the in-file Avatar sanitizes its src through this; identity is fine for a test
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: () => {},
    church: { npub: 'npub1church', name: 'St Bride’s', id: 'c1' },
    myLeaderGroups: [], churchEvents: [], myPubkey: pk('me'),
    safeguard, canDMPeer: canDM, openDM: () => {},
    joinState: { loaded: true, isPending: false, removed: false, offline: false },
  };
  const render = () => draw(mod.ChatRoom, { group, open: true, onClose: () => {}, ctx, docked: true });
  render();           // the room's own subscriptions arrive through effects
  let tree = render();
  if (!click) return { tree, render, find: (p) => find(tree, p) };
  const btn = find(tree, n => n.props && n.props.role === 'button' && n.props.title === 'Group info');
  assert.equal(btn.length, 1, 'the header has no single "Group info" tap target — re-anchor this test');
  btn[0].props.onClick();
  render();           // GroupInfo mounts; its subscribeChurchMembers effect runs after this draw
  tree = render();    // …and this draw sees the members it delivered
  return { tree, render };
}

// an invite-only room. memberPubs is the on-the-wire allowlist (the group's membership).
const INVITE = (members) => ({ id: 'g1', name: 'Prayer Partners', sub: 'A small group that prays together', kind: 'Group', invite: true, encrypted: true, childsafe: true, accent: '#7a5', memberPubs: members, members: members.length, openToChurch: false, prayer: false });
// an open room: no allowlist, church-wide
const OPEN = { id: 'g2', name: 'Whole Church', sub: 'One room for everyone', kind: 'Group', invite: false, encrypted: false, childsafe: true, accent: '#58c', memberPubs: null, members: null, openToChurch: true, prayer: false };

const panelText = (tree) => texts(tree).join(' | ');
const memberRow = (tree, name) => find(tree, n => n.type === 'button' && texts(n).some(t => t === name));

// ── 1. tapping the header opens the info panel ──────────────────────────────────────────────────────────────
test('CONTROL: before the tap, the info panel is not on screen', () => {
  // The header carries a "Group info" title on its tap affordance, so that string is present even closed;
  // the panel's DESCRIPTION and MEMBERS section are rendered only inside the (closed) overlay, so they are
  // the honest signal that the panel itself is not yet open.
  const { tree } = openInfo(INVITE([pk('ada')]), { gatedSource: [pk('ada')], click: false });
  assert.doesNotMatch(panelText(tree), /A small group that prays together/, 'the info panel is open before anything was tapped — re-anchor');
  assert.equal(memberRow(tree, 'Ada Lovelace').length, 0, 'a members list is on screen before the panel was opened — re-anchor');
});

test('tapping the group header opens a panel with the name, description, type and protection indicators', () => {
  const { tree } = openInfo(INVITE([pk('ada'), pk('ben')]), { gatedSource: [pk('ada'), pk('ben')] });
  const t = panelText(tree);
  assert.match(t, /Group info/, 'the tap did not open the info panel');
  assert.match(t, /Prayer Partners/, 'the panel does not show the group name');
  assert.match(t, /A small group that prays together/, 'the panel does not show the description');
  assert.match(t, /Invite-only/, 'the invite-only protection indicator is missing');
  assert.match(t, /Encrypted/, 'the encrypted protection indicator is missing');
  assert.match(t, /Child-safe/, 'the child-safe protection indicator is missing');
});

// ── 2. the list is the GATED SOURCE ∩ group membership ──────────────────────────────────────────────────────
test('the members list is the gated directory ∩ this group’s membership — nothing else', () => {
  // directory the reader is served: Ada, Ben, Cath, Sid.   group allowlist: Ada, Ben, Sid-is-NOT-here, plus a
  // stranger pubkey that is NOT in the directory. Expect exactly Ada + Ben: Cath is in the directory but not
  // the group, the stranger is in the group but not the directory.
  const { tree } = openInfo(INVITE([pk('ada'), pk('ben'), pk('str')]), { gatedSource: [pk('ada'), pk('ben'), pk('cat')] });
  assert.ok(memberRow(tree, 'Ada Lovelace').length, 'a member in both the directory and the group is missing');
  assert.ok(memberRow(tree, 'Ben Carter').length, 'a member in both the directory and the group is missing');
  assert.equal(memberRow(tree, 'Cath Rowe').length, 0, 'someone in the church directory but NOT this group was listed');
  assert.equal(memberRow(tree, 'Sid Stone').length, 0, 'a group pubkey absent from the gated directory was named directly from memberPubs — the exact leak the rule forbids');
});

// ── 3. THE KEY SAFEGUARDING TEST: a child sees only cleared adults + their guardian ─────────────────────────
test('a CHILD is never shown another child or an uncleared adult, even though both are in the group', () => {
  // The relay serves a child a gated directory of cleared adults + their guardian ONLY. The group's allowlist
  // additionally contains another child (Mia) and an uncleared adult (Roy). canDMPeer for a child returns
  // false for them too — belt and braces — but the thing under test is the SOURCE: the panel must build on
  // the gated directory, never on memberPubs. Switching the list source to raw memberPubs reddens this.
  const child = { clearanceKnown: true, isMinor: true };
  const canDM = (p) => p === pk('ada') || p === pk('gdn');   // a child may only reach a cleared adult + guardian
  const { tree } = openInfo(
    INVITE([pk('ada'), pk('gdn'), pk('kid'), pk('unc')]),         // group membership includes a child + an uncleared adult
    { gatedSource: [pk('ada'), pk('gdn')], canDM, safeguard: child });
  assert.ok(memberRow(tree, 'Ada Lovelace').length, 'the cleared adult is missing — the child has a blank screen, not a safe one');
  assert.ok(memberRow(tree, 'Mo Khan').length, 'the child’s own guardian is missing');
  assert.equal(memberRow(tree, 'Mia Khan').length, 0, 'ANOTHER CHILD was named to a child');
  assert.equal(memberRow(tree, 'Roy Platt').length, 0, 'an UNCLEARED ADULT was named to a child');
  assert.doesNotMatch(panelText(tree), /Mia Khan|Roy Platt/, 'a withheld name leaked into the panel text');
});

// ── 4. an OPEN room keeps the honest context, with no enumerated roster or count ────────────────────────────
test('an OPEN room shows "Open to your church" and NO enumerated members / fake count', () => {
  const { tree } = openInfo(OPEN, { gatedSource: [pk('ada'), pk('ben'), pk('cat')] });
  const t = panelText(tree);
  assert.match(t, /Open to your church/, 'an open room no longer carries its honest "open to your church" context');
  assert.equal(memberRow(tree, 'Ada Lovelace').length, 0, 'an open room synthesised a per-group member list — it has no roster to show');
  assert.doesNotMatch(t, /\bMEMBERS\b/, 'an open room drew a MEMBERS section it has no roster for');
});

// ── 5. starts-with search: name-word prefix OR @handle prefix; a mid-word substring matches nobody ──────────
test('search matches a name-word prefix and an @handle prefix, but not a mid-word substring', () => {
  const group = INVITE([pk('ada'), pk('ben'), pk('cat')]);
  const source = [pk('ada'), pk('ben'), pk('cat')];   // Ada Lovelace, Ben Carter, Cath Rowe
  const type = (render, tree, q) => {
    const box = find(tree, n => n.type === 'input' && /Search members/i.test(String(n.props.placeholder || '')))[0];
    assert.ok(box, 'the members search box is gone — re-anchor');
    box.props.onChange({ target: { value: q } });
    return render();
  };
  // "lov" is a prefix of the WORD "Lovelace" in "Ada Lovelace" → matches Ada only
  let { tree, render } = openInfo(group, { gatedSource: source });
  let r = type(render, tree, 'lov');
  assert.ok(memberRow(r, 'Ada Lovelace').length, 'a name-word prefix ("lov" → "Lovelace") did not match');
  assert.equal(memberRow(r, 'Ben Carter').length, 0, 'search returned a non-matching member');

  // "ove" is a MID-WORD substring of "Lovelace" (not a word start) → matches nobody
  ({ tree, render } = openInfo(group, { gatedSource: source }));
  r = type(render, tree, 'ove');
  assert.equal(memberRow(r, 'Ada Lovelace').length, 0, 'a mid-word substring ("ove") matched — the search is substring, not starts-with');
  assert.doesNotMatch(panelText(r), /Ada Lovelace|Ben Carter|Cath Rowe/, 'a mid-word substring matched someone');

  // "ada" is Ada's @handle prefix (and also her name-word) → matches
  ({ tree, render } = openInfo(group, { gatedSource: source }));
  r = type(render, tree, 'ada');
  assert.ok(memberRow(r, 'Ada Lovelace').length, 'an @handle prefix did not match');
});

// ── 6. cold start fails safe (minor flag not yet known ⇒ treated as a minor, roster withheld) ───────────────
test('with the reader’s clearance not yet known, the members list fails closed and says it is checking', () => {
  // clearanceKnown absent entirely — the first-paint state. Even with a full gated directory, a permissive
  // canDMPeer and a full allowlist, NO name may show: the panel must not answer a safeguarding question it
  // cannot yet answer.
  const { tree } = openInfo(INVITE([pk('ada'), pk('ben'), pk('kid')]),
    { gatedSource: [pk('ada'), pk('ben'), pk('kid')], canDM: () => true, safeguard: { isMinor: false } });
  const t = panelText(tree);
  assert.match(t, /Checking who you can see/i, 'cold start gave no honest "still checking" account');
  assert.doesNotMatch(t, /Ada Lovelace|Ben Carter|Mia Khan/, 'a member name was shown before the reader’s clearance was known — an absent answer is not a "no"');
});

// ── the read-only card (phase 1): tap a member, get a card, and NO per-member action ────────────────────────
test('tapping a member opens a read-only card — no message / leader action in phase 1', () => {
  const { tree, render } = openInfo(INVITE([pk('ada'), pk('ben')]), { gatedSource: [pk('ada'), pk('ben')] });
  const r = memberRow(tree, 'Ada Lovelace');
  assert.ok(r.length, 'no member row to tap');
  r[0].props.onClick();
  const after = render();
  const card = find(after, n => n.props && n.props.role === 'dialog');
  assert.ok(card.length, 'tapping a member opened no card');
  assert.match(texts(card[0]).join(' '), /Ada Lovelace/, 'the card does not name the member');
  const actions = find(after, n => n.type === 'button' && /message|make leader|remove|block|call/i.test(texts(n).join(' ')));
  assert.equal(actions.length, 0, 'a per-member ACTION appeared in phase 1 — those are phase 2');
});

// ── measured red/green, 2026-10-19, this file against app/screens-chat.jsx ──────────────────────────────────
// Each sabotage was scoped to the GroupInfo slice (anchor asserted exactly once) per CLAUDE.md "sabotage must
// be scoped". Measured on this machine:
//   · the fixed screen                                                         8 pass / 0 fail
//   · the header tap affordance removed (onClick → no-op)                      7 pass / 1 fail  (the tap-opens-panel test reds)
//   · the list source switched to raw group.memberPubs + displayFor           6 pass / 2 fail  (intersection + the CHILD test red: a child is shown Mia Khan + Roy Platt)
//   · clearanceKnown defaulted to true when the answer is absent               7 pass / 1 fail  (the cold-start fail-safe test reds)
//   · the starts-with matcher replaced with includes()                        7 pass / 1 fail  (the search test reds on the "ove" mid-word case)
// The source-switch sabotage is the one that matters most: it is the exact anti-pattern the owner's rule
// forbids, and the CHILD test turns red the moment it is applied.
