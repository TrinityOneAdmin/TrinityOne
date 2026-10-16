// A CHILD'S CARE REQUEST MUST NOT BECOME A NOTICE-BOARD NEED FOR A DELEGATE WHO CANNOT VERIFY CHILDREN.
// Run: node --test scripts/care-triage-delegate-fails-closed.test.mjs
//
// The care triage (StewCareRequests, app/stew-meals.jsx) splits requests into a CONFIDENTIAL "from a young
// person" section (no "Set up help") and an ordinary "requests for help" section (which DOES offer "Set up
// help" — a control that publishes a congregation-wide NEED with the requester's name on it). The split used
// to key on `minorsKnown`, which turns TRUE for a scoped care-only delegate on EOSE-while-authenticated with
// an EMPTY minors set (the relay withholds minors: from a steward without Safeguarding). An empty set answers
// "not a child" for a real child, so the child's private disclosure was filed with the adults, under "Set up
// help". This is the SAME root as StewReadyToHelp (#7); the fix reuses the SAME helper, readyToHelpCanSeeChildren.
//
// CLAUDE.md rule 1 (test at the point of USE) and rule 3 (never text-match app/*.jsx): the REAL StewCareRequests
// is compiled from app/stew-meals.jsx and RUN here. Deleting the gate from the component turns (A1) red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';

const MEALS_JSX = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');
const CHILD = 'a'.repeat(64), ADULT = 'b'.repeat(64), CP = 'c'.repeat(64);

