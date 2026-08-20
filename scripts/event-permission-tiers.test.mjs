// WHO MAY CREATE AN EVENT IN A GROUP — AND THE TWO SAFEGUARDING RULES THAT OVERRIDE THE ANSWER.
// Run: node --test scripts/event-permission-tiers.test.mjs
//
// A church can now choose, per group, who may add an event: its stewards only, the leaders it names, or
// anyone in the group. The relay enforces the choice — a client is not the boundary.
//
// THE SAFEGUARDING GAP THIS CLOSES. Before this, the EVENT_D branch of accept() asked exactly one question:
// do you have authority over this group? It never asked whether the author was a CHILD, and never asked
// whether the group was one children READ — even though the chat path has asked both since AUDIT-2026-07-30.
// That was invisible while only stewards could write events. Opening event-creation to members is what makes
// it reachable, so the checks land in the same change as the setting, not after it:
//
//   1. A minor never publishes an event, a pin or a hide — not even in a child-safe room.
//   2. Into a CHILD-SAFE group, a delegated member must be on the church's cleared-adults list (its DBS /
//      vetting list). Otherwise "Youth meetup, Saturday 2pm, my house" is publishable into a children's room
//      by any member the church empowered for ordinary purposes. The church and its own stewards pass above
//      this line: the rule constrains who a church may DELEGATE that reach to, which is what vetting is for.
//
// Both lists are church-key-only and cannot be edited by a delegated steward (MINORS_D / APPROVED_D), so the
// authority to decide who is a child, and who is cleared, stays with the church itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const GW   = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const FEL  = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const BUNDLE_F = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const BUNDLE_S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// The EVENT_D / PIN_D / HIDE_D branch of the relay's accept().
function eventBranch() {
  const at = GW.indexOf('if (d.startsWith(EVENT_D) || d.startsWith(PIN_D) || d.startsWith(HIDE_D))');
  assert.notEqual(at, -1, 'the event authority branch is gone — re-anchor this test');
  return stripComments(GW.slice(at, GW.indexOf('\n    }', at)));
}

test('a minor may never publish an event, a pin or a hide', () => {
  const b = eventBranch();
  assert.match(b, /if \(minorOf\(e\.pubkey, owner\)\) return false;/,
    'the chat path refuses a child’s MESSAGE in an adults-only room; an event carries a time and a PLACE and ' +
    'lands on everyone’s calendar, so it is refused everywhere — including in a child-safe room');
  // …and scoped to the group's OWNING church, never the relay-wide union: whether someone is a child is a
  // judgement only their own church makes, and a co-tenant's marking must not silence them here.
  assert.doesNotMatch(b, /MINORS\.has|MINORS\b(?!_)/,
    'use minorOf(pub, owner) — the relay-wide MINORS union silenced adults across congregations once already');
});

test('a child-safe group takes events only from cleared adults', () => {
  const b = eventBranch();
  assert.match(b, /if \(GROUP_CHILDSAFE\.has\(g\) && !approvedIn\(e\.pubkey, owner\)\) return false;/,
    'a child-safe group is one children actually read — a delegated member posting into it must be on the ' +
    'church’s cleared-adults list');
  // Order matters: both safeguarding checks must sit ABOVE the tier logic, or 'everyone' bypasses them.
  const safeguardAt = b.indexOf('GROUP_CHILDSAFE.has(g)');
  const policyAt = b.indexOf('GROUP_EVENTPOLICY.get(g)');
  assert.ok(safeguardAt !== -1 && policyAt !== -1 && safeguardAt < policyAt,
    'the safeguarding checks must come BEFORE the church’s chosen tier, or setting a group to "everyone" ' +
    'walks straight past them');
});

test('the church key and its stewards are unaffected', () => {
  const b = eventBranch();
  // stewardCan(…, 'content') since capabilities landed — the assertion is about ORDER, not the call's name.
  const churchAt = b.indexOf("e.pubkey === owner || networkOf(e.pubkey, owner) || stewardCan(e.pubkey, owner, 'content')");
  const minorAt = b.indexOf('minorOf(e.pubkey, owner)');
  assert.ok(churchAt !== -1 && churchAt < minorAt,
    'the church acting as itself passes first — these rules constrain DELEGATION, and a church that cannot ' +
    'post to its own youth group has been broken, not protected');
});

test('the three tiers are enforced, and the default is the historical behaviour', () => {
  const b = eventBranch();
  assert.match(b, /GROUP_EVENTPOLICY\.get\(g\) \|\| 'leaders'/,
    'absent must mean "leaders" — that is exactly what this relay did before the setting existed, so no ' +
    'existing church has its behaviour changed by upgrading');
  assert.match(b, /if \(policy === 'stewards'\) return false;/, 'stewards-only must actually lock the group');
  assert.match(b, /if \(policy !== 'everyone'\) return false;/, 'anything past leaders requires the open tier');
  assert.match(b, /churchWriter\(e\.pubkey, owner\)/,
    '"everyone" means every member OF THE OWNING CHURCH — asking it unscoped is the co-tenant hole ' +
    'AUDIT-2026-07-30 S1 had to close for chat');
  assert.match(b, /if \(BROADCAST\.has\(g\)\) return false;/,
    'a broadcast channel is the church’s own voice — "everyone" must not turn it into an open megaphone');
});

