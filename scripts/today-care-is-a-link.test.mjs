// CARE IS ON THE CARE PAGE, NOT TODAY (owner 2026-10-16).
// Run: node --test scripts/today-care-is-a-link.test.mjs
//
// af7824b put a "Practical care" card on the Today screen because three members hunted for care inside
// "Serving & events" and never found it. The owner reversed that on 2026-10-16: the section was "too much" on
// Today. Care now renders ONLY on the Care page (CareCard embedded, in the Serving overlay's "Care" tab) and
// Today keeps a LINK — the "Care" entry on the "What's happening" card — which lights up with a count of open
// days via careForMe(). This file holds that boundary: nothing care renders on Today, the Care page still
// opens the form and the conversation, and the badge counts only what THIS member may actually claim.
//
// POINT OF USE (rules 1 and 3): every assertion renders a shipped component or runs a lifted function; none
// matches source text. A pre-push audit once defeated a string-matching test on this file by moving wording
// into an unused variable, and every assertion still passed — so the render tests below exist deliberately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJsx, flatten, names } from './jsx-render.mjs';
import { loadScreen, miniReact, texts, button } from './render-jsx-screen.mjs';

const win = { Fellowship: { cancelCareRequest() {}, subscribeCareRequests: () => () => {}, childCareAudience: () => Promise.resolve([{ pub: 'x' }]) } };
const { render } = loadJsx('app/screens-today.jsx', ['AskForHelp'], { win });

const mkCtx = () => { const nav = []; return { nav,
  ctx: { care: { settings: { enabled: true }, myPub: 'aa' }, church: { npub: 'np' },
         openServing: (tab) => nav.push(tab), toast() {} } }; };

test('THE CARE PAGE IS UNCHANGED — the form still opens there', () => {
  // The point of the fix is to move where the form opens, not to remove it. If this goes red the feature is gone.
  const { ctx } = mkCtx();
  const tree = names(render('AskForHelp', { ctx }, { 1: true }));
  assert.ok(tree.includes('AskForHelpForm'),
    'the ask-for-help form no longer opens anywhere — a member cannot ask for help at all');
});

test('the care conversation still opens on the Care page', () => {
  const { ctx } = mkCtx();
  const tree = names(render('AskForHelp', { ctx }, { 0: [{ id: 'r1', status: 'open', at: 1 }], 2: { reqId: 'r1', requesterPub: 'aa' } }));
  assert.ok(tree.includes('CareChatSheet'), 'the care conversation can no longer be opened from the Care page either');
});

// ── The "You asked for help" row ───────────────────────────────────────────────────────────────────────────
// Seen on the OPPO, 2026-08-27: the row rendered "You asked for help · Visits" one word per line down a narrow
// column while "Message" and "Withdraw" kept their full width beside it. Not a text problem — an arithmetic
// one. On a 360px screen: icon 38 + gaps 24 + padding 28 + two non-shrinking buttons ~200 leaves ~45px for the
// text. The row has to be allowed to wrap.
//
// These read the style the component actually produces, not the source text, so extracting the values into a
// variable does not slip past them.
const { render: renderRow } = loadJsx('app/screens-today.jsx', ['MyRequestRow'], { win });
const row = (extra = {}) => renderRow('MyRequestRow',
  { r: { id: 'r1', status: 'open', type: 'visits', forSelf: true, recipients: 4, ...extra },
    onCancel() {}, onMessage() {} });

test('the request row may wrap, so the actions drop below the text instead of crushing it', () => {
  const top = row();
  assert.equal(top.props.style.flexWrap, 'wrap',
    'the row cannot wrap, so on a 360px phone the title renders one word per line beside the buttons');
});

test('the text keeps a usable width before the actions are allowed to sit beside it', () => {
  const kids = flatten(row());
  const text = kids.find(n => n.props && n.props.style && String(n.props.style.flex || '').includes('1 1'));
  assert.ok(text, 'the text column has no flex-basis — it will shrink to whatever the buttons leave over');
  const basis = parseInt(String(text.props.style.flex).split(' ').pop(), 10);
  assert.ok(basis >= 120,
    `the text column may shrink to ${basis}px before the actions wrap; that is narrow enough to break the ` +
    'title across several lines again');
  assert.equal(text.props.style.minWidth, 0, 'without minWidth:0 a long word overflows the row instead of wrapping');
});

test('the actions stay together and keep their size', () => {
  const acts = flatten(row()).find(n => n.props && n.props.style && n.props.style.flexShrink === 0 && n.props.style.gap === 6);
  assert.ok(acts, 'the action group no longer resists shrinking — the buttons will squash instead of wrapping');
  assert.equal(acts.props.style.marginLeft, 'auto',
    'once wrapped onto their own line the actions drift to the left edge instead of staying with the row');
});

