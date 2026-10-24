// A GROUP'S INFO + MEMBERS VIEW SHOWS ONLY THE PEOPLE THE READER IS ALREADY PERMITTED TO SEE.
// Run: node --test scripts/group-info-members-are-gated.test.mjs
//
// Phase 1 of the WhatsApp-style group info: tapping a group's header opens a read-only panel with the group's
// identity (icon, name, description, type) and its protection indicators (invite-only / encrypted /
// child-safe). The members list is NOT inline (owner 2026-10-19): the default screen is clean and shows a
// "N members" BUTTON; the search box + roster + read-only member card open only when that button is tapped.
// Per-member actions (message / make-leader) are phase 2; in-chat message search is phase 3.
//
// THE SAFEGUARDING RULE UNDER TEST. The members a reader sees =
//     (the gated church directory: subscribeChurchMembers ∩ ctx.canDMPeer) ∩ (this group's membership).
// The panel must NEVER enumerate group.memberPubs and resolve names itself: that path has no gate and would
// hand a child the names of other children and uncleared adults. WHO THE READER IS uses the same three-answer
// shape ChatScreen uses — isMinor OR the `assumeMinor` engine answer — not `clearanceKnown` alone (which is
// never set in a church that does not use safeguarding, so gating on it would hang the list on "Checking…"
// for ever). A genuine assumed-minor window still fails SAFE: the roster is withheld until clearance is
// confirmed. An OPEN room has no per-group roster, so it shows "Open to your church" and NO count button and
// NO list. The count on the button is the GATED roster length — consistent with the list it opens, never the
// raw group.members.
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
  [pk('blk')]: { name: 'Bad Actor', handle: 'bad', nip05: '' },      // in the directory AND the group, but canDMPeer rejects
};
const displayFor = (p) => {
  const d = NAMES[p] || { name: 'Member', handle: 'member', nip05: '' };
  return { pubkey: p, handle: d.handle, name: d.name, named: true, color: '#5E8C6A', av: undefined, picture: '', nip05: d.nip05, isChurch: false };
};
// a gated-directory row as subscribeChurchMembers emits it ({ pubkey, name, nip05, ... })
const row = (p) => ({ pubkey: p, name: NAMES[p].name, nip05: NAMES[p].nip05 });
const flush = () => Promise.resolve().then(() => Promise.resolve());   // let an assumeMinor microtask settle

// the "N members" button is the only control carrying aria-expanded
const countBtn = (tree) => find(tree, n => n.type === 'button' && n.props && ('aria-expanded' in n.props));
const btnWords = (b) => texts(b).join(' ').replace(/\s+/g, ' ').trim();   // whitespace-collapsed, for a count match

// ── mount ChatRoom, open the info panel, optionally open the members list, return the rendered tree ─────────
async function openInfo(group, { gatedSource = [], canDM = () => true, safeguard = { clearanceKnown: true, isMinor: false }, assumeMinor, rosters = [], click = true, openList = false } = {}) {
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
  // The engine's three-answer safeguarding verdict (the same call ChatScreen makes). Only installed when a
  // test opts in; absent means "old engine", and the component then falls back to isMinor alone.
  if (assumeMinor !== undefined) Fellowship.assumeMinor = () => Promise.resolve(assumeMinor);
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
    churchRosters: rosters,   // the member app's team rosters (ctx.churchRosters in app/app.jsx)
    safeguard, canDMPeer: canDM, openDM: () => {},
    joinState: { loaded: true, isPending: false, removed: false, offline: false },
  };
  const render = () => draw(mod.ChatRoom, { group, open: true, onClose: () => {}, ctx, docked: true });
  render();           // the room's own subscriptions arrive through effects
  let tree = render();
  if (!click) return { tree, render };
  const btn = find(tree, n => n.props && n.props.role === 'button' && n.props.title === 'Group info');
  assert.equal(btn.length, 1, 'the header has no single "Group info" tap target — re-anchor this test');
  btn[0].props.onClick();
  render();           // GroupInfo mounts; its subscribeChurchMembers + assumeMinor effects run after this draw
  await flush();      // let the assumeMinor promise settle
  tree = render();    // …and this draw sees the members + the resolved assumeMinor verdict
  if (openList) {     // tap the "N members" button to reveal the roster + search + card
    const cb = countBtn(tree);
    assert.equal(cb.length, 1, 'there is no "N members" count button to open the list — re-anchor this test');
    cb[0].props.onClick();
    tree = render();
  }
  return { tree, render };
}

