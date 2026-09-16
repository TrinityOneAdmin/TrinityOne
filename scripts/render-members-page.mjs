// RENDER THE CONSOLE'S MEMBERS PAGE, AND HAND BACK THE SAFEGUARDING NOTE THAT SITS ON IT.
//
// This lives in its own file, and NOT in a *.test.mjs, for one reason: importing a test file runs its
// tests. Two files need this fixture — the-members-page-shows-members-not-an-essay.test.mjs (is the note
// short enough, and does it still say what it must?) and child-care-triage-is-separate.test.mjs (does the
// console still tell a steward that the cleared list governs who a young person can reach?). Sharing it
// through a plain module lets both assert against the SAME rendered screen without either one's tests
// being counted twice.
//
// CLAUDE.md rule 3 is why this exists at all. app/stew-dashboard.jsx ships UNBUNDLED, so `false && ` in
// front of a condition leaves every word of the note in the file and any regex over the source still
// passes. The note here is COMPILED with the same esbuild the packaged build uses and RENDERED through the
// miniature React in render-jsx-screen.mjs, with the REAL DismissibleNote from app/stew-modal.jsx rather
// than a stub — so a note that stopped rendering at all fails instead of passing.
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

// Render DashMembers with a church that HAS members — the note only renders once somebody has joined.
export function renderMembersPage() {
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
