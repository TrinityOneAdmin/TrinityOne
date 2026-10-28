// THE DECLINE-CONFIRM MUST NOT SQUASH "APPROVE" TO "ove" ON A PHONE.
//   Run: flock /tmp/claude-1000/selfhost-tests.lock node --test scripts/the-join-decline-confirm-does-not-clip-approve.test.mjs
//
// Device round backlog ("Approval card UI"): at ~720px the join-request card is the narrow (column) shape, and its
// actions row (`data-join-actions`) is right-justified with NO flexShrink and the default flexWrap:'nowrap'. When a
// steward taps Decline, `confirmBlock === m.pubkey` replaces the single ✕ with TWO buttons (Block + Cancel), so the
// row goes from 3 non-shrinking controls to 4, cannot wrap, and the overflow clips the LEFT edge — the Approve button,
// whose label reads "ove". The fix lets that row wrap on narrow so Approve stays on the first line, fully visible.
//
// Rule 1 (point of USE): the REAL DashMembers is rendered through the kit, the REAL Decline onClick is pressed to open
// the confirm, and the tree is inspected. Rule 3: nothing here matches text in app/*.jsx.
// Rule 2 (users of the changed code): only the `data-join-actions` style object inside joinRow (DashMembers) is edited;
// `data-join-actions` occurs once in the file. admitMember, block, confirmBlock and pendingJoins are untouched.
//
// HONEST LIMITATION: the mini-React has no layout engine, so this asserts the CSS property that CAUSES wrapping
// (flexWrap:'wrap' on the narrow actions row), not pixel visibility. The on-screen "ove" clip is confirmed on the
// attached phone at ~720px (CLAUDE.md rule 6); this test guards the regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, membersGlobals, find, texts } from './dash-render-kit.mjs';

const PK = 'd'.repeat(64);
const members = [{ pubkey: PK, npub: 'npub1dd', name: 'Nia Okafor', count: 0, lastTs: 0, joined: 1 }];

// approval ON + this person NOT admitted = sitting in the join queue (same fixture as the other join-card tests).
async function joinCard() {
  const steward = {
    setBlocked: () => Promise.resolve(true), setAdmitted: () => Promise.resolve(true), setMinors: () => Promise.resolve(true),
    setApproved: () => Promise.resolve(true), setGuardians: () => Promise.resolve(true), setNoPhoto: () => Promise.resolve(true),
  };
  const g = { ...membersGlobals({ steward, members, admitted: [], extraWindow: { useStewardJoinPolicy: () => true } }), useStewNarrow: () => true };
  const { C, draw } = await compiled('DashMembers', g, ['rotateChurchKeys']);
  let tree = draw(C, {});
  const redraw = () => { tree = draw(C, {}); return tree; };
  const btn = (re) => find(tree, n => n && n.type === 'button' && re.test(String((n.props && n.props['aria-label']) || '') + ' ' + texts(n).join(' ')));
  const actions = () => find(tree, n => n && n.props && n.props['data-join-actions'] !== undefined);
  return { get tree() { return tree; }, redraw, btn, actions };
}

test('CONTROL: at narrow, a waiting person renders with Approve and Decline on the actions row (confirm closed)', async () => {
  const q = await joinCard();
  assert.equal(q.actions().length >= 1, true, 'the join actions row (data-join-actions) did not render — re-anchor this test');
  assert.ok(q.btn(/Approve/i).length >= 1, 'no Approve button on the waiting row');
  assert.equal(q.btn(/Decline/i).length, 1, `expected exactly one Decline control, found ${q.btn(/Decline/i).length}`);
  // resting state: the row has not yet been asked to wrap and must not be clipped either
  assert.notEqual(q.actions()[0].props.style.flexWrap, 'nowrap', 'the narrow actions row must not be forced to nowrap');
});

test('when the decline-confirm is open, the actions row may WRAP so Approve is not clipped', async () => {
  const q = await joinCard();
  // press the REAL Decline onClick -> confirmBlock === this pubkey
  q.btn(/Decline/i)[0].props.onClick();
  q.redraw();
  // both the thing that must stay visible AND the thing that pushed it off are present on the row:
  assert.ok(q.btn(/Approve/i).length >= 1, 'Approve is gone from the row');
  assert.ok(q.btn(/Confirm: block/i).length >= 1, 'the Block confirm did not open, so the crowded 4-control row is not under test');
  // the only-with-fix structural property: the narrow actions row wraps instead of clipping its left edge.
  const row = q.actions()[0];
  assert.equal(row.props.style.flexWrap, 'wrap',
    'the narrow actions row is nowrap: with no flexShrink on its 4 controls it overflows right-justified and clips ' +
    'Approve to "ove". It must flex-wrap on a phone.');
});