// an invite-only room. memberPubs is the on-the-wire allowlist (the group's membership).
const INVITE = (members) => ({ id: 'g1', name: 'Prayer Partners', sub: 'A small group that prays together', kind: 'Group', invite: true, encrypted: true, childsafe: true, accent: '#7a5', memberPubs: members, members: members.length, openToChurch: false, prayer: false });
// an open room: no allowlist, church-wide
const OPEN = { id: 'g2', name: 'Whole Church', sub: 'One room for everyone', kind: 'Group', invite: false, encrypted: false, childsafe: true, accent: '#58c', memberPubs: null, members: null, openToChurch: true, prayer: false };
// a TEAM room: no memberPubs allowlist; its membership comes from the church roster whose team === id.
const TEAM = { id: 't1', name: 'Welcome Team', sub: 'Door, coffee and a hello', kind: 'Team', team: true, invite: false, encrypted: false, childsafe: true, accent: '#c84', memberPubs: null, members: null, openToChurch: false, prayer: false };
// a roster doc as the member app holds it (app/app.jsx reads r.team and r.people[].pub)
const roster = (teamId, pubs) => ({ team: teamId, people: pubs.map(p => ({ pub: p })) });

const panelText = (tree) => texts(tree).join(' | ');
const memberRow = (tree, name) => find(tree, n => n.type === 'button' && texts(n).some(t => t === name));

// ── 1. tapping the header opens the info panel ──────────────────────────────────────────────────────────────
test('CONTROL: before the tap, the info panel is not on screen', async () => {
  // The header carries a "Group info" title on its tap affordance, so that string is present even closed;
  // the panel's DESCRIPTION and count button are rendered only inside the (closed) overlay, so they are the
  // honest signal that the panel itself is not yet open.
  const { tree } = await openInfo(INVITE([pk('ada')]), { gatedSource: [pk('ada')], click: false });
  assert.doesNotMatch(panelText(tree), /A small group that prays together/, 'the info panel is open before anything was tapped — re-anchor');
  assert.equal(countBtn(tree).length, 0, 'the members count button is on screen before the panel was opened — re-anchor');
});

test('tapping the group header opens a panel with the name, description, type and protection indicators', async () => {
  const { tree } = await openInfo(INVITE([pk('ada'), pk('ben')]), { gatedSource: [pk('ada'), pk('ben')] });
  const t = panelText(tree);
  assert.match(t, /Group info/, 'the tap did not open the info panel');
  assert.match(t, /Prayer Partners/, 'the panel does not show the group name');
  assert.match(t, /A small group that prays together/, 'the panel does not show the description');
  assert.match(t, /Invite-only/, 'the invite-only protection indicator is missing');
  assert.match(t, /Encrypted/, 'the encrypted protection indicator is missing');
  assert.match(t, /Child-safe/, 'the child-safe protection indicator is missing');
});

