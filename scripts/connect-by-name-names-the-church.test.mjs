// CONNECTING A RELAY BY NAME MUST TELL IT WHOSE CHURCH THIS IS.
// Run: node --test scripts/connect-by-name-names-the-church.test.mjs
//
// AUDIT 2026-09-02, item 4. The "Connect by name" box resolved a handle, added the relay, and then registered
// the church with `registerAtRelay(j.url, '')` — an empty name. gateway.mjs refuses a NEW nameless
// self-registration with 400 (rule H4, written after one box accumulated 37 rows the operator could only see
// as a bare npub, none of which could safely be acted on).
//
// That was survivable while an unconfigured relay accepted every write from anyone. It stopped being
// survivable the moment `accept()` began returning false for a box that holds no churches: the steward now
// connects to a relay, is told it worked, and every single thing they write is refused for as long as they
// keep using it. The console's own message pointed them at the relay's OPERATOR — about a field on their own
// settings screen.
//
// WHY THIS DRIVES THE SCREEN AND NOT THE ENGINE (CLAUDE.md rule 1). The engine — registerAtRelay — was never
// broken; it forwards whatever name it is handed. The defect was entirely at the call site, and a test over
// the engine would have passed through all of it. So this lifts the console's OWN function out of
// app/stew-dashboard.jsx, including the line that obtains the church, and runs it against a real relay. Put
// the empty string back and the case below goes red because a real gateway really refused.
//
// AND NOT BY MATCHING TEXT (CLAUDE.md rule 3). app/*.jsx ships unbundled, so `false && ` in front of a
// condition leaves every word of it in place and any text assertion still passes. Nothing here reads the file
// for words: the slice is executed, and every assertion is about what a relay did afterwards.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { fnBody } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

after(() => H.stopAll());

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// A scope that raises a LOUD ReferenceError for anything the lifted code needs and this test did not supply,
// rather than handing it `undefined`. The base-name fallback is for the bundler: esbuild renames imports on
// collision, so `finalizeEvent` arrives as `finalizeEvent2` and a plain object would silently miss it.
const scopeOf = (stubs, what) => new Proxy(stubs, {
  has: (t, k) => (k in t) || !(String(k) in globalThis),
  get: (t, k) => {
    if (k === Symbol.unscopables) return undefined;
    if (k in t) return t[k];
    const base = String(k).replace(/\d+$/, '');
    if (base in t) return t[base];
    throw new ReferenceError(`the lifted ${what} needs \`${String(k)}\` — add a stub`);
  },
});

// THE REAL registerAtRelay, out of the bundle the console actually loads. A hand-written stand-in would put
// the test's own idea of the request on the wire, and the question here is what the SHIPPED console sends.
function liftRegisterAtRelay(church) {
  const body = fnBody(VENDOR, 'async registerAtRelay(wssUrl, name) {', 'registerAtRelay');
  const scope = scopeOf({
    churchSk: church.sk, churchPub: church.pub,
    finalizeEvent, npubEncode, fetch, now: () => Math.floor(Date.now() / 1000),
  }, 'registerAtRelay');
  return new Function('scope', `with (scope) { return ({ ${body} }).registerAtRelay; }`)(scope);
}

