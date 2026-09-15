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
  'trinityone.categories.' + CHURCH, 'trinityone.chatTabSeen.' + NPUB, 'trinityone.approvedToast.' + NPUB,
  'trinityone.devos.' + CHURCH, 'trinityone.devos.' + NPUB, 'trinityone.hb:' + NPUB,
  'trinityone.joinstate.' + NPUB, 'trinityone.msgtags.' + NPUB, 'trinityone.plans.' + CHURCH,
  // must SURVIVE
  'trinityone.followedChurches', 'trinityone.activeChurch',
  'trinityone.outbox', 'trinityone.mydata:data/journal', 'trinityone.mydata:data/notes',
  'trinityone.joinsent',   // the fact that a relay accepted this identity's join — id-free key on purpose
  'trinityone.joinintent', // a join asked for while locked, bound to the locked identity — exists to survive this wipe
  'trinityone.readerScale', 'trinityone.settings', 'trinityone.nostr.mnemonic.enc',
  'trinityone.backedup.' + NPUB,   // names the MEMBER, not the church — see the test below
  'trinityone.bible.translation', 'trinityone.reading.position',
  // ⚠ AND THE THREE A PHONE ARGUED BACK ON. Every one of these carries a 64-hex pubkey in its NAME, so the
  // IDENTIFIER rule takes them unless something exempts them — and until bf25f49 nothing did.
  'trinityone.bringkids.' + CHURCH + '|' + MEMBER,
  'trinityone.mykidnames.' + CHURCH + '|' + MEMBER,
  'trinityone.arrivedat.' + CHURCH + '|' + MEMBER,
];

// ⚠ THREE PREFIXES ARE DELIBERATE KEEPS AND MUST BE NAMED HERE, or this assertion and the keep-list
// contradict each other and one of them is wrong. bringkids / mykidnames / arrivedat hold a parent's own
// children's first names and whether they were brought — argued for one at a time after a Pixel measured a
// locked boot destroying them permanently (2026-09-12), and ruled on by the owner: "the names being on the
// phone is fine. A parent will likely have much more personal information on the phone anyway."
// They are pinned by their own tests at the foot of this file.
const DELIBERATE_KEEPS = /^trinityone\.(backedup|approvedToast|bringkids|mykidnames|arrivedat)\./;

test('the caches the device was still holding are wiped', () => {
  const left = runWipe(DEVICE_KEYS);
  // backedup.<own npub> is a deliberate keep — see its own test below.
  const churchKeyed = left.filter(k => (k.includes(CHURCH) || k.includes(NPUB)) && !DELIBERATE_KEEPS.test(k));
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
    'trinityone.mydata:data/journal', 'trinityone.mydata:data/notes',
    // 2026-09-06: the "a relay accepted my join" stamp. Wiped, every locked boot would tell a pending member
    // their request was never sent. Its key names nobody; see JOINSENT_KEY in fellowship.src.js.
    // joinintent: the join a locked phone promised to make once unlocked. Wiped, the promise dies on the
    // very boot it was made to survive. See JOININTENT_KEY.
    'trinityone.joinsent', 'trinityone.joinintent']) {
    assert.ok(left.includes(k), 'the wipe destroyed ' + k);
  }
});

test('no key naming the congregation survives, including ones nobody listed', () => {
  // The property, not the list. Eleven caches on the real device carried the church or the member in the key
  // NAME and no version of the prefix list covered them, because every new feature added one and nobody went
  // back. This is the same failure as the relay's served-file denylist.
  const left = runWipe(DEVICE_KEYS);
  const named = left.filter(k => /(npub1[02-9ac-hj-np-z]{20,}|[0-9a-f]{64})/i.test(k) && !DELIBERATE_KEEPS.test(k));
  assert.deepEqual(named, [], 'these still name the congregation on a locked phone: ' + named.join(', '));
});