// ── 1b. (OWNER CHANGE) the roster is behind the count button; the button shows the GATED count ──────────────
test('the members list is hidden until the "N members" button is tapped, and the button shows the gated count', async () => {
  // gated directory ∩ group = Ada + Ben (2). The default panel shows a "2 members" button and NO rows; the
  // rows appear only after the button is tapped.
  const { tree, render } = await openInfo(INVITE([pk('ada'), pk('ben')]), { gatedSource: [pk('ada'), pk('ben')] });
  const cb = countBtn(tree);
  assert.equal(cb.length, 1, 'there is no single "N members" count button');
  assert.match(btnWords(cb[0]), /\b2 members\b/, 'the count button does not show the gated roster count (2)');
  assert.equal(memberRow(tree, 'Ada Lovelace').length, 0, 'a member row is shown before the count button was tapped — the list should be collapsed by default');
  assert.equal(find(tree, n => n.type === 'input').length, 0, 'the search box is shown before the list was opened');
  cb[0].props.onClick();
  const after = render();
  assert.ok(memberRow(after, 'Ada Lovelace').length, 'tapping the count button did not reveal the roster');
  assert.ok(find(after, n => n.type === 'input' && /Search members/i.test(String(n.props.placeholder || ''))).length, 'tapping the count button did not reveal the search box');
});

// ── 2. the list is the GATED SOURCE ∩ group membership ──────────────────────────────────────────────────────
test('the members list is the gated directory ∩ this group’s membership — nothing else', async () => {
  // directory the reader is served: Ada, Ben, Cath.   group allowlist: Ada, Ben, plus a stranger pubkey NOT
  // in the directory. Expect exactly Ada + Ben: Cath is in the directory but not the group, the stranger is
  // in the group but not the directory.
  const { tree } = await openInfo(INVITE([pk('ada'), pk('ben'), pk('str')]), { gatedSource: [pk('ada'), pk('ben'), pk('cat')], openList: true });
  assert.ok(memberRow(tree, 'Ada Lovelace').length, 'a member in both the directory and the group is missing');
  assert.ok(memberRow(tree, 'Ben Carter').length, 'a member in both the directory and the group is missing');
  assert.equal(memberRow(tree, 'Cath Rowe').length, 0, 'someone in the church directory but NOT this group was listed');
  assert.equal(memberRow(tree, 'Sid Stone').length, 0, 'a group pubkey absent from the gated directory was named directly from memberPubs — the exact leak the rule forbids');
});

// ── 2b. (FIX 2) the ctx.canDMPeer narrowing bites at the point of use ───────────────────────────────────────
test('a directory member this reader may NOT contact (canDMPeer rejects) is not listed, even though they are in the group', async () => {
  // Bad Actor is in the gated directory AND in the group's allowlist, but ctx.canDMPeer rejects them (the
  // relay would refuse a DM; a blocked/uncleared peer). The `&& canSee(...)` narrowing at the point of use is
  // the only thing that drops them. Delete it and this test reds (measured at the foot of this file).
  const canDM = (p) => p !== pk('blk');
  const { tree } = await openInfo(INVITE([pk('ada'), pk('blk')]), { gatedSource: [pk('ada'), pk('blk')], canDM, openList: true });
  assert.ok(memberRow(tree, 'Ada Lovelace').length, 're-anchor: the contactable member is missing too, so this proves nothing');
  assert.equal(memberRow(tree, 'Bad Actor').length, 0, 'a member ctx.canDMPeer rejects was listed — the point-of-use narrowing is not applied');
  assert.doesNotMatch(panelText(tree), /Bad Actor/, 'the rejected member’s name leaked into the panel text');
});

