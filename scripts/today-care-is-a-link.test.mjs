// TODAY LINKS TO CARE; IT DOES NOT OPEN CARE'S SHEETS.
// Run: node --test scripts/today-care-is-a-link.test.mjs
//
// Found on the OPPO against the live relay, 2026-08-27, by looking at the screen. Tapping "Ask for help" on
// Today drew the sheet as a 324x107 box sitting on top of the "Practical care" heading, its own last line cut
// off mid-word. Measured, not guessed:
//
//     overlay  position:absolute inset:0   ->  top 429, height 107, width 324   (not the viewport)
//     ancestor transform: matrix(1,0,0,1,0,0)                                    BREAKS_FIXED: true
//
// The sheet had not been touched since it was written. What moved was the card: af7824b put Practical care on
// Today because three members hunted for care inside "Serving & events" and never found it. Today wraps that
// section in `animation: trinityFade … both`, and the identity transform an animation leaves behind becomes the
// containing block for `position: absolute` — so a full-screen backdrop is confined to the card's own 122px box.
// `position: fixed` would be trapped by that ancestor too, and the absolute+inset:0 backdrop is the house
// pattern in 48 other places where it is correct. So Today links to the Care page and opens no sheet.
//
// These assertions RENDER the shipped component. A pre-push audit defeated a string-matching test on this same
// file by moving wording into an unused variable, and every assertion still passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadJsx, flatten, names } from './jsx-render.mjs';
import { stripComments } from './test-slice.mjs';

const win = { Fellowship: { cancelCareRequest() {}, subscribeCareRequests: () => () => {}, childCareAudience: () => Promise.resolve([{ pub: 'x' }]) } };
const { render } = loadJsx('app/screens-today.jsx', ['AskForHelp'], { win });

const mkCtx = () => { const nav = []; return { nav,
  ctx: { care: { settings: { enabled: true }, myPub: 'aa' }, church: { npub: 'np' },
         openServing: (tab) => nav.push(tab), toast() {} } }; };

// hook order in AskForHelp: 0 = mine[], 1 = open, 2 = chatting, 3 = audience
const OPEN_AND_CHATTING = { 0: [{ id: 'r1', status: 'open', at: 1 }], 1: true, 2: { reqId: 'r1', requesterPub: 'aa' } };

test('Today shows the ask, and it is a link — no sheet is rendered', () => {
  const { ctx } = mkCtx();
  const tree = names(render('AskForHelp', { ctx, linkOnly: true }, OPEN_AND_CHATTING));
  assert.ok(!tree.includes('AskForHelpForm'),
    'Today still renders the ask-for-help sheet. Its backdrop is absolute+inset:0 and Today\'s animated wrapper ' +
    'is its containing block, so it draws as a small box over the "Practical care" heading with the text cut off.');
  assert.ok(!tree.includes('CareChatSheet'),
    'Today still renders the care conversation sheet — same trapped backdrop, same broken box.');
});

test('tapping it takes you to the Care page', () => {
  const { ctx, nav } = mkCtx();
  const btn = flatten(render('AskForHelp', { ctx, linkOnly: true })).find(n => n.name === 'button');
  assert.ok(btn, 'the ask-for-help control is gone from Today entirely — three members could not find care ' +
    'inside "Serving & events", which is why it was put on Today in the first place');
  btn.props.onClick();
  assert.deepEqual(nav, ['care'], 'tapping "Ask for help" on Today did not open the Care page');
});

test('an open request on Today opens the Care page, not the trapped chat sheet', () => {
  const { ctx, nav } = mkCtx();
  const row = flatten(render('AskForHelp', { ctx, linkOnly: true }, { 0: [{ id: 'r1', status: 'open', at: 1 }] }))
    .find(n => n.name === 'MyRequestRow');
  assert.ok(row, 'a member\'s own open request no longer shows on Today');
  row.props.onMessage();
  assert.deepEqual(nav, ['care'], 'the "message" action on Today still opens the sheet instead of the Care page');
});

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

test('Today passes linkOnly and the Care tab does not', () => {
  // Both call sites read `<AskForHelp ctx={ctx} />` character for character, so this is pinned by which
  // render they sit in, not by a pattern — a pattern replace would silently hit whichever came first.
  // Slice on CODE, then strip comments. Slicing on a comment marker cannot work here — stripComments has
  // already removed it, and the first version of this test failed for exactly that reason.
  const raw = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
  const iToday = raw.indexOf('<SectionLabel>Practical care</SectionLabel>');
  assert.ok(iToday > 0, 're-anchor: the Today care section no longer starts with the Practical care label');
  const embedded = stripComments(raw.slice(raw.indexOf('if (embedded)'), iToday));
  const today = stripComments(raw.slice(iToday));
  assert.match(today.slice(0, 400), /<AskForHelp ctx=\{ctx\} linkOnly/,
    'the Today render no longer passes linkOnly, so the trapped sheet is back');
  assert.doesNotMatch(embedded, /<AskForHelp ctx=\{ctx\} linkOnly/,
    'the Care tab was made link-only too, which leaves nowhere for the form to open');
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
