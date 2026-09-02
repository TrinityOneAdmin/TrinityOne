// Joining a SELF-HOSTED church must not announce itself to the central host — and an invite must not get to
// pick who answers its own question.
// Run: node --test scripts/join-resolver.test.mjs
//
// AUDIT-2026-07-29 S3. When an invite carries ?relayname=, the app resolves that name to the relay's current
// URL — because a self-hosted relay behind a free tunnel gets a new URL each restart, so a printed slip's
// ?relay= goes stale and the stable name is the only recovery. Sound reasoning.
//
// It resolved it against `https://app.trinityone.church`, hardcoded, and nothing else. So a member of a
// SELF-HOSTED congregation, joining from a printed slip, made their device tell the central host: this IP
// exists, it is joining now, and it is looking for this relay name. That is the one request that undoes
// self-hosting, at the single most sensitive moment there is.
//
// THE FIX CHANGED SHAPE AT C5, and this file is the record of both halves.
//   * The first fix asked the invite's OWN host first, on the argument that ?relay= was added unverified two
//     lines above so preferring it as a resolver "granted it nothing it did not already have".
//   * C4 inverted that argument: an address nobody proved is now trusted with nothing. An invite that
//     carries both the question AND the machine that answers it is a redirect, not a hint, so that step is
//     gone (closed-network plan C5).
//   * S3 is closed a different way instead: the name is resolved ONLY when the printed address did not work
//     out, so in the case S3 is actually about — the church's own box up at the address on the slip — no
//     directory is asked anything at all. That claim needs real relays and lives in
//     scripts/an-invite-cannot-choose-your-relay.test.mjs; what is left here is WHICH HOSTS get asked, which
//     needs none.
//
// The resolver also MOVED, from app/app.jsx into the bundle, and that is not cosmetic: app/*.jsx ships
// unbundled, so `false && ` in front of a condition leaves every word of it in place and a text-matching
// assertion still passes (CLAUDE.md rule 3). This file lifts the shipped bundle and runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// The shipped parser + resolver out of vendor/fellowship.js, with a fetch that records every host it is
// pointed at. `isNetworkRelay` is stubbed to refuse: what is under test here is WHICH HOSTS ARE ASKED, and
// admission itself is driven against four real gateways in an-invite-cannot-choose-your-relay.test.mjs.
function loadResolver({ answers = {}, admit = false } = {}) {
  const asked = [], added = [], refused = [];
  const win = { Fellowship: { relays: [], churchPub: '' }, dispatchEvent: () => true };
  const scope = {
    window: win,
    CANONICAL_RELAYS: ['wss://app.trinityone.church/relay', 'wss://second.example/relay'],
    console,
    toPub: (x) => String(x || ''),
    isNetworkRelay: async (cp, url) => { (admit ? added : refused).push(url); return !!admit; },
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = (i || {}).detail; } },
    AbortController, setTimeout, clearTimeout, Promise, String, decodeURIComponent, encodeURIComponent,
    fetch: async (u) => {
      asked.push(String(u));
      const hit = Object.keys(answers).find(k => String(u).includes(k));
      if (!hit) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ handle: 'x', url: answers[hit] }) };
    },
  };
  const src = FELLOW;
  const adopt = fnBody(src, 'async adoptInviteRelays(npubOrHex, raw) {', 'adoptInviteRelays');
  const resolve = fnBody(src, 'async resolveRelayName(name) {', 'resolveRelayName');
  const api = new Function('scope', `with (scope) {
    const _api = { ${adopt}, ${resolve} };
    window.Fellowship.setRelays = (u) => { window.Fellowship.relays = u; return u; };
    window.Fellowship.resolveRelayName = (n) => _api.resolveRelayName(n);
    return { adopt: (cp, raw) => _api.adoptInviteRelays(cp, raw), resolve: (n) => _api.resolveRelayName(n) }; }`)(scope);
  return { ...api, asked, added, refused };
}

test('CONTROL: the resolver asks somebody', async () => {
  const r = loadResolver({ answers: { 'app.trinityone.church': 'wss://central.example/relay' } });
  await r.adopt('cp', '?relayname=stbrides');
  assert.ok(r.asked.length > 0, 'the resolver asked nobody at all — every assertion below would be vacuous');
  assert.ok(r.asked.some(u => u.includes('/relay-names/resolve/stbrides')),
    'nothing resolved the name: ' + JSON.stringify(r.asked));
});

test('the host carried in the invite is never asked to resolve the invite’s own relay name', async () => {
  // The finding this replaces the old ordering with. `?relay=` names a host; `?relayname=` names the
  // question. Letting the first answer the second means a code taped to a wall chooses both, and the
  // "no new trust" argument that allowed it died with C4.
  const r = loadResolver({ answers: { 'stmarys.example': 'wss://stmarys.example/relay' } });
  await r.adopt('cp', '?relayname=stmarys&relay=wss%3A%2F%2Fstmarys.example%2Frelay');
  assert.deepEqual(r.asked.filter(u => u.startsWith('https://stmarys.example/') && u.includes('/relay-names/')), [],
    'the invite’s own host was asked to resolve the invite’s own name: ' + JSON.stringify(r.asked));
  assert.ok(r.asked.some(u => u.includes('app.trinityone.church')),
    'nothing asked the shared directory either, so the name path resolves nowhere at all: ' + JSON.stringify(r.asked));
});

test('a resolved URL must still be wss://', async () => {
  // L5. A crafted invite must not talk the app into a cleartext relay by way of the directory — a ws://
  // socket puts a whole congregation's fellowship traffic in front of any network in the path.
  const r = loadResolver({ answers: { 'app.trinityone.church': 'ws://insecure.example/relay' } });
  await r.adopt('cp', '?relayname=x&relay=wss%3A%2F%2Fevil.example%2Frelay');
  assert.equal(r.refused.includes('ws://insecure.example/relay'), false,
    'a ws:// (cleartext) relay from the directory was carried as far as the membership gate — it must be dropped ' +
    'by the scheme check first, so no version of the gate can ever admit one');
  assert.equal(await r.resolve('x'), null, 'resolveRelayName handed back a cleartext address');
});