// ── 3. THE KEY SAFEGUARDING TEST: a child sees only cleared adults + their guardian ─────────────────────────
test('a CHILD is never shown another child or an uncleared adult, even though both are in the group', async () => {
  // The relay serves a child a gated directory of cleared adults + their guardian ONLY. The group's allowlist
  // additionally contains another child (Mia) and an uncleared adult (Roy). canDMPeer for a child returns
  // false for them too — belt and braces — but the thing under test is the SOURCE: the panel must build on
  // the gated directory, never on memberPubs. Switching the list source to raw memberPubs reddens this.
  const child = { clearanceKnown: true, isMinor: true };
  const canDM = (p) => p === pk('ada') || p === pk('gdn');   // a child may only reach a cleared adult + guardian
  const { tree } = await openInfo(
    INVITE([pk('ada'), pk('gdn'), pk('kid'), pk('unc')]),         // group membership includes a child + an uncleared adult
    { gatedSource: [pk('ada'), pk('gdn')], canDM, safeguard: child, openList: true });
  assert.ok(memberRow(tree, 'Ada Lovelace').length, 'the cleared adult is missing — the child has a blank screen, not a safe one');
  assert.ok(memberRow(tree, 'Mo Khan').length, 'the child’s own guardian is missing');
  assert.equal(memberRow(tree, 'Mia Khan').length, 0, 'ANOTHER CHILD was named to a child');
  assert.equal(memberRow(tree, 'Roy Platt').length, 0, 'an UNCLEARED ADULT was named to a child');
  assert.doesNotMatch(panelText(tree), /Mia Khan|Roy Platt/, 'a withheld name leaked into the panel text');
  // the count button is itself the gated count: a child sees 2 (cleared adult + guardian), never 4
  const cb = find(tree, n => n.type === 'button' && n.props && ('aria-expanded' in n.props));
  assert.ok(cb.length && /\b2 members\b/.test(btnWords(cb[0])), 'the count button showed more than the gated roster to a child');
});

// ── 4. an OPEN room keeps the honest context, with no count button and no roster ────────────────────────────
test('an OPEN room shows "Open to your church" and NO count button / list', async () => {
  const { tree } = await openInfo(OPEN, { gatedSource: [pk('ada'), pk('ben'), pk('cat')] });
  const t = panelText(tree);
  assert.match(t, /Open to your church/, 'an open room no longer carries its honest "open to your church" context');
  assert.equal(countBtn(tree).length, 0, 'an open room drew a members count button — it has no per-group roster to count');
  assert.equal(memberRow(tree, 'Ada Lovelace').length, 0, 'an open room synthesised a per-group member list — it has no roster to show');
});

// ── 4b. (OWNER) a TEAM shows its roster members, gated the same way as an invite group ──────────────────────
test('a TEAM lists its ROSTER members (gated), with the count button showing the gated team-roster count', async () => {
  // Team roster: Ada, Ben, Sid.  Gated directory the reader is served: Ada, Ben, Cath.  So the gated team
  // roster is Ada + Ben — Sid is on the roster but not in the directory this reader may see, Cath is in the
  // directory but not on this team. The membership set comes from the ROSTER (ctx.churchRosters), not any
  // allowlist, and the SAME gated intersection applies.
  const { tree } = await openInfo(TEAM, {
    gatedSource: [pk('ada'), pk('ben'), pk('cat')],
    rosters: [roster('t1', [pk('ada'), pk('ben'), pk('str')])], openList: true });
  const cb = countBtn(tree);
  assert.ok(cb.length && /\b2 members\b/.test(btnWords(cb[0])), 'the count button does not show the gated team-roster count (2)');
  assert.ok(memberRow(tree, 'Ada Lovelace').length, 'a team roster member in the gated directory is missing');
  assert.ok(memberRow(tree, 'Ben Carter').length, 'a team roster member in the gated directory is missing');
  assert.equal(memberRow(tree, 'Sid Stone').length, 0, 'a team roster pubkey absent from the gated directory was named directly from the roster');
  assert.equal(memberRow(tree, 'Cath Rowe').length, 0, 'someone in the directory but NOT on this team was listed');
  assert.doesNotMatch(panelText(tree), /Open to your church/, 'a team was labelled "Open to your church" — that line is only for open non-team groups');
});

