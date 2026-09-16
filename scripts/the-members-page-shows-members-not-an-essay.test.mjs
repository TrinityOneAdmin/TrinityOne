// THE FIRST THING ON THE MEMBERS PAGE MUST BE A MEMBER.
//   Run: node --test scripts/the-members-page-shows-members-not-an-essay.test.mjs
//
// The owner, 2026-09-10: *"we need to cut down on the instructional copy in the ui itself. Use tool tips and
// help docs for this kind of information imo."* The screenshot audit of the steward APK on 2026-09-15
// (TrinityOne-internal/UI-AUDIT-console-2026-09-15.md, finding 4) found the Members page still opening with a
// ~90-word safeguarding essay wedged between the "N ACTIVE" badge and the first member — on a 360px phone,
// you could not see a single member without scrolling past it.
//
// ── THE TRAP THIS FILE IS BUILT AROUND ───────────────────────────────────────────────────────────────────
// "Shorten the copy" has a cheap wrong answer: delete the facts. Some of these are safeguarding facts, and
// one of them (your cleared list is who a young person's plea for help reaches) is the thing the help article
// itself calls the consequence most churches do not expect. So this file asserts BOTH halves and neither is
// optional: the note on screen is short AND every fact that left it is in the guide the note now links to.
// Take either half away and the other passes happily over a defect.
//
// CLAUDE.md rule 3: nothing here matches text in app/*.jsx. The note is RENDERED — DashMembers compiled with
// the same esbuild the packaged build uses, drawn through the miniature React in render-jsx-screen.mjs, with
// the REAL DismissibleNote from app/stew-modal.jsx rather than a stub, so a note that stopped rendering at
// all would fail rather than pass. The help side is read from the real window.HelpData the console loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

// The real HelpData, evaluated the way steward.html evaluates it: a classic script assigning to window.
function helpData() {
  const w = {};
  new Function('window', readFileSync(ROOT + 'app/help-data.jsx', 'utf8'))(w);
  assert.ok(w.HelpData && Array.isArray(w.HelpData.articles), 'app/help-data.jsx no longer defines window.HelpData');
  return w.HelpData;
}

// Every string the article holds, flattened — blocks carry text under several different keys.
function articleText(id) {
  const a = helpData().articles.find(x => x && x.id === id);
  assert.ok(a, 'no help article "' + id + '" — re-anchor this test');
  const out = [a.title, a.summary];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(a.blocks);
  return out.join(' · ');
}

