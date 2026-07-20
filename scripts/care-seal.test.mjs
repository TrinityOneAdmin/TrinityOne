// Care-need sealing — SECURITY-AUDIT-2026-07-20 H3. Run: node --test scripts/care-seal.test.mjs
//
// The FIRST attempt at this shipped a mirror test: it re-implemented seal/open locally and never touched a
// shipped function, so deleting the field-stripping line from the real code left every assertion passing.
// This file loads the actual built bundles (vendor/steward-meals.js and vendor/steward.js are what ships)
// and drives publishNeed/openNeed through them, so it fails if the shipped behaviour changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';

const ROOT = new URL('..', import.meta.url).pathname;
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const memberSk = generateSecretKey(), memberPub = getPublicKey(memberSk);
const strangerSk = generateSecretKey();

const SENSITIVE = { displayLabel: 'The Okonkwo family', notes: 'Chemo Tuesdays — 14 Elm St, side door. Don’t ring after 9pm.', recipient: memberPub, dietary: ['coeliac'] };

// Load the SHIPPED bundle with a minimal browser shim, and capture what it publishes.
function loadMeals() {
  const careKeyHex = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const published = [];
  const sandbox = {
    crypto: webcrypto,
    TextEncoder,
    console,
    window: {
      Steward: {
        publishSigned: async (tmpl) => { published.push(tmpl); return finalizeEvent(tmpl, churchSk); },
        careSeal: (obj) => { try { return nip44.encrypt(JSON.stringify(obj), unhex(careKeyHex)); } catch { return null; } },
        careOpen: (ct) => { try { return JSON.parse(nip44.decrypt(ct, unhex(careKeyHex))); } catch { return null; } },
        careSealTo: (to, obj) => nip44.encrypt(JSON.stringify(obj), nip44.utils.getConversationKey(churchSk, to)),
        careKeyChecked: () => true,
        churchPub,
      },
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;
  const src = readFileSync(ROOT + 'vendor/steward-meals.js', 'utf8');
  const fn = new Function('window', 'crypto', 'console', 'TextEncoder', src + '\n;return window.StewardMeals;');
  const api = fn(sandbox.window, webcrypto, console, TextEncoder);
  return { api, published, careKeyHex };
}

test('the shipped publishNeed does not put the identifying half on the wire', async () => {
  const { api, published } = loadMeals();
  await api.publishNeed({ id: 'c1', type: 'meals', dates: ['2026-08-01', '2026-08-03'], meals: ['dinner'], ...SENSITIVE });
  assert.equal(published.length, 1);
  const wire = JSON.stringify(published[0]);
  for (const leak of ['Okonkwo', 'Elm St', 'Chemo', 'coeliac', memberPub]) {
    assert.equal(wire.includes(leak), false, `"${leak}" is on the wire — the seal is not covering it`);
  }
  const body = JSON.parse(published[0].content);
  assert.equal('displayLabel' in body, false, 'displayLabel shipped alongside the sealed copy');
  assert.equal('notes' in body, false);
  assert.equal('recipient' in body, false);
  assert.equal(typeof body.enc, 'string');
});

test('the clear half stays clear, so the slot grid renders without the key', async () => {
  const { api, published } = loadMeals();
  await api.publishNeed({ id: 'c2', type: 'meals', dates: ['2026-08-01', '2026-08-03'], meals: ['dinner'], ...SENSITIVE });
  const body = JSON.parse(published[0].content);
  assert.equal(body.type, 'meals');
  assert.deepEqual(body.dates, ['2026-08-01', '2026-08-03']);
  assert.equal(body.startDate, '2026-08-01');   // sorting + the live/past filter depend on these
  assert.equal(body.endDate, '2026-08-03');
});

test('openNeed round-trips a sealed need for someone holding the key', async () => {
  const { api, published } = loadMeals();
  await api.publishNeed({ id: 'c3', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE });
  const opened = api.openNeed(JSON.parse(published[0].content));
  assert.equal(opened.displayLabel, SENSITIVE.displayLabel);
  assert.equal(opened.notes, SENSITIVE.notes);
  assert.equal(opened.recipient, memberPub);
  assert.equal(opened._sealed, undefined);
});

test('a v1 cleartext need still reads — a church mid-pilot keeps its open needs', () => {
  const { api } = loadMeals();
  const v1 = { type: 'meals', dates: ['2026-08-01'], ...SENSITIVE };   // pre-2026-07-20 shape, no `enc`
  const out = api.openNeed(v1);
  assert.equal(out.displayLabel, 'The Okonkwo family');
  assert.equal(out._sealed, undefined);
});

test('without the key a need is marked _sealed, not silently blank', () => {
  const { api, published } = loadMeals();
  return api.publishNeed({ id: 'c4', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE }).then(() => {
    const other = loadMeals();                                   // a different device, a different key
    const out = other.api.openNeed(JSON.parse(published[0].content));
    assert.equal(out._sealed, true, 'a need we cannot open must be flagged so the UI says "details hidden"');
    assert.equal(out.displayLabel, undefined);
    assert.equal(out.type, 'meals', 'the clear half must still be readable without the key');
  });
});

test('the skip token proves the recipient WITHOUT naming them to the relay', async () => {
  const { api, published } = loadMeals();
  await api.publishNeed({ id: 'c5', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE });
  const evt = published[0];
  const body = JSON.parse(evt.content);
  const skiphash = (evt.tags.find(t => t[0] === 'skiphash') || [])[1];
  assert.ok(skiphash, 'the need must carry an opaque skip-token hash for the relay to check');
  assert.equal(/^[0-9a-f]{64}$/.test(skiphash), true);
  // the hash must not be derivable from the recipient's identity — otherwise the relay brute-forces it
  assert.notEqual(skiphash, createHash('sha256').update(memberPub).digest('hex'));

  // only the recipient can recover the token
  const tok = JSON.parse(nip44.decrypt(body.skipEnc, nip44.utils.getConversationKey(memberSk, churchPub))).tok;
  assert.equal(createHash('sha256').update(tok).digest('hex'), skiphash, 'the relay could not verify a genuine skip');
  assert.throws(() => nip44.decrypt(body.skipEnc, nip44.utils.getConversationKey(strangerSk, churchPub)),
    'someone who is not the recipient could read the skip token');
});

test('publishNeed REFUSES rather than publishing PII in the clear when there is no key', async () => {
  const { api } = loadMeals();
  api.__noKey = true;
  // rebuild a Steward stub whose careSeal returns null (no key on this device)
  const src = readFileSync(ROOT + 'vendor/steward-meals.js', 'utf8');
  const published = [];
  const win = { Steward: { publishSigned: async (t) => { published.push(t); return finalizeEvent(t, churchSk); },
    careSeal: () => null, careOpen: () => null, careSealTo: () => null, careKeyChecked: () => true, churchPub } };
  win.window = win;
  const api2 = new Function('window', 'crypto', 'console', 'TextEncoder', src + '\n;return window.StewardMeals;')(win, webcrypto, console, TextEncoder);
  await assert.rejects(() => api2.publishNeed({ id: 'c6', type: 'meals', dates: ['2026-08-01'], ...SENSITIVE }),
    /care key/i, 'it must refuse, not fall back to cleartext');
  assert.equal(published.length, 0, 'nothing may be published when the identifying half cannot be sealed');
});
