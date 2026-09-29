// A READY-TO-HELP NOTE IS NEVER STORED IN PLAIN TEXT.
//   Run: node --test scripts/a-ready-to-help-note-is-never-stored-in-plain-text.test.mjs
//
// THE DEFECT. `setCareAvail` publishes the member's free-text note through `_sealChurchDocMember`.
// When the phone has no name key (open-join church, console not open yet), that function falls back
// to bare JSON. The note then sits readable on the relay's disk — and it can name a nurse, a child,
// a mother alone with a baby. Nothing ever re-seals it.
//
// THE FIX. `setCareAvail` checks for the name key BEFORE publishing. Without it, the engine returns
// `{ ok: false, reason: 'no-key' }` and no event reaches the relay. The caller (CareAvailability in
// screens-today.jsx) shows "Your church hasn't shared its key with this phone yet — try again in a
// moment."
//
// Callers: setCareAvail ← app/app.jsx care.setAvail ← CareAvailability in app/screens-today.jsx.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

function makeScope({ withKey = true } = {}) {
  const published = [];
  const nameKeys = new Map();
  if (withKey) nameKeys.set('church1', [new Uint8Array(32).fill(42)]);
  const storage = {};
  return {
    published,
    scope: {
      toPub: (x) => x,
      sk: 'deadbeef',
      finalizeEvent: (tmpl, _sk) => { const e = { ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }; return e; },
      finalizeEvent2: (tmpl, _sk) => { const e = { ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }; return e; },
      _publishAny: async (relays, evt) => { published.push(evt); return true; },
      churchRelays: () => ['wss://r'],
      publishSetFor: () => ['wss://r'],
      _pubReason: () => 'test',
      _nameKeys: nameKeys,
      _sealChurchDocMember: (cp, obj) => {
        const body = JSON.stringify(obj);
        const k = (nameKeys.get(cp) || [])[0];
        if (!k) return body;
        return JSON.stringify({ e: Buffer.from(body).toString('base64') });
      },
      NET: 'trinityone',
      CAREAVAIL_D: 'trinityone/careavail:',
      window: { Fellowship: { churchPub: 'church1', ready: Promise.resolve() } },
      Math, Date, JSON, console, Number, String, Array,
      localStorage: {
        getItem: (k) => storage[k] || null,
        setItem: (k, v) => { storage[k] = v; },
      },
    },
  };
}

function liftSetCareAvail(scope) {
  const body = fnBody(FELLOWSHIP, 'async setCareAvail(tags, note) {', 'setCareAvail');
  return new Function('scope', `with (scope) { return (async function setCareAvail(tags, note) ${body.slice(body.indexOf('{'))}); }`)(
    new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (k in t) return t[k];
        if (String(k) in globalThis) return globalThis[String(k)];
        return undefined;
      },
      set: (t, k, v) => { t[k] = v; return true; },
    })
  );
}

test('CONTROL: with a name key, setCareAvail publishes a sealed event', async () => {
  const { published, scope } = makeScope({ withKey: true });
  const fn = liftSetCareAvail(scope);
  const r = await fn(['childcare'], 'I am a district nurse');
  assert.ok(r && r.ok, 'the publish should succeed');
  assert.equal(published.length, 1, 'one event should have been published');
  const content = published[0].content;
  assert.ok(content.includes('"e":'), 'the content should be sealed (wrapped in an {e:…} envelope), not plain text');
  assert.ok(!content.includes('district nurse'),
    'THE NOTE IS IN PLAIN TEXT — a member\'s personal circumstances sit readable on the relay');
});

test('without a name key, setCareAvail refuses and publishes nothing', async () => {
  const { published, scope } = makeScope({ withKey: false });
  const fn = liftSetCareAvail(scope);
  const r = await fn(['childcare'], 'I am a district nurse');
  assert.equal(published.length, 0,
    'AN EVENT WAS PUBLISHED WITHOUT A NAME KEY — the note sits on the relay in plain text');
  assert.ok(r && !r.ok, 'the result should say it failed');
  assert.equal(r.reason, 'no-key',
    'the reason should be "no-key" so the caller can show the right message');
});
