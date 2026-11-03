// CONSOLE GROUP-CHAT, CARD TAG → MESSAGE, ENGINE HALF. Run: node --test scripts/a-console-group-chat-parses-the-card-tag.test.mjs
//
// Lifts the SHIPPED subscribeGroupChat out of vendor/steward.js and runs it (CLAUDE.md rule 3: no text matching —
// the function is compiled by its own build and executed). The screen half (the card actually DRAWS in
// GroupChatModal) is scripts/a-console-card-renders-in-the-group-chat.test.mjs.
//
// What this proves (PLAN-CONSOLE-CARD-RENDER-2026-10-30 §3A): a kind-1 group post carrying ['card','1',<json>]
// now yields a message with a parsed `card` object, so GroupChatModal can draw it. Malformed/non-object json
// never throws and yields NO card (the plain-text body is the fallback). A reply's quote carries the parent's
// card too, so a quoted card shows its concise text.
//
// Users of the code touched (rule 2), from `grep -n "subscribeGroupChat(" app/*.jsx src/*.js`:
//   subscribeGroupChat -> app/stew-dashboard.jsx GroupChatModal ONLY. Each message gains an optional `card`
//                         field (null unless a ['card',...] tag parses); the quote object gains `card: q.card`.
//                         Both are ADDITIVE — no existing field changed, so the reply UI and everything else
//                         that reads a message are unaffected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const PUB = 'c'.repeat(64), AUTHOR = 'a'.repeat(64);

const ENVELOPE = {
  type: 'finance', title: 'Grace Community Church', periodLabel: 'Q3 2026',
  sections: [{ kind: 'summary', income: 1234500, expenditure: 980000, surplus: 254500 }],
  currency: 'GBP', decimals: 2, generatedAt: '2026-10-30',
};

// Lift subscribeGroupChat with a minimal scope (same recipe as a-console-group-reply-engine.test.mjs). `src`
// lets a sabotage test run a scoped-disabled copy of the function body.
function room({ hiddenIds = [], skeys = {}, src = STEWARD } = {}) {
  const body = fnBody(src, 'subscribeGroupChat(groupId, onMsgs) {', 'subscribeGroupChat');
  let onevent = null; const out = [];
  const pool = { subscribeMany: (r, f, h) => { if (f.some(x => x.kinds && x.kinds.includes(1))) onevent = h.onevent; return { close() {} }; } };
  let hiddenCb = null;
  const scope = { pool, relays: () => [], pub: PUB, _skeys: skeys, decrypt3: (c) => c.replace(/^SEALED:/, ''), setTimeout: () => 0, clearTimeout() {},
    window: { Steward: { subscribeHidden: (cb) => { hiddenCb = cb; cb(new Set(hiddenIds)); return () => {}; } } }, Map, Set, JSON };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  fn.subscribeGroupChat('g1', (m) => { out.length = 0; out.push(...m); });
  const ev = (id, by, content, extra = [], ts = 1) => ({ kind: 1, id, pubkey: by, content, created_at: ts, tags: [['t', 'g1'], ['p', PUB], ...extra] });
  return { send: (e) => onevent(e), ev, out };
}
const cardTag = (env) => ['card', '1', JSON.stringify(env)];

test('a kind-1 carrying a ["card","1",{type:"finance"}] tag yields a message with the parsed card', () => {
  const r = room();
  r.send(r.ev('m1', PUB, 'Grace Community Church — Q3 2026. Open the app for figures.', [cardTag(ENVELOPE)]));
  const m = r.out.find(x => x.id === 'm1');
  // DELETION SIGNAL (rule 1): this assertion is RED the moment the card-parse is dropped from subscribeGroupChat —
  // the message would then carry no `card` and GroupChatModal could never draw it. (A scoped sabotage below proves it.)
  assert.ok(m.card, 'the card tag was not parsed onto the message');
  assert.equal(m.card.type, 'finance');
  assert.equal(m.card.periodLabel, 'Q3 2026');
  assert.equal(m.card.sections[0].income, 1234500);
  assert.equal(m.text, 'Grace Community Church — Q3 2026. Open the app for figures.', 'the plain-text fallback body must be kept');
});

test('malformed card json does not throw and yields NO card — the body still arrives', () => {
  const r = room();
  assert.doesNotThrow(() => r.send(r.ev('bad', PUB, 'FALLBACK BODY', [['card', '1', '{not valid json']])));
  const m = r.out.find(x => x.id === 'bad');
  assert.ok(m, 'the message was dropped on malformed card json');
  assert.equal(m.card, null, 'malformed json must not produce a card');
  assert.equal(m.text, 'FALLBACK BODY');
});

test('a card tag carrying a non-object (string/number/null/array) yields no card', () => {
  const r = room();
  for (const payload of ['"just a string"', '42', 'null', '[1,2,3]']) {
    r.send(r.ev('x-' + payload, PUB, 'PLAIN', [['card', '1', payload]]));
    const m = r.out.find(x => x.id === 'x-' + payload);
    assert.equal(m.card, null, `a non-object card body (${payload}) must not become a card`);
    assert.equal(m.text, 'PLAIN');
  }
});

test('a post with no card tag has card === null (plain posts are unaffected)', () => {
  const r = room();
  r.send(r.ev('p1', AUTHOR, 'Hello everyone'));
  const m = r.out.find(x => x.id === 'p1');
  assert.equal(m.card, null);
  assert.equal(m.text, 'Hello everyone');
});

test("a reply to a card message carries the parent's card on its quote (so the quote shows the card)", () => {
  const r = room();
  r.send(r.ev('m1', PUB, 'Grace Community Church — Q3 2026.', [cardTag(ENVELOPE)], 1));
  r.send(r.ev('m2', AUTHOR, 'thank you', [['e', 'm1', '', 'reply']], 2));
  const m2 = r.out.find(x => x.id === 'm2');
  assert.equal(m2.replyTo, 'm1');
  assert.ok(m2.quote && m2.quote.card, 'the quote did not carry the parent card');
  assert.equal(m2.quote.card.type, 'finance');
});

// DELETION / SABOTAGE (CLAUDE.md rule 1, scoped per "sabotage must be scoped to the function under test"):
// disable the card parse INSIDE subscribeGroupChat only, in a copy of the bundle text, and confirm the card
// stops being produced for a valid tag. The anchor is asserted unique first.
test('SABOTAGE: with the card parse disabled, a valid card tag yields no card', () => {
  const ANCHOR = 'let card = null;';
  const slice = fnBody(STEWARD, 'subscribeGroupChat(groupId, onMsgs) {', 'subscribeGroupChat');
  assert.equal(slice.split(ANCHOR).length - 1, 1, 'the card-parse anchor is not unique within subscribeGroupChat — re-scope this sabotage');
  // Replace the whole try/catch parse with a no-op that leaves `card` null, scoped by the unique anchor
  // (the bundle formats the try/catch across several lines, so match non-greedily through the catch block).
  const sabotaged = STEWARD.replace(/let card = null;[\s\S]*?catch \(x\) \{\s*\}/, 'let card = null;');
  assert.notEqual(sabotaged, STEWARD, 'the sabotage replaced nothing — re-scope');
  const r = room({ src: sabotaged });
  r.send(r.ev('m1', PUB, 'body', [cardTag(ENVELOPE)]));
  const m = r.out.find(x => x.id === 'm1');
  assert.equal(m.card, null, 'with the parse disabled the message must carry no card (the real parse is load-bearing)');
  assert.equal(m.text, 'body', 'the plain-text body still arrives');
});
