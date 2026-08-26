// A YOUNG PERSON'S REQUEST FOR HELP IS NOT A MEAL TRAIN, AND THE CONSOLE MUST NOT TREAT IT LIKE ONE.
// Run: node --test scripts/child-care-triage-is-separate.test.mjs
//
// Owner, 2026-08-26: children's care must be "separate to other standard care requests".
//
// The relay refuses to serve a child's request to anyone the church has not cleared, and the child's phone
// seals it to nobody else — so one arriving in this console means it is entitled to it. What was left was the
// console's own honesty. Listed among a dozen lifts and meal trains it reads as one more errand; and the
// control sitting beside it, "Set up help", publishes a NEED — which the whole congregation reads, signs up
// to, and which carries the person's name. That is the route by which a child's private disclosure becomes a
// notice-board item.
//
// This RENDERS the shipped component rather than matching its source text. The distinction matters here: the
// dangerous thing is a button existing, and a regex over the file cannot tell you which branch drew it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody, stripComments } from './test-slice.mjs';

const MEALS = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

const CHILD = 'c'.repeat(64), ADULT = 'a'.repeat(64);

// Render the shipped StewCareRequests with a recording element factory. Every stub below is scaffolding; the
// component's own logic is untouched.
function render({ minors, reqs }) {
  const src = transformSync(fnBody(MEALS, 'function StewCareRequests()', 'StewCareRequests'),
    { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
  const nodes = [];
  const h = (type, props, ...kids) => {
    const node = { type: typeof type === 'function' ? (type.name || 'fn') : type, props: props || {}, kids: kids.flat(Infinity).filter(x => x != null) };
    nodes.push(node);
    return node;
  };
  const scope = {
    h, Frag: 'Frag',
    React: { useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) },
    window: {
      useStewardChurch: () => ({ npub: 'npub1church' }),
      useStewardMembers: () => [{ pubkey: CHILD, name: 'Ellie' }, { pubkey: ADULT, name: 'Margaret' }],
      useStewardSafeguard: () => ({ minors, approved: [] }),
      StewardMeals: { subscribeCareRequests: () => () => {}, declineCareRequest: () => {} },
    },
    mealsLbl: {}, MEALS_TYPE_ICON: {}, mealsTypeLabel: () => 'Someone to talk to',
    Icon: function Icon() { return null; },
    StewApproveSheet: function StewApproveSheet() { return null; },
    StewCareChat: function StewCareChat() { return null; },
    console,
  };
  // the component reads its list from state, which our stub freezes at the initial value — so seed it there
  scope.React.useState = (v) => {
    const init = typeof v === 'function' ? v() : v;
    return [Array.isArray(init) && !init.length ? reqs : init, () => {}];
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', `with (scope) { ${src}; return StewCareRequests; }`)(proxy);
  fn();
  const text = (n) => n.kids.filter(k => typeof k === 'string').join(' ');
  return {
    nodes,
    // every string anywhere in the rendered tree
    all: nodes.flatMap(n => n.kids.filter(k => typeof k === 'string')).join(' | '),
    buttonLabels: nodes.filter(n => n.type === 'button').map(text).join(' | '),
  };
}

const req = (from, id) => ({ id, from, status: 'open', type: 'other', forSelf: true, note: 'I don’t want to go home tonight.' });

test('a child’s request is NOT offered “Set up help” — that would publish it to the congregation', () => {
  const r = render({ minors: [CHILD], reqs: [req(CHILD, 'r1')] });
  assert.ok(!/Set up help/.test(r.buttonLabels),
    'the console offers to turn a child’s private disclosure into a need the whole church reads and signs ' +
    'up to, with their name on it. Buttons drawn: ' + r.buttonLabels);
  assert.match(r.buttonLabels, /Message/, 'a cleared adult cannot reply to the child at all');
});

test('…while an adult’s request still can be — the ordinary path is untouched', () => {
  const r = render({ minors: [CHILD], reqs: [req(ADULT, 'r2')] });
  assert.match(r.buttonLabels, /Set up help/,
    'ordinary care triage broke: a grown-up asking for a lift can no longer have help set up');
});

test('a child’s request is shown under its own confidential heading, not among the meal trains', () => {
  const r = render({ minors: [CHILD], reqs: [req(CHILD, 'r1')] });
  assert.match(r.all, /FROM A YOUNG PERSON/,
    'a young person’s request is listed as one more errand among the lifts and meals');
  assert.match(r.all, /CONFIDENTIAL/);
  assert.ok(!/REQUESTS FOR HELP/.test(r.all),
    'the ordinary heading is drawn as well, so the same request appears in both lists');
});

test('both kinds at once stay in separate lists', () => {
  const r = render({ minors: [CHILD], reqs: [req(CHILD, 'r1'), req(ADULT, 'r2')] });
  assert.match(r.all, /FROM A YOUNG PERSON/);
  assert.match(r.all, /REQUESTS FOR HELP/);
  // one "Set up help" only — the adult's
  assert.equal((r.buttonLabels.match(/Set up help/g) || []).length, 1,
    'the child’s request got a “Set up help” button after all, or the adult’s lost one');
});

test('with no children marked, nothing changes at all', () => {
  const r = render({ minors: [], reqs: [req(ADULT, 'r2')] });
  assert.ok(!/FROM A YOUNG PERSON/.test(r.all), 'a church with no children marked is shown an empty child section');
  assert.match(r.all, /REQUESTS FOR HELP/);
});

// ── and the console must SAY that the cleared list governs this ──────────────────────────────────────────
test('the safeguarding panel explains that the cleared list decides who can help a young person', () => {
  // A steward reading this screen previously had no way to know the list they were editing also decided
  // whether any child in their church could ask for help at all.
  const src = stripComments(DASH);
  assert.match(src, /cleared list is also who can receive a request for help from a young person/i,
    'the panel still describes the cleared list as being about private messages only');
});

test('…and warns when children are marked but nobody is cleared', () => {
  // The state nobody would otherwise see: the church has closed the only route a young person has, without
  // meaning to, and the person who can fix it in ten seconds is looking at this screen.
  const src = stripComments(DASH);
  const at = src.indexOf('No one is cleared to help a young person');
  assert.notEqual(at, -1, 'a church with children and nobody cleared is told nothing');
  const around = src.slice(Math.max(0, at - 400), at);
  assert.match(around, /minorsSet\.size && !approvedSet\.size/,
    'the warning is not conditioned on that state, so it either always shows or never does');
  assert.ok(!/DismissibleNote[^>]*No one is cleared/.test(src),
    'the warning is dismissible — it describes the church’s current state, and dismissing it does not change that');
});


// ── THE OTHER COPY OF THE SAME SCREEN ────────────────────────────────────────────────────────────────────
// The first version of this round fixed the console and left the member app's identical triage list alone —
// `CareRequests` in app/screens-today.jsx, the one a care-team volunteer sees on their phone, with the same
// "Set up help" button attached. An audit found it. One of two copies is not a fix.
//
// And correcting the relay so that clearance GRANTS access (rather than merely permitting it on top of a care
// role) created a second gap in the same screen: a cleared youth worker who is not on the care rota began
// receiving children's requests, and this screen opened only for care admins. Sent, and nobody comes — the
// same failure, one layer up.
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');

function renderMemberTriage({ minors, cleared, careAdmin, reqs }) {
  const src = transformSync(fnBody(TODAY, 'function CareRequests({ ctx })', 'CareRequests'),
    { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
  const nodes = [];
  const h = (type, props, ...kids) => {
    const node = { type: typeof type === 'function' ? (type.name || 'fn') : type, props: props || {}, kids: kids.flat(Infinity).filter(x => x != null) };
    nodes.push(node); return node;
  };
  const scope = {
    h, Frag: 'Frag',
    React: { useState: (v) => { const init = typeof v === 'function' ? v() : v; return [Array.isArray(init) && !init.length ? reqs : init, () => {}]; }, useEffect: () => {}, Fragment: 'Fragment' },
    window: { Fellowship: { subscribeCareRequests: () => () => {}, declineCareRequest: () => {} } },
    Icon: function Icon() { return null; },
    CareRequestCard: function CareRequestCard(p) { nodes.push({ type: 'CareRequestCard', props: p, kids: [] }); return null; },
    ApproveNeedSheet: function ApproveNeedSheet() { return null; },
    CareChatSheet: function CareChatSheet() { return null; },
    careName: () => 'Ellie',
    console,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  const fn = new Function('scope', `with (scope) { ${src}; return CareRequests; }`)(proxy);
  // the component takes { ctx }, not ctx
  fn({ ctx: {
    care: { myPub: 'me', settings: { adminGroupId: 'careteam' } },
    churchRosters: careAdmin ? [{ team: 'careteam', people: [{ pub: 'me' }] }] : [],
    safeguard: { minors, cleared },
    church: { npub: 'npub1x' },
  } });
  return {
    cards: nodes.filter(n => n.type === 'CareRequestCard').map(n => n.props),
    all: nodes.flatMap(n => n.kids.filter(k => typeof k === 'string')).join(' | '),
  };
}

const kidReq = { id: 'k1', from: CHILD, status: 'open', type: 'other', forSelf: true };
const adultReq = { id: 'a1', from: ADULT, status: 'open', type: 'meals', forSelf: true };

test('MEMBER APP: a care admin sees a child’s request under its own heading, with no way to publish it', () => {
  const r = renderMemberTriage({ minors: [CHILD], cleared: false, careAdmin: true, reqs: [kidReq, adultReq] });
  assert.match(r.all, /FROM A YOUNG PERSON/, 'the phone’s own triage still lists a child’s request as an errand');
  const kid = r.cards.find(c => c.r.id === 'k1'), adult = r.cards.find(c => c.r.id === 'a1');
  assert.equal(kid.child, true, 'the card is not told it is a child’s');
  assert.equal(kid.onApprove, null,
    'the phone offers to turn a child’s disclosure into a need the whole congregation reads and signs up to');
  assert.equal(typeof adult.onApprove, 'function', 'the ordinary care path broke on the phone');
});

test('MEMBER APP: a CLEARED adult with no care role can see them at all', () => {
  // Before this, the screen opened only for care admins — so after the relay was corrected, the person the
  // child's phone encrypts to had the message and no screen anywhere that would show it to them.
  const r = renderMemberTriage({ minors: [], cleared: true, careAdmin: false, reqs: [kidReq] });
  assert.equal(r.cards.length, 1, 'a cleared youth worker is shown nothing at all — sent, and nobody comes');
  assert.match(r.all, /FROM A YOUNG PERSON/);
  assert.equal(r.cards[0].onApprove, null, 'and they are offered the publish-to-everyone button');
});

test('MEMBER APP: a cleared adult does not need the children’s list to file them correctly', () => {
  // They are not served that list — and do not need it. The relay hands them a child's request and nothing
  // else, so everything they hold is one. Reading the ABSENCE of the list as "no children here" is exactly
  // what would drop a disclosure into the ordinary queue.
  const r = renderMemberTriage({ minors: [], cleared: true, careAdmin: false, reqs: [kidReq] });
  assert.ok(!/REQUESTS FOR HELP/.test(r.all),
    'with no children’s list, a cleared adult’s request landed in the ordinary queue');
});

test('MEMBER APP: someone who is neither is shown nothing', () => {
  const r = renderMemberTriage({ minors: [], cleared: false, careAdmin: false, reqs: [kidReq, adultReq] });
  assert.equal(r.cards.length, 0, 'an ordinary member is being shown other people’s requests for help');
});


test('MEMBER APP: the CARD itself refuses to draw the button, not just the caller', () => {
  // BELT AND BRACES, AND BOTH MUST BE TESTED. The list passes `onApprove: null` for a child AND the card
  // checks `child` itself, so an edit that forgets one still cannot publish a young person's words. The first
  // version of this file only ever asserted on the prop — I broke the card's own guard and every test stayed
  // green, which is the same shape of miss the audit had just found elsewhere. So render the real card.
  const src = transformSync(fnBody(TODAY, 'function CareRequestCard(', 'CareRequestCard'),
    { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
  const draw = (child) => {
    const nodes = [];
    const h = (type, props, ...kids) => { const n = { type: typeof type === 'function' ? (type.name || 'fn') : type, props: props || {}, kids: kids.flat(Infinity).filter(x => x != null) }; nodes.push(n); return n; };
    const scope = {
      h, Frag: 'Frag',
      React: { useState: (v) => [typeof v === 'function' ? v() : v, () => {}] },
      Icon: function Icon() { return null; },
      careName: () => 'Ellie', CARE_TYPE_LABEL: { other: 'Something else' }, CARE_TYPE_ICON: { other: 'heart' }, careTypeLabel: () => 'Something else',
      console,
    };
    const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
        throw new ReferenceError('needs a stub for ' + String(k)); } });
    const fn = new Function('scope', `with (scope) { ${src}; return CareRequestCard; }`)(proxy);
    fn({ r: { id: 'x', from: CHILD, forSelf: true, type: 'other', sealed: false }, ctx: {}, child,
         onApprove: () => {}, onDecline: () => {}, canMessage: true, onMessage: () => {} });
    return nodes.filter(n => n.type === 'button').map(n => n.kids.filter(k => typeof k === 'string').join(' ')).join(' | ');
  };
  assert.ok(!/Set up help/.test(draw(true)),
    'the card draws "Set up help" on a child’s request whenever a caller forgets to withhold it. Buttons: ' + draw(true));
  assert.match(draw(false), /Set up help/, 'the ordinary card lost its button');
});
