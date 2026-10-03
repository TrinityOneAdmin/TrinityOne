// THE MEMBERS PAGE SAYS "Groups & rotas", NOT "content". Sim round 2026-10-02, finding #55.
// Run: node --test scripts/the-members-page-names-what-a-steward-may-do.test.mjs
//
// "People who help run this church" lists each delegated steward and what they may do. It printed the stored
// capability keys raw - "content, sealedrooms" - while the Delegated stewards panel, a few clicks away, says
// "Groups & rotas, Sealed rooms". An owner reading the first could not tell what "content" granted.
//
// Users of the changed line (rule 2): it is one expression inside DashMembers' steward list; nothing else reads
// its result. STEW_CAP_LABEL (the table it now uses) is already read by DelegateBrief, the capability gate and
// the access page, so the Members page now agrees with all of them.
//
// HOW IT ASSERTS (rule 3): the real DashMembers is compiled and rendered (same fixture shape as
// render-members-page.mjs) with a steward who holds three capabilities; the words on the drawn page are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

function membersPageWith(caps) {
  const { React, draw } = miniReact();
  const STEW = 'sss';
  const win = {
    useStewardMembers: () => [{ pubkey: 'aaa', pk: 'aaa', npub: 'npub1aaa', name: 'Ann Brown' }],
    useStewardGroups: () => [], useStewardNetworks: () => [], useStewardCategories: () => [],
    useStewardRosters: () => ({}), useStewardChurch: () => ({ name: 'St X', features: {} }),
    useStewardMinors: () => new Set(), useStewardApproved: () => new Set(), useStewardGuardians: () => ({ links: {}, closed: {} }),
    useStewardStewards: () => [STEW],
    usePendingJoins: () => [], usePendingGuardians: () => [],
    Steward: { pubkey: 'zzz', stewardCaps: () => (caps === undefined ? {} : { [STEW]: caps }), stewardLabels: () => ({ [STEW]: 'Tom' }) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  const base = { React, Icon: () => null, window: win, localStorage: win.localStorage };
  const { DismissibleNote } = loadScreen('app/stew-modal.jsx', ['DismissibleNote'], base);
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashMembers'], {
    ...base, SkToggle: () => null, SkBadge: () => null, SkConfirm: () => null,
    SkPill: ({ children }) => React.createElement('span', null, children),
    DismissibleNote, StewHelpLink: () => null, useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-03',
  });
  return texts(draw(mod.DashMembers, {})).join(' | ');
}

test('a steward’s capabilities read as the words the console uses elsewhere', () => {
  const screen = membersPageWith(['finance', 'content', 'sealedrooms']);
  assert.match(screen, /Tom/, 'the steward list did not render - re-anchor this test');
  assert.match(screen, /Finance, Groups & rotas, Sealed rooms/);
  assert.doesNotMatch(screen, /\bcontent\b|\bsealedrooms\b/, 'a stored capability key is on the Members page raw');
});

test('the two other states still read as before', () => {
  assert.match(membersPageWith(undefined), /everything/);
  assert.match(membersPageWith([]), /nothing yet/);
});
