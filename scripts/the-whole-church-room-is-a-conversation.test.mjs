// A NEW CHURCH GETS A WHOLE-CHURCH ROOM IT CAN TALK IN — AND STILL GETS A VOICE OF ITS OWN.
// Run: node --test scripts/the-whole-church-room-is-a-conversation.test.mjs
//
// Owner, 2026-09-01: the whole-church room should be a chat everyone can post in, with broadcast a
// distinctly separate thing. Until today the one room every new church got — "Whole Church" — shipped as
// kind:'broadcast', which is the one room nobody in the congregation could speak in.
//
// WHY THE FIX IS NOT A ONE-WORD FLIP, AND WHAT THIS FILE IS REALLY GUARDING.
// `kind: 'broadcast'` is not only a posting restriction. It is the only mark that says "this room is the
// church's own voice", and several features find that room BY KIND and get `undefined` when a church has
// none. The chain, read at d1f9d15 (scripts/gateway.mjs, line numbers as they stood):
//
//   note()            c.kind === 'broadcast'  ->  BROADCAST.add(id)      the ONLY writer of that set
//   push (kind 1)     if (!gid || !BROADCAST.has(gid)) return            <- the announcement push
//   write gate        if (g && BROADCAST.has(g)) { church/network/steward only }
//   event gate        if (BROADCAST.has(g)) return false                 "the church's own voice by definition"
//
// and outside the relay: app/stew-finance.jsx, app/stew-meals.jsx and the console's Today card all do
// `groups.find(g => g.kind === 'broadcast')`, and the member app's announcement feed is the broadcast
// groups' messages. So a `whole` that simply became a group with nothing replacing it would have left a
// brand-new church unable to notify its members of anything at all, silently — the announcement push has
// no else-branch and no log. The guard that matters is therefore not "whole is a group" on its own; it is
// "whole is a group AND the default set still contains exactly one broadcast", and both are asserted below.
//
// This is a DEFAULTS change. BROADCAST is derived per-group from each group document, never from a fixed
// id, and nothing in this change rewrites a room that already exists — a church set up before today keeps
// its rooms exactly as they are. Nothing here claims otherwise, and nothing here tests the relay: the
// chain above is why the default set must keep a broadcast, not something this file proves.
//
// HOW IT ASSERTS. CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so `false && ` in front of a condition
// leaves every word of it in place and a text-matching assertion still passes. Nothing here matches text in
// app/*.jsx. The REAL first-run wizard is compiled with the build's own esbuild and rendered through the
// miniature React in scripts/render-jsx-screen.mjs; the steward is walked through name -> twelve words ->
// PIN -> spaces exactly as a real one is, the rooms are read off the screen, and the group documents are
// the ones the screen actually handed to Steward.publishGroup. The last test feeds those very documents
// into the real member-app ChatRoom, so "a member can post in it" is answered by the member's screen.
//
// MEASURED RED/GREEN, 2026-09-01, this file against app/stew-dashboard.jsx. Every anchor was sliced out of
// StewSetupWizard and asserted to occur EXACTLY ONCE inside that function before the edit, per CLAUDE.md
// "sabotage must be scoped" — a plain string-replace hits a near-identical sibling. See the log at the
// bottom of this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const tick = () => new Promise(r => setTimeout(r, 0));