// ── nothing on this screen tells a young person their words went to the care team ───────────────────────────
// Their request never reaches the care rota; it reaches the adults their church has cleared. Naming the care
// team tells a child their words went to a group they did not choose to tell — and the audit found the label
// in four places at once: the submit button, the row left behind, the conversation, and the tab framing.
// Confirmed on the OPPO, 2026-08-27, all four visible to a real 15-year-old's account.
// flatten() reports {name, props}; the visible words are string CHILDREN, which live on node.kids. Collect
// those, or every assertion below passes against an empty string — which is how a wording test quietly
// stops testing wording.
const textOf = (n, out = []) => {
  if (typeof n === 'string') { out.push(n); return out; }
  if (!n || typeof n !== 'object') return out;
  for (const k of (n.kids || [])) textOf(k, out);
  return out;
};
const rowText = (props) => textOf(renderRow('MyRequestRow', props)).join(' ');

test('a young person is never told "care team" on their own request row', () => {
  for (const status of ['open', 'approved', 'declined', 'handled']) {
    const txt = rowText({ r: { id: 'r1', status, type: 'visits', forSelf: true, recipients: 4 },
      isMinor: true, onCancel() {}, onMessage() {} });
    assert.ok(!/care team/i.test(txt),
      `the "${status}" row still says "care team" to a child — their request did not go there`);
  }
});

test('an adult is still told exactly who has it', () => {
  const txt = rowText({ r: { id: 'r1', status: 'open', type: 'visits', forSelf: true, recipients: 4 },
    isMinor: false, onCancel() {}, onMessage() {} });
  assert.match(txt, /your care team will be in touch/i,
    'the ordinary path stopped naming the care team — an adult should know who has their request');
  // …and the OTHER statuses, which are built from a different string. Without these, replacing that shared
  // word with the child wording for everyone passed: the open row does not use it.
  for (const [status, want] of [['approved', /Your care team set it up/i],
                                ['declined', /Your care team has closed this one/i],
                                ['handled',  /Your care team is on it/i]]) {
    const t = rowText({ r: { id: 'r1', status, type: 'visits', forSelf: true, recipients: 4 },
      isMinor: false, onCancel() {}, onMessage() {} });
    assert.match(t, want, `an adult's "${status}" row no longer says who is dealing with it`);
  }
});

test('the narrow-audience line still overrides both', () => {
  // recipients <= 2 means only the church leader and the asker hold a key, whoever is asking.
  const txt = rowText({ r: { id: 'r1', status: 'open', type: 'visits', forSelf: true, recipients: 2 },
    isMinor: false, onCancel() {}, onMessage() {} });
  assert.match(txt, /only your church leader can open this/i,
    'a request that reached nobody but the leader is again described as reaching a team');
});

test('the send button does not promise a child a care team either', () => {
  // Rendered, not matched: the button is the one control a young person must press, and a string test on this
  // very file was defeated once by moving the wording into an unused variable.
  const { render: renderForm } = loadJsx('app/screens-today.jsx', ['AskForHelpForm'], { win });
  const ctx = { safeguard: { isMinor: true }, church: { npub: 'np' }, care: { settings: { enabled: true } }, toast() {} };
  const kid = textOf(renderForm('AskForHelpForm', { ctx, onClose() {}, onSent() {} })).join(' ');
  assert.ok(!/Send to care team/.test(kid),
    'the one button a young person must press still reads "Send to care team"');
  const adult = textOf(renderForm('AskForHelpForm',
    { ctx: { ...ctx, safeguard: { isMinor: false } }, onClose() {}, onSent() {} })).join(' ');
  assert.match(adult, /Send to care team/, 'an adult is no longer told where their request goes');
});

// ── CARE IS ON THE CARE PAGE, NOT TODAY ─────────────────────────────────────────────────────
// CareCard renders content only when embedded (the Care tab); a non-embedded render — the shape Today used to
// mount — now draws nothing. careForMe() is the single read that decides the Today "Care" link badge, and it
// must mirror CareCard's own gating (visibility, care roster, the child filter).
const careGlobals = () => {
  const { React, draw } = miniReact();
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    SectionLabel: (p) => React.createElement('h2', {}, p.children),
    ChurchBadge: Stub('ChurchBadge'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => '2026-10-16',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    localStorage: { getItem: () => '1', setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 360,
      Fellowship: { subscribeSafetyCheck: () => () => {}, subscribeCareRequests: () => () => {}, childCareAudience: async () => [] },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } },
  };
  const mod = loadScreen('app/screens-today.jsx', ['CareCard', 'careForMe'], globals);
  return { React, draw, ...mod };
};

