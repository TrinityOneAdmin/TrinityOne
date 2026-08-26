// A CHURCH'S OWN NOTICES MUST NOT BE SIGNED "MEMBER".
// Run: node --test scripts/church-messages-are-signed.test.mjs
//
// SIMULATION ROUND 6. Rev Ada wrote a welcome letter to her whole congregation and it arrived attributed to
// "Member", with her name appearing only inside the text she had typed. Grace, who read it, called a
// noticeboard "where the vicar's letter is signed by nobody" the thing that cost her trust. Luke went looking
// for whoever ran the music and reported "nobody is labelled leader or steward". Six testers hunted for the
// vicar in the member directory and found twenty names without her.
//
// The directory absence is DELIBERATE — a steward console is not a member account, and the owner has ruled
// that a steward who wants to be listed should make an ordinary account like anyone else. What was never
// deliberate is that the church could speak to its congregation and arrive as nobody.
//
// THE DESIGN, decided 2026-08-26: a message from the console reads like a parish letter — the church's name
// on the letterhead, a person's name at the bottom. Nobody chooses it per message, so nobody can forget it;
// the console always speaks for the church, and personal notes come from your own member account instead.
//
// WHY THE NAMES RIDE THE STEWARD ROSTER: it is signed by the church key and only the church key
// (_absorbRoster refuses any other author), so a forged by-line is impossible, and the relay passes unknown
// fields through untouched — an older church's roster simply carries no names and falls back to the church's
// own name rather than to "Member".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const FS_V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const ST_V = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('the church actually resolves to its own name and signer, not to "Member"', () => {
  // GREPPING FOR THE FUNCTION NAME PROVED NOTHING. An audit beat the first version of this test by replacing
  // the whole body with `return null` — the name survived, every assertion passed, and the vicar's letter was
  // signed "Member" again. So call it, with a church-signed voice document in place, and check the answer.
  const src = fnBody(FS_V, 'function churchVoiceFor', 'churchVoiceFor');
  const CP = 'c'.repeat(64), STEW = 's'.repeat(64);
  const voices = new Map([[CP, { self: { name: 'Rev Ada', office: 'Vicar' }, public: { [STEW]: { name: 'Tom', office: 'Treasurer' } } }]]);
  const scope = { _churchVoices: voices };
  // CLAIM APP IDENTIFIERS ONLY. `has: () => true` traps EVERY name the function mentions, globals included, so
  // the lifted code could not reach String/JSON/Object and died with "needs a stub for String". Claim a name
  // only when we are stubbing it or it is not a real global — that keeps the useful part (an unstubbed app
  // dependency fails loudly instead of silently reading undefined) without breaking the language.
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); } });
  // eslint-disable-next-line no-new-func
  const fn = new Function('scope', `with (scope) { ${src}; return churchVoiceFor; }`)(proxy);

  const church = fn(CP);
  assert.ok(church && church.isChurch, 'the church key is not recognised as the church');
  assert.equal(church.name, 'Rev Ada', 'the church key resolves to no signer — its notices arrive unsigned');
  assert.equal(church.office, 'Vicar', 'the signer has no role beside their name');

  const named = fn(STEW);
  assert.ok(named && !named.isChurch, 'a named steward is mistaken for the church itself');
  assert.equal(named.name, 'Tom', 'a steward the church chose to name publicly arrives unnamed');

  assert.equal(fn('m'.repeat(64)), null,
    'an ordinary member gets a church by-line — anyone could appear to speak for the church');
});

test('the by-line is trusted only from the church key', () => {
  // The roster ingest already refuses any other author. If a by-line could ride an untrusted document, any
  // member could sign a notice as the vicar — which is worse than no name at all.
  const absorb = (() => { const i = FS_V.indexOf('_absorbRoster'); const j = FS_V.indexOf('_fireTrust()', i); return i < 0 ? '' : FS_V.slice(i, j); })();
  assert.ok(absorb, '_absorbRoster not found in the shipped bundle');
  assert.match(absorb, /e\.pubkey !== cp/,
    'the roster carrying the by-line is absorbed without checking the church signed it');
});

test('the console can publish who signs its messages', () => {
  assert.match(ST_V, /setVoice/, 'the console cannot record whose name goes under its messages');
  assert.match(ST_V, /setPublicVoice/, 'a delegated steward can never be named to members');
});

test('saving a name cannot touch the steward roster at all', () => {
  // THE HAZARD THIS DESIGN REMOVES RATHER THAN GUARDS. For one afternoon the by-line rode the steward roster,
  // so saving a name republished it — and a console that had not truly read that roster would have written an
  // EMPTY one over a real one, stripping every delegated steward of their authority while the panel said
  // "Saved". The authentication check cannot prevent that: it records that we SIGNED the challenge, not that
  // the relay ACCEPTED it. So the by-line now lives in its own document. A name is cosmetic, a roster is
  // authority, and one must never be able to damage the other.
  // CHECK EVERY SETTER, NOT A WINDOW. The first version took 500 characters from `_voiceSave`, which covered
  // that function and the head of `setVoice` — and stopped short of `setPublicVoice`. An audit put
  // `this.setStewards([])` into setPublicVoice, re-arming the exact "a name change publishes an empty roster"
  // hazard, and all five tests stayed green. A window is not a boundary; bound each function and check them all.
  for (const name of ['_voiceSave', 'setVoice', 'setPublicVoice']) {
    const body = fnBody(ST_V, name + '(', name);
    assert.doesNotMatch(body, /setStewards/,
      name + ' republishes the steward roster — a name change that can strip people of their authority');
  }
  assert.match(fnBody(ST_V, '_voiceSave(', '_voiceSave'), /VOICE_D|voice:/,
    'the by-line is not written to its own document');
});

test('the owner\'s private labels for stewards are not published to the congregation', () => {
  // `names` is what an owner types to tell their stewards apart. Publishing those to members would disclose
  // something nobody consented to. The public by-line is a separate, opt-in field in a separate document.
  const setr = (() => { const i = ST_V.indexOf('setStewards'); return i < 0 ? '' : ST_V.slice(i, i + 1800); })();
  assert.match(setr, /doc\.names\s*=/, 'the private labels have stopped being carried forward');
  assert.doesNotMatch(setr, /doc\.public\s*=/,
    'the roster is publishing member-visible names again — that belongs in the voice document');
});

test('one church\'s by-line cannot follow a console to another church', () => {
  // A console that changes which church it runs used to read its by-line from a single GLOBAL key, so church
  // A's vicar sat pre-filled in church B's Save box — and saving would have signed B's notices with A's
  // incumbent. Under the pilot's threat model that is also a disclosure: it names a person to a congregation
  // that never asked about them. The key now carries the church, so a church that has set no by-line reads
  // empty rather than inheriting somebody else's.
  const load = fnBody(ST_V, 'function _loadVoice', '_loadVoice');
  assert.doesNotMatch(load, /['"]trinityone\.steward\.voice['"]/,
    'the by-line is read from a single global key — it will follow this console to the next church');
  assert.match(load, /_voiceKey\(\)/, 'the by-line is not read from a church-scoped key');
  assert.match(ST_V, /_voiceKey[\s\S]{0,120}\+\s*\(pub/,
    'the by-line key does not include which church this console is running');
});
