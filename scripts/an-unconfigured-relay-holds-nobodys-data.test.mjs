// A FRESHLY INSTALLED RELAY USED TO ACCEPT EVERY WRITE FROM ANYONE.
//
// `accept()` opened with `if (!CHURCH_PUBS.size) return true` — a box with no churches configured took the
// world. That was defensible while a stranger's box was unreachable anyway. It stopped being defensible on
// 2026-09-02, when admission became "does it prove it runs our software": a freshly installed relay is
// exactly such a box, so an address pointed at one would be handed a congregation's corpus by a client that
// had no way to know better.
//
// THE HALF THAT MUST NOT BREAK is first registration, which is why this file exists rather than a one-line
// change. A church has to be able to register with a box that has never heard of it, or no church could be
// created at all. That still works because registration is HTTP at /config and never reaches accept(), and
// CHURCH_PUBS loads from church.json and the environment at startup rather than from replayed events. Both
// halves are asserted here: closing the gate without the second is how you brick every first run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import * as H from './relay-network-harness.mjs';

let FRESH, church;
before(async () => { FRESH = await H.startRelay({ name: 'fresh' }); church = H.key(); });   // no churches configured
after(() => H.stopAll());

test('precondition: this relay really is unconfigured', async () => {
  const st = await FRESH.status();
  assert.ok(st, 'the relay did not answer /status at all, so nothing below means anything');
  assert.notEqual(st.writePolicy, true,
    'this box already has a church configured, so it is not staging an unconfigured relay');
});

test('an unconfigured relay refuses a church document', async () => {
  const doc = H.churchDoc(church, 'trinityone/notices', { text: 'not for a box that knows nobody' });
  const w = await H.connect(FRESH);
  try {
    const [ok, msg] = await H.publish(w, doc);
    assert.equal(ok, false,
      'a relay with no churches configured accepted a church document. Since admission became "proves it ' +
      'runs our software", a freshly installed box is admitted by clients — so this is a stranger\'s box ' +
      'being handed a congregation\'s corpus.');
    assert.ok(String(msg || '').length > 0, 'the refusal carried no reason, so nothing can explain it');
  } finally { try { w.close(); } catch {} }
  assert.equal((await H.corpus(FRESH, church)).length, 0, 'the document was stored despite being refused');
});

test('…and a church can still register with it, which is what must not break', async () => {
  // EXACTLY THE SHAPE THE CONSOLE SENDS (registerAtRelay in src/steward.src.js): the proof travels in the
  // BODY as `auth`, not as an Authorization header, and the payload is `{ addChurch: { npub, name } }`. A
  // test that invents its own shape here reports registration broken when it is not — which is precisely
  // what my first probe did, and it looked exactly like the catastrophic outcome.
  const url = FRESH.base + '/config';
  const auth = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', 'POST']], content: '' }, church.sk);
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addChurch: { npub: npubEncode(church.pub), name: 'St Test' }, auth }),
  });
  assert.ok(res.ok, `a church could not register with a fresh relay (HTTP ${res.status}). Every first run — ` +
    'the Suite, a phone-only church, the test harness — starts exactly here, so this is the failure that ' +
    'bricks church creation rather than merely tightening a gate.');
});

test('once registered, its own church is accepted again', async () => {
  // The mirror. Without it the refusal above passes just as happily against a relay that accepts NOTHING,
  // which is a different and worse defect wearing the same result.
  const doc = H.churchDoc(church, 'trinityone/notices', { text: 'now it knows whose this is' });
  const w = await H.connect(FRESH);
  try {
    const [ok, msg] = await H.publish(w, doc);
    assert.equal(ok, true, `a registered church was still refused by its own relay: ${msg}`);
  } finally { try { w.close(); } catch {} }
  assert.equal((await H.corpus(FRESH, church)).length, 1, 'the accepted document was not actually stored');
});

test('teardown leaves nothing behind', () => {
  H.stopAll();
  assert.deepEqual(H.leftovers().processes, [], 'a relay process survived');
});
