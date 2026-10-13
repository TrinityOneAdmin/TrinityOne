// THE "REQUESTS TO JOIN" CARD SHOWS A WHOLE NAME, ON A ROW OF ITS OWN.
//   Run: node --test scripts/the-join-request-card-shows-the-whole-name.test.mjs
//
// Owner complaint (backlog "Approval card UI needs work"): names truncated, layout cramped. The person's name shared one
// line with the badge, Approve and the decline button, so at 360px it got ~100px and a long name broke mid-word; the
// delegated-steward request card cut names with an ellipsis outright.
//
// Rule 1 (point of USE): the real DashMembers and the real DashStewardsPanel are rendered, and the tree is inspected.
// Rule 3: nothing here matches text in app/*.jsx. Tree-rendered only: NO browser or device check is claimed.
//
// Users of the shared code (rule 2): this edits only the two cards' own markup inside DashMembers (join queue) and
// DashStewardsPanel (steward requests). No helper is shared; pendingJoins, admitMember, block and confirmBlock are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, membersGlobals, find, said } from './dash-render-kit.mjs';

const LONG = 'Bartholomew Featherstonehaugh-Cholmondeley';
const PK = 'd'.repeat(64);
const members = [{ pubkey: PK, npub: 'npub1dd', name: LONG, count: 0, lastTs: 0, joined: 1 }];

async function joinCard() {
  const g = membersGlobals({ steward: {}, members, admitted: [], extraWindow: { useStewardJoinPolicy: () => true } });
  const { C, draw } = await compiled('DashMembers', g, ['rotateChurchKeys']);
  return draw(C, {});
}
const nameNode = (tree, name) => find(tree, n => n && n.props && n.props.style && n.kids && n.kids.length === 1 && n.kids[0] === name)[0];
// the path of nodes from the root down to the first node matching pred, walking RENDERED kids only (find() also follows
// props, which hold the unexpanded copies a component was handed)
const pathTo = (tree, pred) => {
  const path = [];
  const walk = (n) => {
    if (pred(n)) return true;
    for (const k of Array.isArray(n) ? n : (n && n.kids) || []) { if (k && typeof k === 'object') { path.push(n); if (walk(k)) return true; path.pop(); } }
    return false;
  };
  return walk(tree) ? path : null;
};
const hasButton = (n) => find(n, x => x && x.type === 'button').length > 0;

test('a long join-request name is rendered in full, not clipped', async () => {
  const tree = await joinCard();
  const n = nameNode(tree, LONG);
  assert.ok(n, 'the join queue does not show the name — re-anchor: ' + said(tree).slice(0, 300));
  const st = n.props.style;
  assert.notEqual(st.whiteSpace, 'nowrap', 'name cannot wrap');
  assert.notEqual(st.textOverflow, 'ellipsis', 'name is cut with an ellipsis');
  assert.notEqual(st.overflow, 'hidden', 'name is clipped');
  assert.ok(/anywhere|break-word/.test(String(st.overflowWrap) + String(st.wordBreak)), 'an unbreakable long word would overflow the card');
});

test('the name has a row to itself: no button shares its line', async () => {
  const tree = await joinCard();
  const path = pathTo(tree, x => x && x.kids && x.kids.length === 1 && x.kids[0] === LONG);
  assert.ok(path, 'name not found');
  const row = [...path].reverse().find(a => a.props && a.props.style && a.props.style.display === 'flex' && (a.props.style.flexDirection || 'row') === 'row');
  assert.ok(row, 'name is in no flex row');
  assert.equal(hasButton(row), false, 'Approve / decline still share the name\'s line, which squeezes it at 360px');
});

test('Approve and decline are both still on the card', async () => {
  const tree = await joinCard();
  const btns = find(tree, x => x && x.type === 'button' && x.props && typeof x.props.onClick === 'function');
  assert.ok(btns.some(b => /Approve/.test(said(b))), 'Approve');
  assert.ok(btns.some(b => /^Decline/.test(String(b.props['aria-label'] || ''))), 'Decline');
});

test('the steward-request card does not clip a long name', async () => {
  const STEW = 'e'.repeat(64);
  const base = membersGlobals({ steward: { stewardName: (pk) => pk === STEW ? LONG : '' }, members });
  const req = [{ pubkey: STEW, npub: 'npub1ee', name: LONG }];
  const win = { ...base.window, useStewardStewards: () => [], usePendingStewards: () => req };
  const proxy = new Proxy(win, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('useSteward')) return () => []; return undefined; }, has: () => true });
  const { C, draw } = await compiled('DashStewardsPanel', { ...base, window: proxy }, []);
  const tree = draw(C, { church: { name: 'St Aidan' } });
  const n = nameNode(tree, LONG);
  assert.ok(n, 'steward request name not rendered — re-anchor: ' + said(tree).slice(0, 300));
  assert.notEqual(n.props.style.whiteSpace, 'nowrap');
  assert.notEqual(n.props.style.textOverflow, 'ellipsis');
});
