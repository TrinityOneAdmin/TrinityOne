// WHICH RELAY SAID NO — executed, not read. Run: node --test scripts/the-relay-row-says-which-one-refused.test.mjs
//
// 2026-09-08. A church with two relays could not save "people must be approved before they can join". The
// console said a relay had refused; the Settings page showed both relays as "Live"; and the owner and I
// between us produced THREE wrong diagnoses of which relay was at fault and why, over most of a day. The
// relay we blamed turned out to be open, accepting, and carrying fourteen churches.
//
// Nothing was broken about the diagnosis. The information had been thrown away twice over:
//   • publish() kept `errs[0]` — the first excuse, with no relay attached — and dropped the rest.
//   • noteRelayRejection() persisted a TIMESTAMP and nothing else, so the Settings page had nothing to
//     show even though the refusal had already been classified.
// And "Live" only ever meant a socket opened. Answering and accepting are different questions, so the
// relay that refused everything looked exactly like the one that was fine.
//
// These tests execute the real functions lifted out of app/stew-dashboard.jsx, which ships UNBUNDLED —
// CLAUDE.md rule 3 means a text assertion here would pass with `false &&` in front of every line of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');

// lift a top-level function by brace-matching, exactly as publish-error-msg.test.mjs does
function lift(names) {
  let src = '';
  for (const n of names) {
    const at = DASH.indexOf('function ' + n + '(');
    assert.notEqual(at, -1, n + ' is gone — re-anchor this test');
    let depth = 0, end = -1;
    for (let i = DASH.indexOf('{', at); i < DASH.length; i++) {
      const c = DASH[i];
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = i + 1; break; }
    }
    src += DASH.slice(at, end) + '\n';
  }
  return src;
}

// a localStorage + window standing in for the console's, so the REAL functions run unmodified
function harness() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const window = { REG_NEEDED_LS: 'trinityone.steward.relay-rejected', addEventListener() {}, dispatchEvent() { return true; } };
  window.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
  const body = lift(['noteRelayRejection', 'relaysThatRefused', 'relayRejectionActive', 'clearRelayRejection']);
  const fns = new Function('window', 'localStorage', 'CustomEvent',
    'const REG_NEEDED_TTL = 7*24*60*60*1000; window.REG_REFUSED_LS = "trinityone.steward.relay-refused-urls";\n'
    + body + '; return { noteRelayRejection, relaysThatRefused, relayRejectionActive, clearRelayRejection };'
  )(window, localStorage, window.CustomEvent);
  return { ...fns, store };
}

test('the refusing relay is remembered by NAME, not just by the fact it happened', () => {
  const h = harness();
  h.noteRelayRejection([
    { url: 'wss://a.example/relay', error: 'blocked: not a member or not permitted for this group' },
    { url: 'wss://b.example/relay', error: 'blocked: not a member or not permitted for this group' },
  ]);
  const got = h.relaysThatRefused();
  assert.equal(got.length, 2, 'the console still records only THAT a relay refused, not which');
  assert.deepEqual(got.map(r => r.url).sort(), ['wss://a.example/relay', 'wss://b.example/relay']);
  assert.match(got[0].error, /not a member/, "the relay's own words were dropped — the row has nothing to show");
});

test('a refusal that has gone stale reports no relays, so the page cannot accuse a relay that was fixed', () => {
  const h = harness();
  h.noteRelayRejection([{ url: 'wss://a.example/relay', error: 'blocked' }]);
  assert.equal(h.relaysThatRefused().length, 1);
  h.store.set('trinityone.steward.relay-rejected', String(Date.now() - 8 * 24 * 60 * 60 * 1000));
  assert.deepEqual(h.relaysThatRefused(), [],
    'a rejection older than the TTL still names relays — the operator may have fixed it a week ago');
});

test('clearing the alarm forgets the names too', () => {
  const h = harness();
  h.noteRelayRejection([{ url: 'wss://a.example/relay', error: 'blocked' }]);
  h.clearRelayRejection();
  assert.deepEqual(h.relaysThatRefused(), [], 'the names outlived the alarm that owns them');
});

test('being called with nothing is safe — an older publish path passes no list', () => {
  const h = harness();
  h.noteRelayRejection();
  assert.equal(h.relayRejectionActive(), true, 'the alarm itself must still be raised');
  assert.deepEqual(h.relaysThatRefused(), []);
});

// The engine half: both publish paths must ATTACH the relay to the excuse. Not a text assertion about
// behaviour (rule 3) — it checks that the index-aligned mapping exists in each failure branch, which is the
// one thing that cannot be recovered later if it is dropped.
test('both publish paths map their refusals back onto the relay list', () => {
  for (const [fn, targets] of [['async function publish(', '_targets'], ['async function _publishToRelays(', 'targets']]) {
    const at = STEW.indexOf(fn);
    assert.notEqual(at, -1, fn + ' is gone — re-anchor this test');
    let depth = 0, end = -1;
    for (let i = STEW.indexOf('{', at); i < STEW.length; i++) {
      const c = STEW[i];
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = i + 1; break; }
    }
    const body = STEW.slice(at, end)
      .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    assert.match(body, new RegExp('refused\\s*=\\s*' + targets + '\\.map'),
      fn + ' no longer maps its refusals onto ' + targets + ', so the console is back to one anonymous excuse');
    assert.match(body, /detail:\s*\{[^}]*refused/,
      fn + ' stopped carrying `refused` on the event, so the Settings page cannot name the relay');
  }
});