// ── 4c. (OWNER + SAFEGUARDING) a CHILD on a team sees only cleared adults + guardian from the roster ─────────
test('a CHILD sees only cleared adults + guardian among a TEAM roster — never another child or uncleared adult', async () => {
  // The team roster contains a cleared adult, the child's guardian, ANOTHER child, and an uncleared adult.
  // The relay serves the child a gated directory of the cleared adult + guardian only; canDMPeer rejects the
  // rest. The membership set is the roster, but the SOURCE is the gated directory — switching to the raw
  // roster reddens this (measured at the foot of the file).
  const child = { clearanceKnown: true, isMinor: true };
  const canDM = (p) => p === pk('ada') || p === pk('gdn');
  const { tree } = await openInfo(TEAM, {
    gatedSource: [pk('ada'), pk('gdn')],
    rosters: [roster('t1', [pk('ada'), pk('gdn'), pk('kid'), pk('unc')])],
    canDM, safeguard: child, openList: true });
  assert.ok(memberRow(tree, 'Ada Lovelace').length, 'the cleared adult on the team is missing — a blank screen, not a safe one');
  assert.ok(memberRow(tree, 'Mo Khan').length, 'the child’s own guardian on the team is missing');
  assert.equal(memberRow(tree, 'Mia Khan').length, 0, 'ANOTHER CHILD on the team was named to a child');
  assert.equal(memberRow(tree, 'Roy Platt').length, 0, 'an UNCLEARED ADULT on the team was named to a child');
  assert.doesNotMatch(panelText(tree), /Mia Khan|Roy Platt/, 'a withheld team-roster name leaked into the panel text');
  const cb = countBtn(tree);
  assert.ok(cb.length && /\b2 members\b/.test(btnWords(cb[0])), 'the count button showed more than the gated team roster to a child');
});

// ── 4d. (OWNER) a team with no roster yet does not crash and is NOT "Open to your church" ───────────────────
test('a TEAM with no roster shows a 0-member button and empty list, never "Open to your church"', async () => {
  const { tree } = await openInfo(TEAM, { gatedSource: [pk('ada')], rosters: [], openList: true });
  const cb = countBtn(tree);
  assert.ok(cb.length && /\b0 members\b/.test(btnWords(cb[0])), 'a team with no roster did not show a 0-member button');
  assert.doesNotMatch(panelText(tree), /Open to your church/, 'a team with no roster was labelled "Open to your church"');
  assert.match(panelText(tree), /No one to show here/, 'an opened empty team list gave no account of itself');
});

// ── 5. starts-with search: name-word prefix OR @handle prefix; a mid-word substring matches nobody ──────────
test('search matches a name-word prefix and an @handle prefix, but not a mid-word substring', async () => {
  const group = INVITE([pk('ada'), pk('ben'), pk('cat')]);
  const source = [pk('ada'), pk('ben'), pk('cat')];   // Ada Lovelace, Ben Carter, Cath Rowe
  const type = (render, tree, q) => {
    const box = find(tree, n => n.type === 'input' && /Search members/i.test(String(n.props.placeholder || '')))[0];
    assert.ok(box, 'the members search box is gone — re-anchor');
    box.props.onChange({ target: { value: q } });
    return render();
  };
  // "lov" is a prefix of the WORD "Lovelace" in "Ada Lovelace" → matches Ada only
  let { tree, render } = await openInfo(group, { gatedSource: source, openList: true });
  let r = type(render, tree, 'lov');
  assert.ok(memberRow(r, 'Ada Lovelace').length, 'a name-word prefix ("lov" → "Lovelace") did not match');
  assert.equal(memberRow(r, 'Ben Carter').length, 0, 'search returned a non-matching member');

  // "ove" is a MID-WORD substring of "Lovelace" (not a word start) → matches nobody
  ({ tree, render } = await openInfo(group, { gatedSource: source, openList: true }));
  r = type(render, tree, 'ove');
  assert.equal(memberRow(r, 'Ada Lovelace').length, 0, 'a mid-word substring ("ove") matched — the search is substring, not starts-with');
  assert.doesNotMatch(panelText(r), /Ada Lovelace|Ben Carter|Cath Rowe/, 'a mid-word substring matched someone');

  // "ada" is Ada's @handle prefix (and also her name-word) → matches
  ({ tree, render } = await openInfo(group, { gatedSource: source, openList: true }));
  r = type(render, tree, 'ada');
  assert.ok(memberRow(r, 'Ada Lovelace').length, 'an @handle prefix did not match');
});