test('the "you were accepted" marker is kept, or the app re-announces it', () => {
  // Reported on a real phone minutes after the property-based wipe went in: unlocking produced a fresh
  // "you have been accepted into the church" toast, because the marker saying we had already said it was
  // wiped. It names a church that the KEPT followedChurches already names, so retaining it reveals nothing.
  const left = runWipe(DEVICE_KEYS);
  assert.ok(left.some(k => k.startsWith('trinityone.approvedToast.')),
    'the member is told they were accepted into their church all over again on every unlock');
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
// ── ITEM 15 (audit 2026-09-14): THESE TWO USED TO MATCH TEXT IN app/app.jsx ────────────────────────────
// app/*.jsx ships UNBUNDLED, so `false && ` — or `if (true) return true;` — leaves every word in place and
// a text-matching assertion still passes. Sabotage proved it: `if (true) return true;` at the top of the
// wipe's `attempt()` left 9/9 green, over the one effect that decides whether a seized, locked phone still
// holds a congregation's caches. CLAUDE.md rule 3, in the file that most needs it.
// THE EFFECT IS LIFTED OUT OF app/app.jsx AND RUN NOW. Nothing below matches source text.
function lockEffect(opts) {
  const { locked, engineAfter = 0 } = opts;
  const A = readFileSync(ROOT + 'app/app.jsx', 'utf8');
  const a = A.indexOf('const wipedForLock = useAR(false);');
  assert.notEqual(a, -1, 'the locked-boot wipe is gone from app.jsx — re-anchor this test');
  const b = A.indexOf('}, [commLocked]);', a);
  assert.notEqual(b, -1, 'the wipe effect no longer ends at [commLocked] — re-anchor');
  const src = A.slice(a, b + '}, [commLocked]);'.length)
    .replace('const wipedForLock = useAR(false);', 'const wipedForLock = { current: false };')
    .replace('useAE(() => {', 'const __effect = (() => {')
    .replace('}, [commLocked]);', '});');
  let wipes = 0;
  const ticks = [], timers = [];
  // ⚠ `commLocked` IS MUTABLE, so the SAME `wipedForLock` can be carried across a lock → unlock → lock.
  // An earlier version of this file built a fresh lockEffect per phase, each with a brand-new flag, so its
  // "re-arms when the lock clears" test proved nothing at all — the audit of 2026-09-14 caught it.
  let lockedNow = locked;
  // …and the engine appears only after `engineAfter` ATTEMPTS, counted per attempt rather than per property
  // read. `attempt()` reads window.Fellowship two or three times, so counting reads made `engineAfter: 3`
  // mean "somewhere between 2 and 5 attempts" — loose enough that the test passed for any nearby value.
  let attempts = 0;
  // AND WHETHER IDENTITY HAS SETTLED. `commLocked` is seeded from lockNow() at FIRST RENDER, and on a
  // "stay open" boot `isLocked()` is `hasEnc() && !sessionMnemonic` — true until an await on the secure
  // store completes. So the app believes it is locked for one render on a phone that never locked, and
  // whether the wipe wins that race is a timing accident. Item 7 of the 14-day audit.
  let settled = opts.settled !== false;
  const win = {
    get Fellowship() {
      return (attempts >= engineAfter) ? { clearCommunityCache: () => { wipes++; } } : {};
    },
    get TrinityIdentity() { return { settled, ready: Promise.resolve() }; },
  };
  const scope = {
    get commLocked() { return lockedNow; },
    window: win,
    setInterval: (fn) => { ticks.push(fn); return 1; }, clearInterval: () => {},
    // RECORD the give-up timer rather than swallowing it. Stubbing this as a no-op hid the whole retry
    // budget: shortening it to 1ms left 23/23 green while a device that kills the poll gets ONE attempt.
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped wipe effect needs a stub for ' + String(k)); },
  });
  const run = new Function('scope', 'with (scope) { ' + src + '\nreturn __effect; }')(proxy);
  let cleanup = run();
  attempts++;
  return {
    wipes: () => wipes,
    tick: () => { attempts++; ticks.forEach(f => f()); },
    // what the effect re-runs as when commLocked changes — same closure, same wipedForLock
    setLocked: (v) => { if (typeof cleanup === 'function') cleanup(); lockedNow = v; cleanup = run(); attempts++; },
    giveUp: () => timers.forEach(t => t.fn()),
    settle: () => { settled = true; },
    giveUpMs: () => (timers[0] || {}).ms,
    pollMs: () => 300,
  };
}

test('a LOCKED boot actually calls the wipe — the effect, run, not its source text', () => {
  const e = lockEffect({ locked: true });
  assert.equal(e.wipes(), 1,
    'THE LOCKED-BOOT WIPE DID NOT RUN. A seized, locked phone keeps every congregation cache on disk. This ' +
    'is the effect executed, so no amount of dead code in app.jsx can satisfy it.');
});

test('an UNLOCKED boot does not wipe — over-wiping is the other way to get this wrong', () => {
  const e = lockEffect({ locked: false });
  assert.equal(e.wipes(), 0, 'the app wiped a member’s church caches on an ordinary unlocked boot');
});

test('it does not wipe twice while locked, and re-arms when the lock clears', () => {
  const e = lockEffect({ locked: true });
  e.tick(); e.tick();
  assert.equal(e.wipes(), 1, 'the wipe ran again on a later tick — it loops for the whole locked session');
  // …and the SAME effect, unlocked and locked again, wipes a second time. This is one closure throughout:
  // building a fresh harness per phase gives each one a new flag and proves nothing.
  e.setLocked(false);
  assert.equal(e.wipes(), 1, 'unlocking wiped');
  e.setLocked(true);
  assert.equal(e.wipes(), 2,
    'A SECOND LOCK IN ONE SESSION DID NOT WIPE. The guard was never re-armed, so a member who locks, unlocks ' +
    'and locks again leaves the congregation’s caches on disk for the rest of the session.');
});

test('the retry budget is long enough to outlast a slow engine load', () => {
  // The give-up timer was stubbed as a no-op, so shortening it to 1ms left every test green — while on a
  // device that kills the poll before the 300ms interval runs once, the wipe gets exactly ONE attempt. That
  // is the measured failure the retry exists for: 11 church-keyed caches still on disk at a locked boot.
  const e = lockEffect({ locked: true, engineAfter: 99 });
  assert.ok(e.giveUpMs() >= 10000,
    'the wipe gives up after ' + e.giveUpMs() + 'ms. vendor/fellowship.js can take seconds to load on a cold ' +
    'boot, and a wipe that has given up before it arrives is the whole feature not running, silently.');
  assert.ok(e.giveUpMs() / e.pollMs() >= 20,
    'that budget is fewer than 20 attempts at the 300ms poll — too few for a cold start on a slow phone');
});

test('it RETRIES until the engine has loaded, rather than recording a wipe that never happened', () => {
  // The device caught this one: marking the flag before checking window.Fellowship meant a run that arrived
  // before vendor/fellowship.js had finished loading recorded itself as "wiped" and never tried again —
  // 11 church-keyed caches still on disk at a locked boot.
  const e = lockEffect({ locked: true, engineAfter: 3 });
  assert.equal(e.wipes(), 0, 're-anchor: the engine was supposed to be absent on the first attempt');
  e.tick(); e.tick(); e.tick(); e.tick();
  assert.equal(e.wipes(), 1,
    'THE WIPE GAVE UP BECAUSE THE ENGINE HAD NOT LOADED YET, and marked itself done. On a locked boot that ' +
    'is the whole feature not running, silently.');
});



// ── ITEM 10 (audit 2026-09-14): bf25f49's FIX HAD NO TEST ──────────────────────────────────────────────
// Sabotage removing the keep-list clause left 124/124 green, over a fix for MEASURED PERMANENT DATA LOSS.
// Found on a Pixel, 2026-09-12: a locked boot destroyed a parent's children's names — intermittently, so it
// read as the app being flaky — and they do not come back. The parent opens the app at a children's door on
// Sunday morning to an empty card and cannot tell whether they ever entered them.
test('a parent’s children, and whether they were brought, SURVIVE a locked boot', () => {
  const left = runWipe(DEVICE_KEYS);
  for (const [prefix, what] of [
    ['trinityone.mykidnames.', 'the names of this parent’s children'],
    ['trinityone.bringkids.', 'whether this parent said they are bringing them'],
    ['trinityone.arrivedat.', 'the answer the church gave when they tapped "We’re here"'],
  ]) {
    const key = prefix + CHURCH + '|' + MEMBER;
    assert.ok(left.includes(key),
      'A LOCKED BOOT DESTROYED ' + what.toUpperCase() + ', PERMANENTLY. Measured on a Pixel, 2026-09-12. ' +
      'The parent opens the app at the door to an empty card, with nothing saying why. Missing: ' + key);
  }
});

test('…and the exemption is by PREFIX, so it cannot be dodged by a longer key', () => {
  // The keys are `<prefix><churchPub>|<memberPub>`; an exact-match keep-list would miss every real one.
  const long = 'trinityone.mykidnames.' + CHURCH + '|' + MEMBER + '|extra';
  assert.ok(runWipe([long]).includes(long), 'the keep is an exact match, so real keys are still wiped');
});

test('the exemption does NOT widen the wipe’s hole — a church cache with a similar name still goes', () => {
  // The other way to get a keep-list wrong. `trinityone.mykids…` is not `trinityone.mykidnames.`, and a
  // prefix test written loosely (startsWith('trinityone.mykid')) would spare a key nobody argued for.
  const near = ['trinityone.mykids.' + CHURCH, 'trinityone.bringkid.' + CHURCH, 'trinityone.arrived.' + CHURCH];
  const left = runWipe(near);
  assert.deepEqual(left, [],
    'the keep-list is matching more than the three prefixes that were argued for, one at a time: ' + left.join(', '));
});

// ── ITEM 7 (14-day audit, 2026-09-14): THE WIPE FIRES ON A PHONE THAT NEVER LOCKED ─────────────────────
// `commLocked` is seeded from `lockNow()` at FIRST RENDER. On a "remember me" boot `isLocked()` is
// `hasEnc() && !sessionMnemonic`, and `sessionMnemonic` is set only after `await rememberedSeed()` — a
// SecureStorage round trip. So for one render the app believes it is locked, the wipe effect fires, and a
// member who never saw a PIN screen loses every church cache. Offline, the congregation then paints empty
// with nothing saying why.
//
// ⚠ THIS IS A RACE, WHICH IS WHY A PHONE COULD NOT SETTLE IT. Eight force-stop boots on the Oppo did not
// reproduce it — that is evidence about one phone's secure-store latency on eight occasions, not about the
// ordering. Driven here in both directions instead: decisive, and it needs no hardware.
//
// ⚠ AND IT CORRECTS bf25f49's COMMIT MESSAGE AND ITS CODE COMMENT, both of which named the SECOND clause
// (`hasPin() && !myPubkey`). The FIRST clause is the one that fires.
test('a wipe must NOT run on a lock the app has only GUESSED at', () => {
  const e = lockEffect({ locked: true, settled: false });   // first render on a remembered boot
  assert.equal(e.wipes(), 0,
    'THE WIPE RAN ON A FIRST-RENDER GUESS. On a "stay open" boot isLocked() is true until the secure store ' +
    'answers, so a member who never locked loses every church cache — and offline the congregation paints ' +
    'empty with nothing saying why. Whether it fires is a timing accident, which is why eight boots on a ' +
    'phone proved nothing either way.');
});

test('…and once identity settles as UNLOCKED, it still never runs', () => {
  const e = lockEffect({ locked: true, settled: false });
  e.settle();                 // the secure store answered: the member is remembered, not locked
  e.setLocked(false);         // …so commLocked clears
  e.tick(); e.tick();
  assert.equal(e.wipes(), 0, 'the wipe ran after the app learned the member was never locked');
});

test('but a GENUINELY locked boot still wipes, once identity has settled', () => {
  // The other direction, and the one the feature exists for. AUDIT-2026-07-28 F7 was the mirror failure —
  // the wipe read a first-render value and did NOT run on a real locked boot, leaving 11 church-keyed
  // caches on a seized phone. Waiting for `settled` must not reintroduce that.
  const e = lockEffect({ locked: true, settled: false });
  assert.equal(e.wipes(), 0, 're-anchor: it wiped before settling');
  e.settle();
  e.tick();
  assert.equal(e.wipes(), 1,
    'A SEIZED, LOCKED PHONE KEEPS EVERY CONGREGATION CACHE. Waiting for the lock to be settled has turned ' +
    'into never wiping at all, which is the defect this whole effect exists for.');
});
