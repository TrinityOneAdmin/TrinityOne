// A PINNED FINANCE CARD BANNER IS A SHORT SUMMARY, NOT THE FULL STATEMENT DUMP. Run:
//   node --test scripts/a-pinned-finance-card-is-a-summary-not-the-body.test.mjs
//
// Owner-found bug: pinning a finance-card message showed the whole plain-text statement body
// ("…Total income…BALANCE SHEET…") in the pinned banner. The pin stores a { msgId, text, by, ts }
// snapshot; `text` was the message's full body. Both pin builders now store a concise summary for a
// finance card and keep the full text for every other message.
//
// Rule 3: the pin builders ship bundled, so this LIFTS the shipped functions out of the REBUILT bundles
// (vendor/steward.js, vendor/fellowship.js) and runs them — no source-text matching. A view test would pass
// over a stale bundle; this reads the bundle the apps actually load.
//
// Users of the code touched (rule 2):
//   - src/steward.src.js  pinPost(groupId, msg)            -> console pin builder. Caller: GroupChatModal's
//     doPin (app/stew-dashboard.jsx). Render site: the pinned banner {pin.text} in stew-dashboard.jsx.
//   - src/fellowship.src.js pinPost(churchNpub, groupId, msg) -> member pin builder. Caller: the pin action in
//     app/screens-chat.jsx. Render site: the pinned banner in screens-chat.jsx.
//   Both render sites are UNCHANGED — they now receive the summary instead of the body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CHURCH = 'c'.repeat(64);

// A long plain-text statement body — exactly the kind of dump that was leaking into the banner.
const BODY = 'Living Word Church — Q4 2026\n\nFinancial statement for the quarter.\nTotal income £12,345.00\nTotal spending £9,800.00\nBALANCE SHEET\nGeneral fund £5,123.00';
const CARD = { type: 'finance', title: 'Living Word Church', periodLabel: 'Q4 2026', currency: 'GBP', decimals: 2,
  sections: [{ kind: 'summary', income: 1234500, expenditure: 980000, surplus: 254500 }] };

// ---- console pin builder (vendor/steward.js) -------------------------------------------------------------
function runStewardPin(body, msg) {
  let published = null;
  const scope = { sk: new Uint8Array(32).fill(1), now: () => 1000, publish: (e) => { published = e; return Promise.resolve(e); },
    feChurch: (e) => e, PIN_D: 'trinityone/pin:', NET: 'net', pub: CHURCH, JSON, Promise };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  fn.pinPost('g1', msg);                       // publish() is called synchronously inside, so `published` is set
  return JSON.parse(published.content);
}
const STEW_ANCHOR = 'pinPost(groupId, msg) {';
const stewardPin = (msg) => runStewardPin(fnBody(STEWARD, STEW_ANCHOR, 'pinPost'), msg);

// ---- member pin builder (vendor/fellowship.js) -----------------------------------------------------------
async function runMemberPin(body, msg) {
  const scope = { sk: new Uint8Array(32).fill(1), window: { Fellowship: { ready: Promise.resolve() } }, toPub: (x) => x,
    finalizeEvent2: (e) => e, _monotonicF: (e) => e, NET: 'net', _publishBounded: () => Promise.resolve(), publishSetFor: () => [],
    _pubReason: () => 'x', console, JSON, Math, Date, Promise };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  const r = await fn.pinPost(CHURCH, 'g1', msg);
  return JSON.parse(r.evt.content);
}
const MEMBER_ANCHOR = 'async pinPost(churchNpub, groupId, msg) {';
const memberPin = (msg) => runMemberPin(fnBody(FELLOWSHIP, MEMBER_ANCHOR, 'pinPost'), msg);

// what a well-formed summary must and must NOT contain
function assertSummary(pin) {
  assert.match(pin.text, /Financial statement/, 'the pin summary omits "Financial statement"');
  assert.match(pin.text, /Q4 2026/, 'the pin summary omits the period');
  assert.match(pin.text, /Living Word Church/, 'the pin summary omits the church title');
  assert.ok(!/Total income/i.test(pin.text), 'the pin still dumps the figures ("Total income")');
  assert.ok(!/BALANCE SHEET/i.test(pin.text), 'the pin still dumps the statement body ("BALANCE SHEET")');
}

test('CONSOLE: pinning a finance-card message stores a short summary, not the body', () => {
  const pin = stewardPin({ id: 'm1', text: BODY, card: CARD, by: CHURCH, ts: 7 });
  assertSummary(pin);
  assert.equal(pin.text, 'Living Word Church · Financial statement · Q4 2026');
  assert.equal(pin.msgId, 'm1');                // snapshot otherwise unchanged
});

test('MEMBER: pinning a finance-card message stores a short summary, not the body', async () => {
  const pin = await memberPin({ id: 'm1', text: BODY, card: CARD, pubkey: 'author' });
  assertSummary(pin);
  assert.equal(pin.text, 'Living Word Church · Financial statement · Q4 2026');
});

test('a plain text message still pins its FULL text (console + member)', async () => {
  const plain = { id: 'p1', text: 'Can someone bring chairs on Sunday?' };
  assert.equal(stewardPin({ ...plain, by: CHURCH }).text, 'Can someone bring chairs on Sunday?');
  assert.equal((await memberPin({ ...plain, pubkey: 'author' })).text, 'Can someone bring chairs on Sunday?');
});

test('a garbage / non-finance / absent card falls back to the text body (console)', () => {
  for (const card of [undefined, null, 'not an object', 42, { type: 'verse' }, {}]) {
    assert.equal(stewardPin({ id: 'x', text: 'PLAIN BODY', card, by: CHURCH }).text, 'PLAIN BODY', 'a non-finance card must keep the text body');
  }
});

// SABOTAGE (CLAUDE.md rule 1; scoped to pinPost): disable the finance-summary branch in a copy of the lifted
// body only, and confirm the full dump comes back — so the summary branch is load-bearing in each bundle.
test('SABOTAGE: with the summary branch disabled, the full body dump returns (both bundles)', async () => {
  const ANCHOR = '_pc.type === "finance"';
  // console
  const stewBody = fnBody(STEWARD, STEW_ANCHOR, 'pinPost');
  assert.equal(stewBody.split(ANCHOR).length - 1, 1, 'the summary anchor is not unique in console pinPost — re-scope');
  const stewSab = stewBody.replace(ANCHOR, 'false && ' + ANCHOR);
  assert.match(runStewardPin(stewSab, { id: 'm1', text: BODY, card: CARD, by: CHURCH }).text, /Total income/, 'console: the summary branch is not load-bearing');
  // member
  const memBody = fnBody(FELLOWSHIP, MEMBER_ANCHOR, 'pinPost');
  assert.equal(memBody.split(ANCHOR).length - 1, 1, 'the summary anchor is not unique in member pinPost — re-scope');
  const memSab = memBody.replace(ANCHOR, 'false && ' + ANCHOR);
  assert.match((await runMemberPin(memSab, { id: 'm1', text: BODY, card: CARD, pubkey: 'author' })).text, /Total income/, 'member: the summary branch is not load-bearing');
});