const OPEN_NEED = { id: 'n1', recipient: 'bb', displayLabel: 'The Okafor family', type: 'meals', dates: ['2026-10-20', '2026-10-21'] };
const baseCare = (over = {}) => ({
  care: { settings: { enabled: true, visibility: 'all', adminGroupId: 't1' }, myPub: 'aa', needs: [OPEN_NEED],
    slots: [], skips: [], avail: [], fill() {}, clearFill() {}, skip() {}, clearSkip() {} },
  churchRosters: [], safeguard: { isMinor: false, minors: [] }, minorState: 'adult', ...over });

test('CareCard renders nothing on Today (non-embedded), even for a maximally-actionable member', () => {
  const { draw, CareCard } = careGlobals();
  const ctx = baseCare({ churchRosters: [{ team: 't1', people: [{ pub: 'aa' }] }] });   // on the roster AND an open need
  draw(CareCard, { ctx, embedded: false });
  const words = texts(draw(CareCard, { ctx, embedded: false })).join(' | ');
  assert.equal(words.trim(), '', 'CareCard drew content on Today (non-embedded). Care must render only on the Care page now. Shown: ' + words);
});

test('the Care page still shows the sign-up list (the feature moved, it did not vanish)', () => {
  const { draw, CareCard } = careGlobals();
  const ctx = baseCare({ careFocus: 'n1' });   // careFocus expands the need into its per-day rows
  draw(CareCard, { ctx, embedded: true });
  const tree = draw(CareCard, { ctx, embedded: true });
  assert.ok(button(tree, 'I’ll help').length >= 1,
    'the claim-a-day control is gone from the Care page — the sign-up has no home. Shown: ' + texts(tree).join(' | '));
});

test('careForMe counts the open needs an adult may sign up for — the Today "Care" badge', () => {
  const { careForMe } = careGlobals();
  // `open` counts NEEDS that still have a day to take (same count as "If you can help · N"), not single days.
  assert.equal(careForMe(baseCare()).open, 1, 'an open need was not counted for the badge');
});

test('careForMe counts 0 once every day is taken (nothing to badge)', () => {
  const { careForMe } = careGlobals();
  const ctx = baseCare({ care: { settings: { enabled: true, visibility: 'all', adminGroupId: 't1' }, myPub: 'aa',
    needs: [OPEN_NEED], slots: [{ needId: 'n1', isoDate: '2026-10-20', pubkey: 'cc' }, { needId: 'n1', isoDate: '2026-10-21', pubkey: 'cc' }], skips: [], avail: [] } });
  assert.equal(careForMe(ctx).open, 0, 'a fully-covered need still lit the badge');
});

test('careForMe hides team-only needs from a member who is not on the care team', () => {
  const { careForMe } = careGlobals();
  const ctx = baseCare({ care: { settings: { enabled: true, visibility: 'team', adminGroupId: 't1' }, myPub: 'aa',
    needs: [OPEN_NEED], slots: [], skips: [], avail: [] }, churchRosters: [] });
  assert.equal(careForMe(ctx).open, 0, 'a non-team member was badged for a need a "team" church keeps to its care team');
});

test('careForMe counts a team-only need for a member who IS on the care team', () => {
  const { careForMe } = careGlobals();
  const ctx = baseCare({ care: { settings: { enabled: true, visibility: 'team', adminGroupId: 't1' }, myPub: 'aa',
    needs: [OPEN_NEED], slots: [], skips: [], avail: [] }, churchRosters: [{ team: 't1', people: [{ pub: 'aa' }] }] });
  assert.equal(careForMe(ctx).open, 1, 'a care-team member could not see the team needs they are meant to cover');
});

test('careForMe never badges a child — confirmed, or the cold-start "maybe" window', () => {
  const { careForMe } = careGlobals();
  assert.equal(careForMe(baseCare({ safeguard: { isMinor: true, minors: [] }, minorState: 'minor' })).open, 0, 'a confirmed minor was given a sign-up count');
  assert.equal(careForMe(baseCare({ minorState: 'maybe' })).open, 0, 'the cold-start "maybe" window gave a child a sign-up count');
});

test('careForMe is 0 when practical care is switched off', () => {
  const { careForMe } = careGlobals();
  assert.equal(careForMe(baseCare({ care: { settings: { enabled: false }, myPub: 'aa', needs: [OPEN_NEED], slots: [], skips: [], avail: [] } })).open, 0, 'the badge counted needs for a church with care off');
});
