// THE PHONE'S "DOES JOINING NEED APPROVAL?" IS DECIDED WHEN IT IS READ, NOT WHEN A COPY ARRIVES (SIGNUP-SAFEGUARDING-GAPS gap 4).
//   Run: node --test scripts/a-join-approval-is-decided-when-it-is-read.test.mjs
//
// R-M1 already made subscribeChurchJoin newest-wins, but it decided at ARRIVAL: a steward's copy that reached the phone BEFORE the
// steward roster was dropped by the trust check and never looked at again (`onroster` only re-emitted the stale value). So church
// approval:true@S+1, then a NEWER steward approval:false@S+2, then the roster, ended on `true`. Display only — the relay enforces
// approval whatever the phone shows — but the harmful direction (steward turns approval ON, phone shows "admitted") is the same bug.
//
// The reader under test is the SHIPPED one, lifted out of vendor/fellowship.js (rebuilt from src), fed the copies and the roster in
// the orders the docs hub can hand them over. Nothing about the trust rule is stubbed: `_churchRoster` is the real Map shape it reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const F = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CP = 'c'.repeat(64), HELPER = 'e'.repeat(64), OTHER = 'd'.repeat(64), ME = 'a'.repeat(64);
const S = 1_790_000_000; let n = 0;
const D = 'trinityone/joinpolicy:' + CP;
const ev = (by, content, at, tags = []) => ({ id: (++n).toString(16).padStart(64, '0'), pubkey: by, created_at: at, kind: 30078, tags: [['d', D], ['t', 'trinityone'], ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) });

// a driver: a list of steps, each an event or { roster: [pubkeys] }; returns the LAST state the phone was told
function run(steps) {
  let h = null, state = null; const roster = new Map();
  const stubs = { toPub: () => CP, pub: ME, _churchRoster: roster, window: { Fellowship: { myPubkey: ME } }, authState: () => ({ failed: false }), _onChurchDocs: (_cp, x) => { h = x; return () => {}; } };
  const built = new Function(...Object.keys(stubs), `return ({ ${fnBody(F, 'subscribeChurchJoin(churchNpub, onState) {', 'subscribeChurchJoin')} });`)(...Object.values(stubs));
  built.subscribeChurchJoin('npub', (s) => { state = s; });
  for (const st of steps) {
    if (st.roster) { if (st.roster.length) roster.set(CP, new Set(st.roster)); else roster.delete(CP); h.onroster(); }
    else h.onevent(st, D);
  }
  h.oneose();
  return state;
}
const R = (...p) => ({ roster: p });

test('THE BUG: church true@1, a NEWER steward false@2, and the roster arrives LAST -> not required (the steward copy is counted once the roster says who they are)', () => {
  const s = run([ev(CP, { approval: true }, S + 1), ev(HELPER, { approval: false }, S + 2), R(HELPER)]);
  assert.equal(s.approval, false, 'THE NEWER STEWARD COPY THAT BEAT THE ROSTER WAS DROPPED AND NEVER RE-CHECKED — the phone still shows approval ON');
});
test('THE HARMFUL DIRECTION: church false@1, a NEWER steward true@2, roster last -> required (the phone must not show "admitted")', () => {
  const s = run([ev(CP, { approval: false }, S + 1), ev(HELPER, { approval: true }, S + 2), R(HELPER)]);
  assert.equal(s.approval, true, 'a steward turned approval ON and the phone still shows it off');
  assert.equal(s.isPending, true, 'a not-yet-admitted member of an approval church is not shown as pending');
});
test('every arrival order of {church@1, steward@2, roster} ends on the newest trusted copy', () => {
  const a = ev(CP, { approval: true }, S + 1), b = ev(HELPER, { approval: false }, S + 2);
  const orders = [[a, b, R(HELPER)], [b, a, R(HELPER)], [R(HELPER), a, b], [R(HELPER), b, a], [a, R(HELPER), b], [b, R(HELPER), a]];
  orders.forEach((o, i) => assert.equal(run(o).approval, false, 'order #' + i + ' ended on the older copy'));
});
test('VOID: a steward copy from someone who is NEVER on the roster pins nothing — the church\'s older copy stands', () => {
  assert.equal(run([ev(CP, { approval: true }, S + 1), ev(OTHER, { approval: false }, S + 2), R(HELPER)]).approval, true, 'a stranger\'s newer copy turned approval off');
});
test('VOID: a steward REMOVED from the roster after their copy arrived no longer pins it (trust is read now, not at arrival)', () => {
  const s = run([R(HELPER), ev(CP, { approval: true }, S + 1), ev(HELPER, { approval: false }, S + 2), R(OTHER)]);
  assert.equal(s.approval, true, 'a removed helper\'s newer copy still decided approval');
});
test('a trusted TOMBSTONE or unparseable newest copy reads as not required; an OLDER trusted copy does not come back', () => {
  assert.equal(run([ev(HELPER, { approval: true }, S + 1), ev(CP, '', S + 2, [['deleted', '1']]), R(HELPER)]).approval, false, 'a tombstone did not clear approval');
  assert.equal(run([ev(CP, { approval: true }, S + 1), ev(HELPER, 'not json', S + 2), R(HELPER)]).approval, false, 'an unparseable newest copy kept the older true');
});
test('same-second tie goes to the LOWER event id, as the relays decide', () => {
  const x = ev(CP, { approval: true }, S + 5), y = ev(HELPER, { approval: false }, S + 5);   // x was minted first, so x.id < y.id
  assert.equal(run([y, x, R(HELPER)]).approval, true); assert.equal(run([x, y, R(HELPER)]).approval, true);
});
test('CONTROL: only a church copy, no roster at all -> the church\'s own copy counts', () => {
  assert.equal(run([ev(CP, { approval: true }, S + 1)]).approval, true);
  assert.equal(run([]).approval, false, 'no copy at all must read as not required (the existing default)');
});
