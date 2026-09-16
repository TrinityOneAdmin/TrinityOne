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
import { loadScreen } from './render-jsx-screen.mjs';
import { renderMembersPage } from './render-members-page.mjs';

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

// The fixture moved to ./render-members-page.mjs so child-care-triage-is-separate.test.mjs can assert
// against the SAME rendered note without importing this file and re-running its tests.

const WORD_BUDGET = 42;   // the note as shipped before this: 99, then 47. As it stands now: 37 (measured by
                          // running this file with the budget set to 0 and reading the number back, not
                          // estimated — an audit once found this comment saying 45 after a rewording added two).
                          // 37 counts the help-link label too, because that is what a reader reads.
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
  // ⚠ ADDED 2026-09-16, after a merge-gate review got past the two above. It replaced "Clear only adults
  // already on your church's cleared-worker list" with "Clear adults you trust" — the exact reading
  // reference/DOMAIN.md warns about — and BOTH tests in this file stayed green, because the first regex is
  // satisfied by the words that survive ("your CLEARED list is who may MESSAGE A CHILD privately").
  //
  // This is the sentence that has to be guarded hardest, and it was the only one with no guard at all.
  // DOMAIN.md: the merged clearance "is safe ONLY because it now describes a real vetting check rather than
  // an app convenience", and "⚠ SO THE CLEARING ACT ITSELF IS THE SAFEGUARD". A 37-word draft was refuted on
  // 2026-09-16 for softening this to "adults your church has already checked", which a steward can satisfy
  // with "well, we've known him fifteen years". Naming the LIST is the whole point: it either has their name
  // on it or it does not.
  //
  // So this pins the artefact, not the phrasing — any wording is fine as long as it sends the steward to the
  // cleared-worker list. If that list is ever renamed in the product, change this regex deliberately and say
  // so in the commit; do not loosen it to make a reword pass.
  'that you may only clear someone already on the church\'s cleared-worker list (DOMAIN.md: the clearing act itself is the safeguard)':
    /clear\w*[^.]{0,80}\bcleared-worker list\b/i,
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
