// WHEN TWO CLEARANCES SHARE A SECOND, THE CHURCH AND THE CHILD'S PHONE MUST AGREE ON THE WINNER.
// Run: node --test scripts/clearance-tiebreak.test.mjs
//
// AUDIT-9. `created_at` is whole seconds and public, so two authorised writers colliding in the same second is
// not exotic — and under this product's threat model a compelled relay may reorder what it serves. The two
// programs disagreed:
//
//   the member's app  `if (_ts < _clrTs) return`   — an equal second is ACCEPTED, so the LAST copy to arrive
//                                                    wins, and the relay chooses which that is.
//   the console       `top.created_at <= ours`     — an equal second is INVISIBLE, so it never rewrites.
//
// Result: a steward key stamps the church's own second, the child's phone applies whichever copy the relay
// hands over last, and the console reports skipped / 0 failed / no banner. Measured before this fix: the same
// two events delivered in one order gave the child "adult", and in the other gave "child".
//
// The rule is now shared and deterministic: newer second wins; on an EQUAL second the higher event id wins.
// Both sides must implement it identically — changing one alone re-opens the same class in the other
// direction, which is how the worst defect of the previous round happened.
//
// This drives the SHIPPED member handler lifted out of vendor/fellowship.js, not a paraphrase of it. The
// console-side assertions drive vendor/steward.js the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CLEAR_D = 'trinityone/clearance:';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

function grab(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

const church = K(), steward = K(), child = K();

// ── the MEMBER's side, lifted whole ────────────────────────────────────────────────────────────────────────
// `_onChurchDocs` is stubbed only to hand back the real handlers; every decision below is the shipped one.
function memberSide() {
  const body = grab(FELLOWSHIP, 'subscribeChurchSafeguard(churchNpub, onLists) {');
  const decName = (body.match(/\b(decrypt\d*)\(/) || [])[1];
  const ckName = (body.match(/\b(getConversationKey\d*)\(/) || [])[1];
  assert.ok(decName && ckName, 'the member no longer decrypts its clearance the way this test expects');
  let handlers = null;
  const scope = {
    toPub: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    pubSet: (a) => new Set(a || []),
    _noPhoto: new Set(),
    _churchRoster: new Map([[church.pub, new Set([steward.pub])]]),   // the steward IS seated
    _onChurchDocs: (_pubk, h) => { handlers = h; return () => {}; },
    sk: child.sk,
    pub: child.pub,
    [decName]: (c, k) => nip44v2.decrypt(c, k),
    [ckName]: (a, b) => nip44v2.utils.getConversationKey(a, b),
    window: { Fellowship: { myPubkey: child.pub } },
  };
  const names = Object.keys(scope);
  const fn = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  let last = null;
  fn.subscribeChurchSafeguard(church.pub, (x) => { last = x; });
  assert.ok(handlers, 'the member handler was never registered — the lift is wrong');
  return {
    feed: (e) => handlers.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1] || ''),
    isMinor: () => (last ? !!last.isMinor : null),
  };
}

const clearanceBy = (signer, at, minor) => finalizeEvent({
  kind: 30078, created_at: at,
  tags: [['d', CLEAR_D + child.pub], ['t', 'trinityone'], ['p', child.pub], ['church', church.pub]],
  content: nip44v2.encrypt(JSON.stringify({ minor, cleared: false, at }), nip44v2.utils.getConversationKey(signer.sk, child.pub)),
}, signer.sk);

test('the child reads the SAME answer whichever order the relay serves two same-second copies', async () => {
  const at = now();
  const churchCopy = clearanceBy(church, at, true);      // the church says: this is a child
  const stewardCopy = clearanceBy(steward, at, false);   // a seated steward says: not a child. SAME second.
  assert.equal(churchCopy.created_at, stewardCopy.created_at, 'fixture: the two copies must share a second');

  const a = memberSide(); a.feed(churchCopy); a.feed(stewardCopy);
  const b = memberSide(); b.feed(stewardCopy); b.feed(churchCopy);

  assert.equal(a.isMinor(), b.isMinor(),
    `the child's own app reached a different conclusion depending only on the order the relay handed over two `
    + `copies stamped with the same second: ${a.isMinor()} vs ${b.isMinor()}. Whether a child is treated as a `
    + 'child must not be decided by delivery order — least of all under a threat model that grants the relay '
    + 'the ability to reorder what it serves.');

  // …and the winner is the one BOTH sides can agree on without talking: the higher event id.
  const expected = stewardCopy.id > churchCopy.id ? false : true;
  assert.equal(a.isMinor(), expected,
    'the tiebreak is not the shared rule (higher event id wins), so the console cannot predict what the '
    + 'child is reading even when it can see both copies');
});

test('…and the console can SEE the copy that beat its own, so it rewrites instead of skipping', async () => {
  // The other half. If the member applies a same-second copy and the console treats it as invisible, the
  // console reports a clean run while the child reads the wrong thing — and nothing ever retries.
  const guards = grab(STEWARD, 'var _beatsDoc = ') + ';\n'
    + grab(STEWARD, 'function _memberHonours(') + grab(STEWARD, 'function _topWeMustAnswer(')
    + (STEWARD.match(/var _CLOCK_SKEW = [^\n]*\n/) || [])[0]
    + (STEWARD.match(/var _authFuture = [^\n]*\n/) || [])[0];
  const scope = { _careRoster: new Set([steward.pub]), _careRosterKnown: true, now, Math, Date };
  const names = Object.keys(scope);
  const { _topWeMustAnswer, _memberHonours } =
    new Function(...names, guards + '\nreturn ({ _topWeMustAnswer, _memberHonours });')(...names.map(n => scope[n]));

  const at = now();
  const ours = clearanceBy(church, at, true);
  const theirs = clearanceBy(steward, at, false);
  assert.equal(_memberHonours(theirs, church.pub), true, 'fixture: a seated steward must be an honoured author');

  const top = _topWeMustAnswer({ top: theirs, ours }, ours);
  if (theirs.id > ours.id) {
    assert.ok(top,
      'the console cannot see a same-second copy that the child\'s phone is applying over ours. It concludes '
      + 'the member is settled, skips, reports 0 failed and no banner — and the child keeps reading the '
      + 'steward\'s answer for ever.');
  } else {
    assert.equal(top, null,
      'the console wants to rewrite a copy the child is NOT applying — that is the symmetric fight that makes '
      + 'two consoles rewrite the roster past each other on every visit');
  }
});