// ── the real wizard, driven the way a steward drives it ───────────────────────────────────────────────────
// Every external name the console file reaches for is supplied explicitly; loadScreen throws a ReferenceError
// for one that is missing, which is the correct outcome — a silently-stubbed global is how a test ends up
// asserting about something that is not the code.
function wizard() {
  const { React, draw } = miniReact();
  const published = [];
  const win = {
    Steward: {
      npub: 'npub1church',
      exportMnemonic: () => '',            // an imported key: the twelve-word quiz has nothing to quiz
      isSelfHosted: () => false,
      needsPin: true,
      hasPinLock: () => false,
      publishProfile: async () => true,
      ensureJoinPolicy: async () => true,
      setPin: async () => true,
      publishGroup: (g) => { published.push(g); return { id: 'gid' + published.length, ...g }; },
      publishGroupKey: async () => true,
      publishMeeting: async () => ({ id: 'm' }),
      publishRoster: async () => true,
      addRelay: () => true,
      registerWithRelay: async () => true,
    },
    TEAM_PRESETS: [],
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener: () => {}, removeEventListener: () => {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['StewSetupWizard'], {
    React,
    window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Icon: () => null,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    // both live in app/stew-console.jsx, which loads into the same global scope in the real console
    _wizMeetingId: (() => { let n = 0; return () => 'wm' + (++n); })(),
    WizMeetings: () => null,
  });
  const props = {
    church: { name: 'St Aidan’s', npub: 'npub1church', features: {} },
    onDone: () => {}, onTab: () => {}, onInvite: () => {}, onNewPost: () => {},
  };
  let tree = draw(mod.StewSetupWizard, props);
  const redraw = () => (tree = draw(mod.StewSetupWizard, props));
  const buttons = () => find(tree, n => n.type === 'button');
  const label = (b) => texts(b).join(' ');
  const clickText = async (re) => {
    const b = buttons().find(x => re.test(label(x)));
    assert.ok(b, `no button matching ${re} — the wizard changed shape, re-anchor this test`);
    await b.props.onClick({ preventDefault() {}, currentTarget: {} });
    await tick();
    return redraw();
  };
  const typeInto = (aria, value) => {
    const i = find(tree, n => n.type === 'input' && n.props['aria-label'] === aria)[0];
    assert.ok(i, `no input labelled "${aria}" — re-anchor`);
    i.props.onChange({ target: { value } });
  };
  return { published, tree: () => tree, redraw, buttons, label, clickText, typeInto, find, props };
}

// Walk the real wizard to the "spaces" step: church name -> twelve words -> PIN.
async function toSpaces() {
  const w = wizard();
  await w.clickText(/Continue/);                        // 0: the church's name
  await w.clickText(/Continue/);                        // 1: the twelve words (nothing to quiz on an import)
  w.typeInto('PIN or passphrase', 'a correct horse battery');
  w.typeInto('Repeat the PIN or passphrase', 'a correct horse battery');
  w.redraw();
  await w.clickText(/Set a PIN/);                       // 2: lock this device
  const shown = texts(w.tree()).join(' | ');
  assert.match(shown, /Create a few spaces/, 'the wizard did not reach the spaces step — re-anchor this test');
  return w;
}

// The starter rooms as they are ON THE SCREEN: one entry per offered row, read out of the rendered tree.
// A row is a button keyed by the starter id; its two text lines are the name (plus any kind badge) and the
// blurb underneath.
function rows(w) {
  const rowButtons = find(w.tree(), n => n.type === 'button' && n.props.key && n.props.onClick && texts(n).some(t => t === 'check' || true) && find(n, m => m.type === 'div').length >= 3);
  // narrow to the starter rows: a starter row is a keyed button that is NOT one of the footer's sk-btn
  const starters = rowButtons.filter(b => !String(b.props.className || '').includes('sk-btn'));
  assert.ok(starters.length >= 3, 'the starter rooms are no longer rendered as keyed rows — re-anchor');
  return starters.map(b => {
    const lines = find(b, n => n.type === 'div' && n.props.style && (n.props.style.fontWeight === 700 || n.props.style.fontSize === 12.5));
    return {
      id: String(b.props.key),
      node: b,
      title: texts(lines.find(l => l.props.style.fontWeight === 700) || {}).join(' ').trim(),
      blurb: texts(lines.find(l => l.props.style.fontSize === 12.5) || {}).join(' ').trim(),
      ticked: !!find(b, n => n.type === 'div' && n.props.style && n.props.style.borderRadius === 999)
        .some(n => n.props.style.background === 'var(--clay)'),
    };
  });
}

// Tick everything off, then take whatever the primary button does.
const untickAll = async (w) => {
  for (const r of rows(w)) if (r.ticked) { r.node.props.onClick({ preventDefault() {}, currentTarget: {} }); w.redraw(); }
};

// ── 1. the defaults ───────────────────────────────────────────────────────────────────────────────────────

test('CONTROL: the wizard reaches the spaces step and Create really publishes the ticked rooms', async () => {
  // If this fails, every assertion below is about a screen that never published anything.
  const w = await toSpaces();
  const offered = rows(w);
  assert.ok(offered.length >= 4, `only ${offered.length} starter rooms are offered — re-anchor this test`);
  await w.clickText(/Create \d+ & continue/);
  assert.equal(w.published.length, offered.filter(r => r.ticked).length,
    'the number of rooms published is not the number that were ticked on screen');
  for (const g of w.published) {
    assert.ok(g.name && g.kind, 'a published starter room has no name or no kind');
  }
});

test('a new church can TALK to itself: the whole-church room is one the congregation can post in', async () => {
  const w = await toSpaces();
  await w.clickText(/Create \d+ & continue/);
  const whole = w.published.find(g => /whole church/i.test(g.name || ''));
  assert.ok(whole, 'no whole-church room is created by default at all — a new church has nowhere everyone meets');
  assert.notEqual(whole.kind, 'broadcast',
    'the whole-church room is still a broadcast: the ONE room every new church gets is the one room nobody ' +
    'in the congregation can speak in. The relay refuses a member\'s post there (BROADCAST.has(g) in the ' +
    'write gate) and the member app hides the composer, so the room reads as broken rather than as a notice board');
  assert.equal(whole.kind, 'group',
    'the whole-church room is neither a broadcast nor a group — an unknown kind falls through every branch ' +
    'that decides who may post');
});

test('…and it can still SPEAK to everyone: the default set holds exactly one broadcast room', async () => {
  const w = await toSpaces();
  await w.clickText(/Create \d+ & continue/);
  const casts = w.published.filter(g => g.kind === 'broadcast');
  assert.notEqual(casts.length, 0,
    'a brand-new church is created with NO broadcast room. The relay pushes an announcement only for a group ' +
    'in BROADCAST, and BROADCAST is fed solely by kind === "broadcast" — so this church can notify its ' +
    'members of nothing, ever, with no error anywhere. The console\'s Today card, the finance statement ' +
    'share and the meal-train announcement all do find(g => g.kind === "broadcast") and get undefined too');
  assert.equal(casts.length, 1,
    `${casts.length} broadcast rooms are created by default. Every one of the finders above takes the FIRST, ` +
    'so which room the church announces into becomes an accident of ordering');
  assert.doesNotMatch(casts[0].name || '', /whole church/i,
    'the broadcast room is the whole-church room again — the two must be separate rooms');
});

test('Prayer is still offered and still ticked by default', async () => {
  const w = await toSpaces();
  const prayer = rows(w).find(r => /prayer/i.test(r.title));
  assert.ok(prayer, 'the Prayer room is no longer offered');
  assert.equal(prayer.ticked, true, 'the Prayer room is no longer ticked by default — the owner asked for it');
  await w.clickText(/Create \d+ & continue/);
  assert.ok(w.published.some(g => /prayer/i.test(g.name || '')), 'Prayer was ticked on screen but never published');
});

test('unticking everything publishes NOTHING — a church is still imposed on by nobody', async () => {
  const w = await toSpaces();
  await untickAll(w);
  assert.equal(rows(w).filter(r => r.ticked).length, 0, 'the rows did not untick — re-anchor this test');
  await w.clickText(/Skip for now/);
  assert.deepEqual(w.published, [],
    'a steward who unticked every room still had rooms created for them. Members read imposed rooms as ' +
    'statements about themselves — see scripts/wizard-no-imposed-groups.test.mjs');
});

test('no two starter rooms share a name or a blurb', async () => {
  // wizard-no-imposed-groups.test.mjs opens with this exact failure: two seeders drew the same strings, and
  // "Announcements for everyone" sat on both Announcements and Whole Church while "A midweek small group"
  // sat on two others. Adding a fourth room is precisely when that happens again, so it is asserted rather
  // than warned about. Read off the rendered screen, not the source.
  const w = await toSpaces();
  const offered = rows(w);
  const blurbs = offered.map(r => r.blurb);
  const titles = offered.map(r => r.title);
  for (const r of offered) {
    assert.ok(r.title, `a starter room renders no name (id ${r.id})`);
    assert.ok(r.blurb, `"${r.title}" renders no blurb, so nothing on screen says what it is for`);
  }
  assert.equal(new Set(blurbs).size, blurbs.length,
    'two starter rooms are described by the same words: ' + blurbs.join(' / '));
  assert.equal(new Set(titles).size, titles.length,
    'two starter rooms carry the same name: ' + titles.join(' / '));
  // …and the word that used to sit on the whole-church room must now sit only on the room that IS the
  // announcements, or the two are indistinguishable again in the one place it matters most.
  const announcey = offered.filter(r => /announce|notice/i.test(r.title + ' ' + r.blurb));
  assert.equal(announcey.length, 1,
    'more than one starter room describes itself as the announcements: ' + announcey.map(r => r.title).join(' / '));
});

// ── 2. the point of use: what a MEMBER gets ───────────────────────────────────────────────────────────────
// The rooms above are group documents. This renders the real member-app ChatRoom over one of them and asks
// the only question that matters: can the person standing in it say anything?

function memberRoom(groupDoc) {
  const { React, draw } = miniReact();
  // the member app re-cases the published kind on its way into the room list; mirror that mapping exactly
  const group = {
    id: groupDoc.id || 'g1',
    name: groupDoc.name,
    kind: groupDoc.kind === 'broadcast' ? 'Broadcast' : groupDoc.kind === 'team' ? 'Team' : 'Group',
    broadcast: groupDoc.kind === 'broadcast',
    team: groupDoc.kind === 'team',
    sub: groupDoc.sub,
    accent: '#888',
    prayer: groupDoc.kind === 'prayer' || /prayer/i.test(groupDoc.name || ''),
  };
  const Fellowship = {
    myPubkey: 'mehex', relays: ['wss://relay.example'], relayReady: () => true,
    groupEncState: () => 'clear',
    subscribeGroup: () => () => {}, subscribeReactions: () => () => {},
    subscribeGroupPin: (_g, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_g, cb) => { cb(new Set()); return () => {}; },
    subscribeMessageTags: () => () => {},          // no church-defined tags -> the built-in Prayer request
    displayFor: () => ({ handle: 'sam', color: '#888' }),
    requestProfiles: () => {}, outboxFor: () => [], onOutbox: () => () => {},
    canAddGroupEvent: () => false, react: () => {},
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
    todayISO: () => '2026-09-01',
    Icon: () => null,
    IconBtn: ({ name }) => React.createElement('button', { title: name }),
    Overlay: ({ open, children }) => (open ? children : null),
    UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ children }) => children,
    safeCssColor: (c) => c,
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: () => {},
    church: { npub: 'npub1church', name: 'St Aidan’s', id: 'c1' },
    myLeaderGroups: [],                    // an ORDINARY member: not a leader of anything
    churchEvents: [], safeguard: {}, myPubkey: 'mehex', openDM: () => {},
    joinState: { loaded: true, isPending: false, removed: false, offline: false },
  };
  const render = () => draw(mod.ChatRoom, { group, open: true, onClose: () => {}, ctx, docked: true });
  render();
  return render;
}

