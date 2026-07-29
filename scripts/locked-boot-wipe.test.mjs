// A locked boot must actually wipe the community caches, and wipe the ones that matter.
// Run: node --test scripts/locked-boot-wipe.test.mjs
//
// AUDIT-2026-07-28 F7 + F8. Two defects that compound, and the audit was right that they only mean anything
// together: the wipe did not run on a locked boot, and would not have been sufficient if it had.
//
// F7 — the effect had an EMPTY dependency list, so it read the FIRST-RENDER value of commLocked. The effect
// immediately above it exists precisely because that sample is unreliable ("the one that catches a module
// that finished loading after we first looked, which is exactly the case that shipped the app open with no
// identity") and re-checks for eight seconds. The lock GATE was fixed that way; the wipe beside it was not.
// Confirmed on a real device, Pixel 10 Pro, 2026-07-29, sitting at the PIN screen after a cold boot:
//
//     locked: true, canSign: false
//     keys the wipe TARGETS, still present: 4      (memhub / members / membercount / docshub, church-keyed)
//     keys naming the church, not even targeted: 22
//
// F8 — `trinityone.serv.*` (events, rotas, rosters, RSVPs) and `trinityone.care.*` (needs, slots, skips —
// pastoral, sometimes medical) were never in the list, each carrying the church npub in the key NAME, while
// the function's own comment claimed it wiped "every localStorage cache that would reveal church membership".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const F = readFileSync(ROOT + 'vendor/fellowship.js', 'utf8');
const APP = readFileSync(ROOT + 'app/app.jsx', 'utf8');