// THE CONSOLE'S OWN connectByName, with enough of DashRelaysCard around it to include the line that obtains
// the church. Lifting the arrow function ALONE would mean supplying `church` from here — and then deleting
// the fix from the screen would leave this test supplying the very thing whose absence is the bug.
function liftConnectByName({ churchName, relayUrl, registerAtRelay }) {
  const OPEN = 'function DashRelaysCard() {';
  const start = DASH.indexOf(OPEN);
  assert.notEqual(start, -1, 'DashRelaysCard is gone from app/stew-dashboard.jsx — re-anchor this test');
  const end = DASH.indexOf("  // Bring a church's history onto THIS relay", start);
  assert.notEqual(end, -1, 'the anchor after connectByName has moved — re-anchor this test rather than widening it');
  const body = DASH.slice(start + OPEN.length, end);
  assert.ok(body.includes('const connectByName'), 'connectByName is not inside the sliced window');

  // Which React.useState call is byName's? Counted from the slice rather than hardcoded, so inserting another
  // piece of state above it cannot quietly start seeding the wrong one. If this is ever wrong the handle
  // never reaches the resolver and the assertions below say so.
  const at = body.indexOf('const [byName, setByName]');
  assert.notEqual(at, -1, 'the connect-by-name input state is gone');
  const seedIndex = body.slice(0, at).split('React.useState(').length - 1;

  const sets = [];
  let calls = 0;
  const ctx = {
    React: {
      useState(init) { const i = calls++; return [i === seedIndex ? 'quiet-dove-45' : init, (v) => sets.push({ i, v })]; },
      useEffect() {}, useRef: (v) => ({ current: v }),
    },
    window: {
      useStewardRelays: () => [],
      useStewardChurch: () => ({ name: churchName }),
      Steward: {
        ownRelay: () => '',
        addRelay() {}, rememberRelayName() {},
        backupState: async () => ({}),
        resolveRelayName: async () => ({ url: relayUrl }),
        registerAtRelay,
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(body + '\nthis.run = connectByName;', ctx);
  // Only setByNameMsg is handed an object with `.text`; setByName gets a string. So the messages the card
  // showed can be read without knowing which state index they came from.
  return { run: ctx.run, messages: () => sets.map(s => s.v).filter(v => v && typeof v === 'object' && 'text' in v) };
}

// Does this relay take a church-signed write? On a fresh box that is the whole question: accept() returns
// false while CHURCH_PUBS is empty, so "registered" and "anything I write is kept" are the same fact.
async function writeIsAccepted(relay, church) {
  const w = await H.connect(relay);
  try {
    const [ok] = await H.publish(w, H.churchDoc(church, 'trinityone:probe', { hello: 'world' }));
    return ok;
  } finally { try { w.close(); } catch {} }
}

const churches = async (relay) =>
  (await (await fetch(relay.base + '/config', { headers: { Authorization: 'Bearer ' + relay.adminToken } })).json()).churches || [];

test('connecting by name registers the church under its real name, and its writes are then accepted', async () => {
  const relay = await H.startRelay({ name: 'fresh-box' });
  const church = H.key();
  try {
    assert.equal(await writeIsAccepted(relay, church), false,
      'precondition: a box holding no churches refuses this church\'s writes, which is what registering has to change');

    const card = liftConnectByName({ churchName: 'St Aidan’s, Ferrymead', relayUrl: relay.wsUrl, registerAtRelay: liftRegisterAtRelay(church) });
    await card.run();

    // THE MIRROR, and it is the half that matters. A 200 from /config means the request was well formed; that
    // the church can now WRITE is the thing the steward came here for.
    assert.equal(await writeIsAccepted(relay, church), true,
      'after connecting by name the relay still refuses this church\'s writes. The steward has been told they ' +
      'are connected and every rota, notice and message they save will be discarded.');

    const rows = await churches(relay);
    assert.equal(rows.length, 1, 'the church was not registered at the relay at all');
    assert.equal(rows[0].npub, npubEncode(church.pub), 'a different key was registered');
    assert.equal(rows[0].name, 'St Aidan’s, Ferrymead',
      'the church was registered with no usable name, so the relay operator sees a bare npub and cannot ' +
      'safely act on the row. That is exactly the state rule H4 was written to stop.');

    const last = card.messages().pop();
    assert.ok(last && last.ok === true, 'the card did not report success after a registration that worked');
  } finally { relay.stop(); }
});

test('a church with no name is told to name it, not sent to find the relay operator', async () => {
  // The 400 is CORRECT and must not be softened away — H4 exists because unidentifiable rows accumulate and
  // an operator cannot safely remove one. What was wrong was the sentence: "the relay operator may need to
  // approve your church" sends a steward to somebody else about their own settings screen, and this project
  // has shipped six controls that told a steward a comforting story about something that did not happen.
  const relay = await H.startRelay({ name: 'fresh-box-2' });
  const church = H.key();
  try {
    const card = liftConnectByName({ churchName: '', relayUrl: relay.wsUrl, registerAtRelay: liftRegisterAtRelay(church) });
    await card.run();

    assert.equal((await churches(relay)).length, 0,
      'precondition: the relay refused the nameless registration, so the message below is about a real refusal');
    assert.equal(await writeIsAccepted(relay, church), false,
      'precondition: the church is not registered, so nothing it writes is kept');

    const last = card.messages().pop();
    assert.ok(last, 'the card said nothing at all after a registration that was refused');
    assert.equal(last.ok, false, 'a refused registration was reported as a success');
    assert.match(last.text, /name/i,
      'the steward is not told that the missing church name is the problem, so the one thing they can fix is ' +
      'the one thing nobody mentions:\n  ' + last.text);
    assert.doesNotMatch(last.text, /operator/i,
      'the steward is sent to the relay operator about a field on their own settings screen:\n  ' + last.text);
  } finally { relay.stop(); }
});