test('pins and hides stay on the leaders rule, whatever the church chose about events', () => {
  const b = eventBranch();
  assert.match(b, /if \(!d\.startsWith\(EVENT_D\)\) return isLeaderHere;/,
    'moderation is not event creation: turning events down to "stewards" must not silently strip a group’s ' +
    'moderator of the ability to pin a notice or remove an abusive message');
});

test('an unknown eventPolicy value falls back rather than being trusted', () => {
  const ingest = stripComments(GW.slice(GW.indexOf("const p = String(c.eventPolicy || '');")));
  assert.match(ingest.slice(0, 400), /p === 'stewards' \|\| p === 'leaders' \|\| p === 'everyone'/,
    'only the three known values are honoured — a typo or a forged value must not widen anything');
  assert.match(ingest.slice(0, 400), /else GROUP_EVENTPOLICY\.delete\(id\)/,
    'and an unrecognised value must CLEAR the stored one, not leave the previous choice in place');
});

test('the setting survives a rehydrate, and so does child-safety', () => {
  const clear = stripComments(fnBody(GW, 'function clearDerivedMaps()'));
  assert.match(clear, /GROUP_EVENTPOLICY/, 'a derived map left uncleared keeps a stale tier for a culled group');
  assert.match(clear, /GROUP_CHILDSAFE/,
    'GROUP_CHILDSAFE was missing here: a group culled from the corpus kept a stale child-safe marking, and ' +
    'that one fails OPEN — it is the flag that lets minors read a room');
});

test('the client shows exactly what the relay accepts', () => {
  // If the client is STRICTER the relay stores an event every member’s app then hides: published, kept,
  // invisible, no error anywhere. That is the silent-blank failure this codebase treats as its worst.
  const t = stripComments(fnBody(FEL, 'function _groupEventTrusted(cp, gid, by) {'));
  assert.match(t, /_groupPolicy\.get\(gid\) \|\| 'leaders'/, 'same default as the relay');
  assert.match(t, /if \(policy === 'stewards'\) return false;/, 'same lock');
  assert.match(t, /return policy === 'everyone';/, 'same open tier');

  const can = stripComments(fnBody(FEL, 'canAddGroupEvent(churchNpub, group) {'));
  assert.match(can, /toLowerCase\(\) === 'broadcast'/, 'the button must not be offered where a broadcast will refuse it');
  assert.match(can, /'stewards', 'leaders', 'everyone'/, 'and it reads the same three tiers');
});

test('the policy is only believed from a TRUSTED group definition', () => {
  const note = stripComments(fnBody(FEL, 'function _noteGroupLeaders(cp, id, content, author) {'));
  assert.match(note, /if \(author !== cp && !\(_churchRoster\.get\(cp\) && _churchRoster\.get\(cp\)\.has\(author\)\)\) return;/,
    'the tier is read from the same guarded ingestion as the leaders list — a forged group doc must not be ' +
    'able to widen who may post');
  assert.match(note, /_groupPolicy\.set\(id, p\)/, 'and it must actually be recorded');
});

test('the console can set it, and cannot drop it by accident', () => {
  const pub = stripComments(fnBody(STEW, 'publishGroup(group) {'));
  assert.match(pub, /eventPolicy:/,
    'publishGroup rebuilds the group document from scratch, so a field missing here is a field DELETED on the ' +
    'next unrelated edit — which is how setGroupLeaders would have silently reset this setting');
  const setp = stripComments(fnBody(STEW, 'setGroupEventPolicy(group, policy) {'));
  assert.match(setp, /EVENT_POLICIES\.includes\(policy\)/, 'refuse an unknown tier at the source too');
});

test('both shipped bundles carry it', () => {
  assert.match(BUNDLE_F, /canAddGroupEvent/, 'rebuild: bash scripts/build-fellowship.sh');
  assert.match(BUNDLE_S, /setGroupEventPolicy/, 'rebuild: bash scripts/build-steward.sh');
});

test('the chat screen carries the permission fields through its group re-map', () => {
  // MEASURED. screens-chat builds its group list as a NEW object from an explicit field list — anything not
  // named is dropped — and deliberately turns `members` into a COUNT for the "· 12 members" line. So the
  // object ChatRoom receives had no eventPolicy, no leaders and no allowlist, and canAddGroupEvent answered
  // false for a member the church had just empowered. The button never appeared; the console's own message
  // told them to go and tap it. Exactly the shape of publishGroup rebuilding a document from scratch.
  const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
  const at = CHAT.indexOf('const churchGroups = React.useMemo(');
  assert.notEqual(at, -1, 're-anchor: the group re-map has moved');
  const map = stripComments(CHAT.slice(at, at + 2600));   // widened 2000→2600: the openToChurch honesty fix added lines to this memo (2026-08-18)
  for (const f of ['eventPolicy:', 'leaders:', 'memberPubs:']) {
    assert.ok(map.includes(f),
      `the re-map drops \`${f}\` — the chat room then cannot tell whether this member may add an event, and ` +
      'silently offers no button rather than failing visibly');
  }

  // …and the helper must cope with what that map produces: a re-cased kind and a numeric `members`.
  const can = stripComments(fnBody(FEL, 'canAddGroupEvent(churchNpub, group) {'));
  assert.match(can, /toLowerCase\(\) === 'broadcast'/,
    'the map re-cases kind to "Broadcast" — a case-sensitive check would fail OPEN on the church’s own channel');
  assert.match(can, /Array\.isArray\(group\.memberPubs\)/,
    'and `members` is a NUMBER there — a number must never read as "no allowlist, let them in"');
});
