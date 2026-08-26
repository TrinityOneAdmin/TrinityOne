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

test('changing a name never rewrites who is on the roster', () => {
  // The dangerous half. The by-line lives in the steward roster, so saving it republishes that roster — and a
  // republish built from the wrong source would silently REMOVE stewards. Publishing before the relay has
  // been heard from would write an empty roster over a real one.
  const save = (() => { const i = ST_V.indexOf('_voiceSave'); return i < 0 ? '' : ST_V.slice(i, i + 400); })();
  assert.ok(save, 'no single place saves the by-line, so each setter can drift from the other');
  assert.match(save, /_careRosterKnown/,
    'the by-line can be published before the roster has been read — writing an empty roster over a real one');
  assert.match(save, /_careRoster/,
    'the republished roster is rebuilt from somewhere other than the roster itself');
});

test('the owner\'s private labels for stewards are not published to the congregation', () => {
  // `names` is what the owner types to tell stewards apart. Publishing those to members would disclose
  // something nobody consented to; `public` is the opt-in the owner ticks per steward.
  const setr = (() => { const i = ST_V.indexOf('setStewards'); return i < 0 ? '' : ST_V.slice(i, i + 1800); })();
  assert.match(setr, /doc\.public\s*=/, 'there is no separate opt-in field for names members may see');
  assert.match(setr, /doc\.names\s*=/, 'the private labels have stopped being carried forward');
});
