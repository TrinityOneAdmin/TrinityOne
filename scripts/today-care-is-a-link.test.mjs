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