// ── 6a. (FIX 1) the feature WORKS in a church that does not use safeguarding ────────────────────────────────
test('a church that clears nobody (clearanceKnown never true) still shows the members list to an adult', async () => {
  // This is the normal, permanent state of most churches: nobody is ever cleared, so the member's own
  // clearanceKnown never becomes true. The engine's assumeMinor answers FALSE ("this church clears nobody"),
  // so the reader is treated as an adult and the gated list must open — not hang on "Checking…" for ever.
  const { tree, render } = await openInfo(INVITE([pk('ada'), pk('ben')]),
    { gatedSource: [pk('ada'), pk('ben')], canDM: () => true, safeguard: { isMinor: false }, assumeMinor: false });
  assert.doesNotMatch(panelText(tree), /Checking who you can see/i,
    'the members section hung on "Checking…" in a church that never uses safeguarding — the feature is dead for most churches');
  const cb = countBtn(tree);
  assert.equal(cb.length, 1, 'no "N members" button rendered for an adult in a non-safeguarding church');
  cb[0].props.onClick();
  const after = render();
  assert.ok(memberRow(after, 'Ada Lovelace').length, 'the gated members list did not open for an adult in a non-safeguarding church');
  assert.ok(memberRow(after, 'Ben Carter').length, 'the gated members list did not open for an adult in a non-safeguarding church');
});

// ── 6b. cold start fails safe (genuine unknown-minor ⇒ treated as a minor, roster withheld) ─────────────────
test('a genuine unknown reader (assumeMinor true, clearance not confirmed) fails closed and says it is checking', async () => {
  // Safeguarding IS in use here and the engine has not heard about this member, so assumeMinor is TRUE while
  // clearanceKnown is still false. Even with a full gated directory and a permissive canDMPeer (which can be
  // answering from an empty approved-list in this window), NO name and NO count button may show.
  const { tree } = await openInfo(INVITE([pk('ada'), pk('ben'), pk('kid')]),
    { gatedSource: [pk('ada'), pk('ben'), pk('kid')], canDM: () => true, safeguard: { isMinor: false }, assumeMinor: true });
  const t = panelText(tree);
  assert.match(t, /Checking who you can see/i, 'a genuine unknown reader got no honest "still checking" account');
  assert.equal(countBtn(tree).length, 0, 'a count button was shown while the reader might be a minor and clearance was unconfirmed');
  assert.doesNotMatch(t, /Ada Lovelace|Ben Carter|Mia Khan/, 'a member name was shown while the reader might be a minor and clearance was unconfirmed — an absent answer is not a "no"');
});

// ── the read-only card (phase 1): tap a member, get a card, and NO per-member action ────────────────────────
test('tapping a member opens a read-only card — no message / leader action in phase 1', async () => {
  const { tree, render } = await openInfo(INVITE([pk('ada'), pk('ben')]), { gatedSource: [pk('ada'), pk('ben')], openList: true });
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
// be scoped". Measured on this machine against the 14-test suite:
//   · the fixed screen                                                          14 pass / 0 fail
//   · the list source enumerated directly from the membership SET, no canSee      9 pass / 5 fail
//        (both CHILD tests red — invite AND team: a child is shown Mia Khan + Roy Platt — plus the two
//         intersection tests and the canDMPeer-narrowing test. This is the exact anti-pattern the owner's
//         rule forbids, and it is the one that matters most.)
//   · the count button showing raw group.members instead of roster.length         (reds the gated-count tests:
//        a child on a 4-person team would read "4 members", not the gated 2)
// Carried from the earlier rounds (same slices, still hold): the roster rendered inline (the "hidden until
// tapped" test reds), `iAmMinor` gated on `clearanceKnown` alone (the non-safeguarding-church test reds on
// "Checking…"), `minorUnconfirmed` forced false (the genuine-unknown fail-safe test reds), and the
// starts-with matcher replaced with includes() (the search test reds on the "ove" mid-word case).