// Run the SHIPPED clearCommunityCache against a localStorage holding exactly what the device had.
function runWipe(keys) {
  const at = F.indexOf('clearCommunityCache() {');
  assert.notEqual(at, -1, 'clearCommunityCache is gone from the shipped bundle');
  let depth = 0, end = -1;
  for (let i = F.indexOf('{', at); i < F.length; i++) {
    if (F[i] === '{') depth++; else if (F[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const body = F.slice(at, end);
  const store = new Map(keys.map(k => [k, 'x']));
  const scope = {
    localStorage: {
      get length() { return store.size; },
      key: (i) => [...store.keys()][i],
      removeItem: (k) => store.delete(k),
      getItem: (k) => store.get(k) ?? null,
    },
    profiles: { a: 1 },
    _k0Seen: new Set(['a']),
    window: { Fellowship: { myProfile: { name: 'x' } } },
    console: { warn() {} },
    Object, Set,
  };
  const args = Object.keys(scope);
  new Function(...args, `({ ${body} }).clearCommunityCache();`)(...args.map(k => scope[k]));
  return [...store.keys()];
}

// Exactly the keys read off the locked Pixel.
const CHURCH = '41bbaebf3d474b722b6195b48304dd3308e733221ce0341b339d93770f9e9a27';
const NPUB = 'npub1gxa6a0eaga9hy2mpjk6gxpxaxvywwvezrnsrgxennkfhwru7ngnsevqeyr';
const MEMBER = '314effe0c2f8bf132ca62cc73cb4c759d20bb35f398f83b20dc17f828bf6ac77';
// Read off the locked Pixel on 2026-07-29 — not invented. Eleven of these named the congregation and no
// version of the prefix list covered them; that is the finding.
const DEVICE_KEYS = [
  'trinityone.memhub.' + CHURCH, 'trinityone.members.' + CHURCH,
  'trinityone.membercount.' + CHURCH, 'trinityone.docshub.' + CHURCH,
  'trinityone.serv.reqs.' + NPUB, 'trinityone.serv.events.' + NPUB, 'trinityone.serv.rosters.' + NPUB,
  'trinityone.serv.rotas.' + NPUB, 'trinityone.serv.rsvps.' + NPUB, 'trinityone.serv.runsheets.' + NPUB,
  'trinityone.care.n.' + NPUB, 'trinityone.care.s.' + NPUB,
  // the eleven the prefix list never knew about
  'trinityone.admitted.' + CHURCH + '|' + MEMBER, 'trinityone.approvedToast.' + NPUB,
  'trinityone.categories.' + CHURCH, 'trinityone.chatTabSeen.' + NPUB,
  'trinityone.devos.' + CHURCH, 'trinityone.devos.' + NPUB, 'trinityone.hb:' + NPUB,
  'trinityone.joinstate.' + NPUB, 'trinityone.msgtags.' + NPUB, 'trinityone.plans.' + CHURCH,
  // must SURVIVE
  'trinityone.followedChurches', 'trinityone.activeChurch',
  'trinityone.outbox', 'trinityone.mydata:data/journal', 'trinityone.mydata:data/notes',
  'trinityone.readerScale', 'trinityone.settings', 'trinityone.nostr.mnemonic.enc',
  'trinityone.backedup.' + NPUB,   // names the MEMBER, not the church — see the test below
  'trinityone.bible.translation', 'trinityone.reading.position',
];

test('the caches the device was still holding are wiped', () => {
  const left = runWipe(DEVICE_KEYS);
  // backedup.<own npub> is a deliberate keep — see its own test below.
  const churchKeyed = left.filter(k => (k.includes(CHURCH) || k.includes(NPUB)) && !k.startsWith('trinityone.backedup.'));
  assert.deepEqual(churchKeyed, [],
    'these still name the congregation on a locked phone: ' + churchKeyed.join(', '));
});

test('the serving and care caches go too', () => {
  // F8. Pastoral and sometimes medical, and every key carries the church npub. All re-fetch after unlock.
  const left = runWipe(DEVICE_KEYS);
  assert.deepEqual(left.filter(k => k.startsWith('trinityone.serv.')), [], 'serving/rota caches survive a lock');
  assert.deepEqual(left.filter(k => k.startsWith('trinityone.care.')), [], 'care needs and slots survive a lock');
});

test('the Bible, the member’s own writing and their unsent messages all survive', () => {
  // Over-wiping is the other way to get this wrong. The lock screen's whole purpose is that the app remains
  // a Bible reader; the journal and notes are the MEMBER's, not the church's; and the outbox holds messages
  // they wrote that have not been delivered — losing those is data loss dressed up as hygiene.
  const left = runWipe(DEVICE_KEYS);
  for (const k of ['trinityone.bible.translation', 'trinityone.reading.position', 'trinityone.readerScale',
    'trinityone.settings', 'trinityone.nostr.mnemonic.enc', 'trinityone.outbox',
    'trinityone.mydata:data/journal', 'trinityone.mydata:data/notes']) {
    assert.ok(left.includes(k), 'the wipe destroyed ' + k);
  }
});

test('no key naming the congregation survives, including ones nobody listed', () => {
  // The property, not the list. Eleven caches on the real device carried the church or the member in the key
  // NAME and no version of the prefix list covered them, because every new feature added one and nobody went
  // back. This is the same failure as the relay's served-file denylist.
  const left = runWipe(DEVICE_KEYS);
  const named = left.filter(k => /(npub1[02-9ac-hj-np-z]{20,}|[0-9a-f]{64})/i.test(k) && !k.startsWith('trinityone.backedup.'));
  assert.deepEqual(named, [], 'these still name the congregation on a locked phone: ' + named.join(', '));
});

test('the seed-backup flag is kept, deliberately', () => {
  // It carries the member's OWN npub, not the congregation's, and their key is already on this device. Wiping
  // it costs a re-nag to back up the seed after every lock, for no forensic gain. Stated, not silent.
  const left = runWipe(DEVICE_KEYS);
  assert.ok(left.some(k => k.startsWith('trinityone.backedup.')),
    'wiping the backup flag makes the app ask the member to write down their words again after every lock');
});

test('the church list is KEPT, and the comment says so', () => {
  // Deliberate: nothing rebuilds followedChurches on unlock — only a 12-word restore reconstructs it from
  // member: documents — so wiping it would strand a member outside their own church. The point of this test
  // is that the limitation is STATED rather than claimed away, which is what F8 was really about.
  const left = runWipe(DEVICE_KEYS);
  assert.ok(left.includes('trinityone.followedChurches'), 'wiping this strands the member with no way back');
  const at = F.indexOf('clearCommunityCache() {');
  const near = F.slice(Math.max(0, at - 2200), at);
  assert.match(near, /followedChurches/,
    'the comment must name what it does NOT wipe — claiming to remove "every cache that would reveal church membership" while keeping the church list is the defect');
  assert.doesNotMatch(near, /wipe every localStorage cache that would reveal church membership/,
    'the overclaiming comment is back');
});

// ── F7: does it run at all? ──────────────────────────────────────────────────────────────────────────────
test('the wipe is not gated on the first-render sample', () => {
  const at = APP.indexOf('forensic hygiene');
  assert.notEqual(at, -1, 'the locked-boot wipe is gone from app.jsx');
  const block = APP.slice(at, APP.indexOf('WALLET_ENABLED', at));
  assert.match(block, /\}, \[commLocked\]\)/,
    'the wipe still runs once on mount with an empty dependency list, so it reads the first-render guess — ' +
    'the exact sample the lock gate beside it was fixed for, and it does NOT run on a locked boot');
  assert.doesNotMatch(block, /clearCommunityCache\(\); \} catch \(e\) \{\} \} \}, \[\]\)/, 'the empty-deps version is back');
});

test('and a mid-session lock wipes too, without looping', () => {
  const at = APP.indexOf('forensic hygiene');
  const block = APP.slice(at, APP.indexOf('WALLET_ENABLED', at));
  assert.match(block, /wipedForLock/, 'nothing guards against re-wiping on every render while locked');
  assert.match(block, /if \(!commLocked\) \{ wipedForLock\.current = false;/,
    'the guard is never re-armed, so locking a second time in one session would not wipe');
});
