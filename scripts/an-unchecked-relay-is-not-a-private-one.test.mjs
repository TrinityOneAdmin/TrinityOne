// WE NEVER TELL A STEWARD THEIR INVITE WOULD FAIL UNLESS WE ASKED AND WERE TOLD SO.
// Run: node --test scripts/an-unchecked-relay-is-not-a-private-one.test.mjs
//
// Measured 2026-09-07 on a live console. The invite panel said:
//
//   "Right now your relay only answers on this building's wifi, so an invite would fail on anyone
//    else's phone."
//
// while the relay's own control panel, on the SAME machine, read "ON · PUBLIC · Reachable from anywhere
// https://trinityone.tailbeaac0.ts.net" — and members were joining through that address at the time.
//
// Cause: the effect behind that panel collapsed three different answers into one.
//   tunnelState() -> { running:true,  wss }        the relay IS public
//   tunnelState() -> { supported:true, running:false }   it told us it is NOT public
//   tunnelState() -> { supported:false }           we could not ASK — no local relay to query, or no
//                                                  admin token. NOT evidence either way.
//   throw                                          same: we could not ask.
// All but the first became `setPub(false)`, and `false` renders the flat statement of fact above.
//
// The cost is the whole top of the funnel: a steward who believes their invite is dead does not send it,
// and nobody joins. Worse than the reverse — this is the failure mode where the church never starts.
//
// Point of use (rule 1): this EXECUTES the real effect body out of app/stew-dashboard.jsx, which the
// console ships unbundled, rather than matching text in it (rule 3 forbids that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// The check body is an arrow inside a useEffect; slice from `const check = async () =>` to its close.
function checkBody() {
  const at = STEW.indexOf('const check = async () => {');
  assert.notEqual(at, -1, 'the tunnel-state effect moved — re-anchor rather than widening');
  const open = STEW.indexOf('{', STEW.indexOf('=>', at));
  let d = 0, i = open;
  for (; i < STEW.length; i++) { const c = STEW[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  const body = STEW.slice(STEW.indexOf('async', at), i + 1);
  assert.ok(body.length > 200, 'sliced to a stub — re-anchor');
  return body;
}
function run(tunnelState) {
  const st = { pub: null, calls: 0 };
  const scope = {
    alive: { current: true },
    setPub: (v) => { st.pub = v; st.calls++; },
    window: { Steward: { tunnelState, ownRelayName: async () => 'grace-city' } },
    Promise,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the lifted effect needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const fn = new Function('scope', `with (scope) { return (${checkBody()}); }`)(proxy);
  return { st, fn };
}

test('a relay that says it IS public gives the invite', async () => {
  const g = run(async () => ({ supported: true, running: true, wss: 'wss://x.example/relay' }));
  await g.fn();
  assert.equal(typeof g.st.pub, 'object', 'a public relay did not produce the invite state');
  assert.equal(g.st.pub.wss, 'wss://x.example/relay');
});

test('a relay that says it is NOT public keeps the definite wording', async () => {
  const g = run(async () => ({ supported: true, running: false }));
  await g.fn();
  assert.equal(g.st.pub, false,
    'a relay that told us it is private must still say so plainly — softening THAT would send dead invites');
});

test('THE REGRESSION: “we could not ask” must not be reported as “it is private”', async () => {
  const g = run(async () => ({ supported: false, running: false }));
  await g.fn();
  assert.notEqual(g.st.pub, false,
    'tunnelState answered `supported:false` — meaning we could not ask it — and the console recorded that ' +
    'as a known-private relay. It then tells the steward their invite "would fail on anyone else\'s phone", ' +
    'which is a statement of fact about something never checked.');
  assert.equal(g.st.pub, 'unknown');
});

test('a thrown check is also “could not ask”, not “private”', async () => {
  const g = run(async () => { throw new Error('network'); });
  await g.fn();
  assert.equal(g.st.pub, 'unknown', 'a failed check was recorded as proof the relay is private');
});

// The two states must not share a sentence — that is the whole bug. Comments are stripped first: the
// explanation above quotes the wording it is warning about, and this repo has been bitten by an assertion
// satisfied by the comment stating the rule.
test('the unknown state does not borrow the confident sentence', () => {
  const at = STEW.indexOf('function GoPublicPanel');
  assert.notEqual(at, -1, 'GoPublicPanel moved — re-anchor');
  const panel = STEW.slice(at, at + 4200)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  assert.match(panel, /pub === 'unknown'/, 'the panel no longer distinguishes the unknown state');
  assert.match(panel, /couldn’t check whether your relay/,
    'the unknown state has no wording of its own, so it falls back to the definite claim');
  const definite = panel.split('only answers on this building').length - 1;
  assert.equal(definite, 1,
    `"only answers on this building's wifi" appears ${definite} times. It may appear ONCE, on the branch ` +
    'for a relay that actually told us it is private.');
});