// The box a member types into, read out of the tree.
const composer = (tree) => find(tree, n => n.type === 'textarea');

test('POINT OF USE: an ordinary member standing in the new whole-church room has somewhere to type', async () => {
  const w = await toSpaces();
  await w.clickText(/Create \d+ & continue/);
  const whole = w.published.find(g => /whole church/i.test(g.name || ''));
  assert.ok(whole, 'no whole-church room to open');
  const tree = memberRoom(whole)();
  assert.equal(composer(tree).length, 1,
    'a member opened their church\'s whole-church room and found no message box. This is the whole defect: ' +
    'the room reads as broken, and nothing on the screen explains why they cannot speak in it');
  assert.ok(find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Send').length,
    'there is a message box but no Send button in the whole-church room');
});

test('…and the Prayer request tag is reachable there, because the composer is', async () => {
  // 'prayer' is a message FLAG on the composer, not a room kind (MSGTAG_PRAYER / resolveFlag in
  // app/screens-chat.jsx). It lives behind the composer's "+" — so a room with no composer has no tag
  // either, and a church whose only room was a broadcast could not tag a prayer request anywhere.
  const w = await toSpaces();
  await w.clickText(/Create \d+ & continue/);
  const whole = w.published.find(g => /whole church/i.test(g.name || ''));
  const render = memberRoom(whole);
  let tree = render();
  const plus = find(tree, n => n.type === 'button' && n.props.onClick && texts(n).includes('plus'));
  assert.ok(plus.length, 'the composer\'s "+" is gone from the whole-church room — re-anchor this test');
  plus[0].props.onClick();
  tree = render();
  assert.match(texts(tree).join(' | '), /Prayer request/,
    'the Prayer request tag is not offered in the whole-church room');
});