// Render DashMembers with a church that HAS members — the note only renders once somebody has joined.
function renderMembersPage() {
  const { React, draw } = miniReact();
  const win = {
    useStewardMembers: () => [
      { pubkey: 'aaa', pk: 'aaa', npub: 'npub1aaa', name: 'Ann Brown' },
      { pubkey: 'bbb', pk: 'bbb', npub: 'npub1bbb', name: 'Ben Cole' },
      { pubkey: 'ccc', pk: 'ccc', npub: 'npub1ccc', name: 'Cara Dee' },
    ],
    useStewardGroups: () => [], useStewardNetworks: () => [], useStewardCategories: () => [],
    useStewardRosters: () => ({}), useStewardChurch: () => ({ name: 'St X', features: {} }),
    useStewardMinors: () => new Set(), useStewardApproved: () => new Set(), useStewardGuardians: () => ({}),
    usePendingJoins: () => [], usePendingGuardians: () => [],
    Steward: { pubkey: 'zzz' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  const base = { React, Icon: () => null, window: win, localStorage: win.localStorage };

  // THE REAL BANNER COMPONENT, not a stub. It is what decides whether the note appears at all (it hides
  // itself once dismissed), so stubbing it would let "the note never renders" pass this file.
  const { DismissibleNote } = loadScreen('app/stew-modal.jsx', ['DismissibleNote'], base);
  // …wrapped only so the note can be FOUND in the tree. The wrapper adds a marker attribute and changes
  // nothing else: the real component still decides what it renders.
  const Tagged = (props) => React.createElement('div', { 'data-note-id': props.id }, DismissibleNote(props));

  // The help link is the one thing this fixture stands in for, because the real one pulls in the whole help
  // dialog. It records the article id it was ASKED for, which is the only thing asserted about it.
  const linked = [];
  const StewHelpLink = ({ id, label }) => { linked.push(id); return React.createElement('span', null, label); };

  const mod = loadScreen('app/stew-dashboard.jsx', ['DashMembers'], {
    ...base,
    SkToggle: () => null, SkBadge: () => null, SkConfirm: () => null,
    SkPill: ({ children }) => React.createElement('span', null, children),
    DismissibleNote: Tagged, StewHelpLink,
    useStewDialog: () => ({ current: null }), todayISO: () => '2026-09-15',
  });
  const tree = draw(mod.DashMembers, {});
  const node = find(tree, n => n.props && n.props['data-note-id'] === 'safeguarding-intro')[0];
  return { node, text: node ? reads(node) : '', linked };
}

const WORD_BUDGET = 55;   // the note as shipped before this: 99. As it stands now: 47 (measured, not
                          // estimated — an audit found this comment saying 45 after a rewording added two).
// AND A FLOOR, WHICH MATTERS MORE THAN THE CEILING. An independent audit cut the note down to
// "<b>Safeguarding.</b> <StewHelpLink/>" - every safeguarding fact gone, including the one the commit said
// was deliberately KEPT - and both tests in this file stayed green, because a word budget is an upper bound
// and nothing asserted what had to remain. The next "shorten the copy" pass would have deleted it over a
// green suite. These two must be on the screen, and reference/DOMAIN.md says why:
//   · what clearing an adult GRANTS. "Whatever screen grants it must say, in words, what it grants - a
//     warden ticking 'cleared for check-in' must not discover later that they also opened children's chat."
//     This IS the screen that grants it, and the grant is one tap with no confirmation step.
//   · that the cleared list is who a young person's request for help reaches - the consequence the guide
//     itself calls the one most churches do not expect, and the only one invisible until a child needs it.
const MUST_REMAIN = {
  'what clearing an adult grants (DOMAIN.md: the granting screen must say what it grants)':
    /clear\w*[^.]{0,90}\bmessage a child\b/i,
  'that the cleared list is who a plea for help reaches':
    /cleared list[^.]{0,90}receive[^.]{0,70}request for help/i,
};

test('the Members safeguarding note is a sentence, not an essay', () => {
  const { node, text, linked } = renderMembersPage();
  assert.ok(node, 'the safeguarding note does not render on a Members page that has members at all');

  const words = text.split(/\s+/).filter(Boolean).length;
  assert.ok(words <= WORD_BUDGET,
    'the Members page opens with a ' + words + '-word explainer sitting between the member count and the first ' +
    'member, so on a 360px phone a steward scrolls past it to see anybody. Budget is ' + WORD_BUDGET + ' words; ' +
    'the rest belongs in the console-family-safety guide. On screen now:\n  ' + text);

  const gone = Object.entries(MUST_REMAIN).filter(([, re]) => !re.test(text)).map(([k]) => k);
  assert.deepEqual(gone, [],
    'the note is short enough and has stopped saying what it must say on the screen where the action ' +
    'happens: ' + gone.join('; ') + '. On screen now:\n  ' + text);

  // …and it must hand the reader somewhere to go, or "shorter" is just "less is said".
  assert.ok(linked.includes('console-family-safety'),
    'the note no longer links to the console-family-safety guide, so the ~55 words taken out of it are not ' +
    'reachable from this page at all. Links offered: ' + JSON.stringify(linked));
});

test('every fact taken off the Members page is in the guide the note links to', () => {
  // Written from the note as it shipped on 2026-09-15 (see the commit). Each entry is a fact that WAS on the
  // screen; the value is wording from the guide that carries it. If a future edit shortens the guide instead
  // of the screen, this is what notices.
  const MOVED = {
    'how to mark a young person': 'Members → find them in the list → “Child”',
    'a child sees only child-safe groups': 'Their app shows just the groups you have marked safe',
    'child↔adult DMs are blocked, with two exemptions': 'refused unless that adult is cleared for youth, or is the child’s linked parent',
    'clear only your own cleared-worker list': 'Clear only adults who are already on your church’s cleared-worker list',
    'the cleared list receives a young person’s plea': 'Your cleared list is also who can receive a request for help from a young person',
    'the care rota is not enough': 'Being on the care rota is not enough',
    'nobody cleared means no route at all': 'If nobody in your church is cleared, no child in your church can ask for help through the app',
    'this does not replace policy': 'it doesn’t replace background checks, training, supervision or policy',
  };
  const guide = articleText('console-family-safety');
  const missing = Object.entries(MOVED).filter(([, phrase]) => !guide.includes(phrase)).map(([k]) => k);
  assert.deepEqual(missing, [],
    'these were taken off the Members page on the promise that the guide carries them, and it no longer does: ' +
    missing.join('; ') + '. Either put the fact back on screen or put it back in console-family-safety.');

  // And the guide has to be one the console can actually open, or the link is a dead end.
  //
  // ⚠ THIS RUNS THE CONSOLE'S OWN LOOKUP; it does not read STEW_HELP_IDS as text. The first version regexed
  // that literal array out of app/stew-help.jsx - a behaviour claim made by matching source text in a file
  // that ships UNBUNDLED, which is precisely what CLAUDE.md rule 3 forbids: a runtime filter over the array
  // would leave every character of it in place and the assertion would still pass. An audit caught it.
  const { stewHelpArticles } = loadScreen('app/stew-help.jsx', ['stewHelpArticles'], {
    React: { createElement: () => null, Fragment: 'Fragment', useState: () => [null, () => {}],
             useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f },
    Icon: () => null, window: { HelpData: helpData() },
  });
  const offered = stewHelpArticles().map(a => a.id);
  assert.ok(offered.includes('console-family-safety'),
    'the console does not offer console-family-safety among its help articles, so the link on the Members ' +
    'page opens a dialog that skips it. Offered: ' + JSON.stringify(offered));
});