function permissive(scope) {
  return new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('needs a stub for ' + String(k)); },
  });
}
function compile(src, name) {
  return transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code + `\nreturn ${name};`;
}
function recorder() {
  const nodes = [];
  const h = (type, props, ...kids) => { const n = { type: typeof type === 'function' ? (type.name || 'fn') : type, props: props || {}, kids: kids.flat(Infinity).filter(x => x != null && x !== false) }; nodes.push(n); return n; };
  return { nodes, h };
}
// Only what the component RETURNED (walk the tree), not every element the recorder ever saw built.
const reach = (root) => { const out = []; const go = (n) => { if (n == null || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(go); out.push(n); (n.kids || []).forEach(go); }; go(root); return out; };
const btnText = (b) => reach(b).map(n => (n.kids || []).filter(k => typeof k === 'string').join('')).join(' ');
const allText = (nodes) => nodes.flatMap(n => n.kids.filter(k => typeof k === 'string' || typeof k === 'number').map(String)).join(' | ');

const req = (from, extra = {}) => ({ id: 'r_' + from.slice(0, 4), from, status: 'open', type: 'meals', note: 'please help', sealed: false, ...extra });

function renderTriage({ reqs, minors = [], minorsKnown = true, minorsDocSeen = undefined, acting = false, caps = null }) {
  const { h } = recorder();
  let stateN = 0;
  const scope = {
    h, Frag: 'Frag',
    React: {
      // hooks run in a fixed order: 1=reqs, then approving/closing/closeErr/halfDone/chatting. Inject reqs at #1.
      useState: (init) => { stateN += 1; return stateN === 1 ? [reqs, () => {}] : [init, () => {}]; },
      useEffect: () => {},   // reqs are injected directly (same shape the subscribe callback yields)
      Fragment: 'Frag',
    },
    mealsTypeLabel: () => 'Meals', mealsLbl: {}, MEALS_TYPE_ICON: {},
    Icon: function Icon() { return null; },
    StewApproveSheet: function StewApproveSheet() { return null; },
    StewCareChat: function StewCareChat() { return null; },
    StewReadyToHelp: function StewReadyToHelp() { return null; },
    window: {
      useStewardChurch: () => ({ npub: 'npub1church' }),
      useStewardMembers: () => [{ pubkey: CHILD, name: 'Ellie' }, { pubkey: ADULT, name: 'Margaret' }],
      useStewardConn: () => 0,
      useStewardSafeguard: () => ({ minors, approved: [], minorsKnown, ...(minorsDocSeen === undefined ? {} : { minorsDocSeen }) }),
      StewardMeals: { subscribeCareRequests: () => () => {}, setCareRequestStatus: async () => true, declineCareRequest: async () => true },
      Steward: { actingChurch: acting ? CP : null, myStewardCaps: () => (acting ? caps : null) },
    },
  };
  const src = fnBody(MEALS_JSX, 'function readyToHelpCanSeeChildren(', 'readyToHelpCanSeeChildren') + '\n'
            + fnBody(MEALS_JSX, 'function StewCareRequests()', 'StewCareRequests');
  const Comp = new Function('scope', `with (scope) { ${compile(src, 'StewCareRequests')} }`)(permissive(scope));
  const tree = Comp();
  const seen = reach(tree);
  const buttons = seen.filter(n => n.type === 'button');
  const setupHelp = buttons.filter(b => /Set up help/.test(btnText(b)));
  return { tree, nodes: seen, all: allText(seen), buttons, setupHelp };
}

const HELD = /CHECKING WHO THESE ARE FROM|HELD CONFIDENTIAL/;
const FROM_YP = /FROM A YOUNG PERSON/;
const ADULT_HDR = /REQUESTS FOR HELP/;

// ── THE BUG THIS FIX CLOSES ──────────────────────────────────────────────────────────────────────────────────
test('(A1) care-only delegate, minors doc never seen: a child\'s request is NOT offered "Set up help", nor is any request; held confidential', () => {
  const r = renderTriage({ reqs: [req(CHILD), req(ADULT)], minors: [], minorsKnown: true, minorsDocSeen: false, acting: true, caps: ['care'] });
  assert.equal(r.setupHelp.length, 0, 'a "Set up help" button was offered for a console that cannot say who the children are — a child\'s disclosure could go up as a congregation-wide NEED');
  assert.match(r.all, HELD, 'the confidential section does not carry the held-confidential wording');
  assert.ok(!FROM_YP.test(r.all), 'the header claimed "FROM A YOUNG PERSON" when this console cannot actually confirm that');
  assert.ok(!ADULT_HDR.test(r.all), 'an ordinary "requests for help" section was drawn — requests leaked out of confidential');
});
test('(A1b) RACE: an ABSENT minorsDocSeen key (first paint) fails closed exactly the same', () => {
  const r = renderTriage({ reqs: [req(CHILD), req(ADULT)], minors: [], minorsKnown: true, acting: true, caps: ['care'] });  // no minorsDocSeen key
  assert.equal(r.setupHelp.length, 0);
  assert.ok(!ADULT_HDR.test(r.all));
});

// ── WHO MAY BE TRUSTED TO CLASSIFY (the minors set is believed) ──────────────────────────────────────────────
test('(A2) safeguarding delegate, OR a care delegate who RECEIVED the minors doc: adult gets "Set up help", child does not', () => {
  for (const x of [{ caps: ['care', 'safeguarding'], minorsDocSeen: false }, { caps: ['care'], minorsDocSeen: true }]) {
    const r = renderTriage({ reqs: [req(CHILD), req(ADULT)], minors: [CHILD], minorsKnown: true, acting: true, ...x });
    assert.equal(r.setupHelp.length, 1, 'the adult request should offer Set up help for ' + JSON.stringify(x));
    assert.match(r.all, FROM_YP);
    assert.match(r.all, ADULT_HDR);
  }
});
test('(A3) owner console (unscoped): the minors set is trusted', () => {
  const r = renderTriage({ reqs: [req(CHILD), req(ADULT)], minors: [CHILD], minorsKnown: true, acting: false });
  assert.equal(r.setupHelp.length, 1);
  assert.match(r.all, FROM_YP); assert.match(r.all, ADULT_HDR);
});
test('(A4) unscoped steward (caps null) is trusted', () => {
  const r = renderTriage({ reqs: [req(CHILD), req(ADULT)], minors: [CHILD], minorsKnown: true, acting: true, caps: null });
  assert.equal(r.setupHelp.length, 1);
  assert.match(r.all, ADULT_HDR);
});

// ── STILL-LOADING FAIL-CLOSED (unchanged by this fix) ────────────────────────────────────────────────────────
test('(A5) minorsKnown false: everything held confidential, no "Set up help" — for every kind of console', () => {
  for (const x of [{ acting: false }, { acting: true, caps: null }, { acting: true, caps: ['care', 'safeguarding'] }]) {
    const r = renderTriage({ reqs: [req(CHILD), req(ADULT)], minors: [], minorsKnown: false, ...x });
    assert.equal(r.setupHelp.length, 0, JSON.stringify(x));
    assert.ok(!ADULT_HDR.test(r.all), JSON.stringify(x));
    assert.match(r.all, HELD);
  }
});