test('CONTRAST: the default broadcast room still refuses a member a composer', async () => {
  // The other half of the same claim. If this passed for BOTH rooms the tests above would be measuring
  // nothing about kind at all.
  const w = await toSpaces();
  await w.clickText(/Create \d+ & continue/);
  const cast = w.published.find(g => g.kind === 'broadcast');
  assert.ok(cast, 'no broadcast room to open');
  const tree = memberRoom(cast)();
  assert.equal(composer(tree).length, 0,
    'a member is offered a message box in a broadcast room. The relay will refuse every send, so every ' +
    'message they write is lost against a screen that invited them to write it');
});

// ── measured red/green, 2026-09-01, this file against app/stew-dashboard.jsx ─────────────────────────────
//
// Each sabotage was applied INSIDE a slice of StewSetupWizard, with its anchor asserted to occur exactly
// once in that slice first (CLAUDE.md "sabotage must be scoped" — a plain string-replace in this file hits a
// near-identical sibling, and a mis-aimed sabotage reports exactly what a blind test reports).
//
//   · the fixed wizard                                                     9 pass / 0 fail
//   · reverted to the pre-change file: `whole` back to kind:'broadcast',
//     the Notices row removed, Notices unticked                            4 pass / 5 fail
//   · the LAZY fix — `whole` flipped to 'group' with nothing replacing
//     it, which silently costs a new church every notification it will
//     ever send                                                            5 pass / 4 fail
//   · the whole-church room given back the blurb "Announcements for
//     everyone", so two rooms describe themselves as the notices           8 pass / 1 fail
//   · a SECOND broadcast row added to the ticked defaults                  8 pass / 1 fail
//   · nothing pre-ticked at all                                            2 pass / 7 fail
//   · saveGroups' `STARTERS.filter(s => picks.has(s.id))` replaced with
//     plain `STARTERS` — publish everything, ticked or not                  7 pass / 2 fail
//   · the starter rows deleted from the screen with `null && STARTERS.map`,
//     which leaves every word of the names and blurbs in the file          5 pass / 4 fail
//        (a source-text assertion would have stayed green over that one — CLAUDE.md rule 3)
//
// No sabotage above went uncaught.
