// EVERY DOCUMENT THE CLIENT BELIEVES IS SEALED MUST ACTUALLY BE SEALED.
// Run: node --test scripts/church-docs-are-sealed.test.mjs
//
// `src/fellowship.src.js` declares CHURCH_SEALED_PFXS — the church documents a member unseals with the church
// name key — and carries the comment "Cross-checked against the publish sites: service / room / booking /
// rota / event / runsheet / roster."
//
// On 2026-08-18 that cross-check was wrong for two of the seven. `publishRoster` and `publishRunsheet` wrote a
// bare `JSON.stringify`, so the relay held, in plain text:
//
//   · every serving team, every role, and all 43 members' real names bound to their pubkeys
//   · the order of service, naming the vicar
//
// Nothing broke, because the reader tries cleartext first and copes. That is exactly why it survived: both
// paths worked, so no screen ever looked wrong. The network side was already closed (a 2026-07-20 audit made
// kind-30078 reads default-deny, and an unauthenticated stranger really does get zero events — measured), so
// the exposure is AT REST: whoever holds the relay's disk. Under the UK-pilot threat model — lawful
// compulsion and seizure — a congregation list and a leadership map are the assets that matter most.
//
// A test naming those two functions would pass for ever after they are fixed and say nothing about the eighth
// document somebody adds next year. So this derives the list from the declaration and checks every publisher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const FEL = stripComments(readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8'));
const STW = stripComments(readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8'));

// 1. the declared contract, read from the client that depends on it
const decl = (FEL.match(/const CHURCH_SEALED_PFXS = \[([\s\S]*?)\];/) || [])[1];
const prefixes = [...(decl || '').matchAll(/'([^']+)'/g)].map(m => m[1]);

test('re-anchor: the sealed-prefix contract is still declared', () => {
  assert.ok(prefixes.length >= 5, 'could not read CHURCH_SEALED_PFXS from fellowship.src.js');
});

// 2. map each prefix to the console constant that writes it, e.g. 'trinityone/runsheet:' -> RUNSHEET_D
const constFor = (pfx) => {
  const re = new RegExp("const (\\w+_D) = (?:D\\.\\w+;\\s*\\/\\/[^\\n]*|'" + pfx.replace(/[/]/g, '\\/') + "')", '');
  const m = STW.match(new RegExp("const (\\w+_D)\\s*=\\s*'" + pfx.replace(/[/]/g, '\\/') + "'"));
  if (m) return m[1];
  // some constants come from the shared registry: `const X_D = D.X;  // …d=<prefix>…`
  const lines = STW.split('\n').filter(l => /const \w+_D = D\.\w+;/.test(l) && l.includes(pfx.replace('trinityone/', '')));
  const m2 = lines.length ? lines[0].match(/const (\w+_D) =/) : null;
  return m2 ? m2[1] : null;
};

// 3. every publisher that writes one of those d-tags must seal its content
// `roster:` is DEFERRED, not forgotten, and is marked todo rather than quietly dropped from the list.
// It cannot simply be sealed: the RELAY parses roster content into ROSTER_PEOPLE (gateway.mjs:1344) and
// careAdmin() (gateway.mjs:846) grants care-team powers from it, so sealing it blinds the gate and breaks
// care. The fix is to move that grant onto the `careteam:` document — which already exists for exactly this,
// and is described in the gateway as "pubkeys only, no secrets… so a member can seal a carereq to exactly
// the care team". Names get sealed; the pubkeys the relay needs stay public. Tracked as Tier 1.
const DEFERRED = new Set(['trinityone/roster:']);

// Prefixes written by the member app rather than the console.
const MEMBER_SIDE = new Set(['trinityone/careavail:']);

for (const pfx of prefixes) {
  const CONST = constFor(pfx);
  test(`${pfx} is published SEALED`, { todo: DEFERRED.has(pfx) ? 'deferred: sealing this blinds the relay\'s careAdmin() grant until it moves to the careteam: doc' : false }, () => {
    // Some of these are written by the MEMBER app rather than the console — careavail: is a member saying
    // "I'm here to help" — and they seal with the member-side helper instead. Same contract, different file;
    // the detail is covered by careavail-is-sealed.test.mjs, so here we only hold the contract itself.
    if (MEMBER_SIDE.has(pfx)) {
      assert.match(FEL, /_sealChurchDocMember\(/,
        `${pfx} is member-authored and must seal with the member-side helper`);
      return;
    }
    assert.ok(CONST, `re-anchor: no console constant found for ${pfx}`);
    // find publish functions whose d-tag is built from this constant
    const uses = [...STW.matchAll(new RegExp("\\[\\s*'d'\\s*,\\s*" + CONST + "\\s*\\+", 'g'))];
    if (!uses.length) return;   // written elsewhere (or member-side); the member-side ones have their own tests
    for (const u of uses) {
      // the statement that builds `content` for this publish call: look back to the enclosing function start
      const at = u.index;
      const head = STW.lastIndexOf('\n  publish', at);
      const body = STW.slice(head === -1 ? Math.max(0, at - 800) : head, at + 200);
      assert.match(body, /_sealChurchDoc\(|encPublish\(/,
        `${pfx} is in CHURCH_SEALED_PFXS but its publisher writes cleartext — a bare JSON.stringify here ` +
        `puts this document on the relay's disk in the clear, readable by anyone who holds it. ` +
        `Route it through _sealChurchDoc(); both readers already try cleartext first, so existing ` +
        `documents keep opening.`);
    }
  });
}
