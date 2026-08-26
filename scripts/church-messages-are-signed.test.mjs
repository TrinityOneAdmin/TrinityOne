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

const FS_V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const ST_V = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('the member app resolves a by-line for the church, not "Member"', () => {
  assert.match(FS_V, /churchVoiceFor/,
    'nothing maps a church key to a human name, so the church still arrives as an unnamed member');
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
  const save = (() => { const i = ST_V.indexOf('_voiceSave'); return i < 0 ? '' : ST_V.slice(i, i + 500); })();
  assert.ok(save, 'no single place saves the by-line, so each setter can drift from the other');
  assert.doesNotMatch(save, /setStewards/,
    'saving a by-line republishes the steward roster — a name change that can remove people');
  assert.match(save, /VOICE_D|voice:/,
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
