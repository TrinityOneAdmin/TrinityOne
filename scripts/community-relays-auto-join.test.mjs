// COMMUNITY RELAYS — THE AUTO-JOIN PASS (PLAN-relay-autoconnect-selfhealing-sync-2026-11-20 §B2).
// Run: node --test scripts/community-relays-auto-join.test.mjs
//
// autoJoinPublicRelays is lifted WHOLE from the SHIPPED vendor/steward.js and run (CLAUDE.md rule 3's vendor half).
// It proves, with the real rankOffersByLatency / _communityCap / _mergeChosen lifted beside it (never stubbed, so the
// cap and the ordering are the shipped ones):
//   1. it skips unless own console, prefs read COMPLETE, publicAuto on;
//   2. the cap counts the LIVE relay-net community set (excluding canonical/shared pins + the church's own box),
//      NOT the `chosen` bookkeeping doc and NOT who answered — so a stale/empty `chosen` can't over-adopt (FIX 1);
//   3. a pick is REGISTERED before it counts, and a 403 / 429 skips to the next candidate;
//   4. declined / tombstoned / shared / already-listed candidates are skipped;
//   5. a successful pick is signRelay'd into relay-net, recorded in `chosen`, and publishRelayList is called;
//   6. nothing is ever auto-removed;
//   7. candidates are adopted FASTEST-MEASURED-ACCESS FIRST.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

const key = (n) => String(n).padStart(2, '0').repeat(32).slice(0, 64);   // a deterministic 64-hex key per url seed
const offer = (seed, ms, over = {}) => ({ url: 'wss://box-' + seed + '.example/relay', name: 'box-' + seed, ms, ...over });

// Build the pass over a scripted world. `prefs`/`complete` feed _readRelayPrefs; `offers` feed discoverRelayOffers;
// `keyOf(url)` is what each address proves; `reg(url)` is registerAtRelay's answer; `listed`/`declined`/`shared`/
// `tomb` are the skip sets. Everything a removal would touch is a throwing spy, so step 6 fails loudly if reached.
function runJoin(opts = {}) {
  const {
    sk = 'sk', pub = 'CHURCHPUB', actingChurch = '', network = false,
    prefs = null, complete = true, offers = [],
    keyOf = (u) => key(u.replace(/\D/g, '') || '1'),
    reg = () => ({ ok: true, status: 200 }),
    listedKeys = [], declined = [], shared = [], tomb = [],
  } = opts;
  const log = [];
  const writtenChosen = [];
  const scope = {
    sk, pub, actingChurch, PUBLIC_TARGET_DEFAULT: 5,
    CANONICAL_RELAYS: ['wss://app.trinityone.church/relay'],
    RELAYS_REMOVED_D: 'trinityone/relays-removed', RELAYPREFS_D: 'trinityone/relayprefs',
    _viewingNetwork: () => network,
    _readRelayPrefs: async () => ({ prefs, complete }),
    discoverRelayOffers: async () => offers.slice(),
    relays: () => [],
    relayNetEntries: async () => listedKeys.map((k) => ({ pubkey: k })),
    _oneComplete: async () => ({ ev: tomb.length ? { pubkey: pub, content: JSON.stringify(tomb.map((k) => ({ pubkey: k, at: 9 }))) } : null, askedUrls: ['r'], answeredUrls: ['r'] }),
    _ownChurchName: () => 'St Aidan',
    _isDeclined: (u) => declined.includes(u),
    isSharedRelaySpelling: (u) => shared.includes(u),
    verifyRelayIdentity: async (u) => ({ relayPub: keyOf(u) }),
    // FIX 1 collaborators: the live-count deficit excludes canonical/shared pins (sharedRelayKeys) and this
    // church's OWN box(es) (the gate's ALREADY-PROVED key — a synchronous cache read, never a probe). The default
    // world has none of either, so every relay-net / chosen key counts as community exactly as before.
    sharedRelayKeys: () => opts.sharedKeys || [],
    relayNetCandidates: () => opts.ownUrls || [],
    selfPublicRelay: () => '',
    ownRelay: () => '',
    _gate: { provedKey: (u) => (opts.ownKeyAt && opts.ownKeyAt(u)) || '' },
    _writeRelayPrefs: async (mutate) => { const r = mutate({ chosen: prefs && prefs.chosen }); writtenChosen.push(r.chosen); return opts.writePrefs || { written: true }; },
    window: { Steward: {
      registerAtRelay: async (u) => { log.push('reg:' + u); return reg(u); },
      addRelay: (u) => { log.push('add:' + u); return u; },
      rememberRelayName: (n, u, p) => { log.push('remember:' + u + ':' + (p || '').slice(0, 2)); },
      signRelay: async (u) => { log.push('sign:' + u); return { published: true, proven: [{ url: u, pubkey: 'x' }] }; },
      publishRelayList: () => { log.push('publishRelayList'); return Promise.resolve(null); },
      removeRelay: () => { throw new Error('autoJoin must NEVER auto-remove'); },
      unsignRelay: () => { throw new Error('autoJoin must NEVER auto-unsign'); },
    } },
    Math, JSON, Number, Array, Set, String, Object, Promise, Boolean, RegExp,
  };
  const names = Object.keys(scope);
  const src = [
    fnBody(STEWARD, 'function _clampPublicTarget(n) {', '_clampPublicTarget'),
    fnBody(STEWARD, 'function _communityCap(publicTarget) {', '_communityCap'),
    fnBody(STEWARD, 'function _mergeChosen(a, b) {', '_mergeChosen'),
    fnBody(STEWARD, 'function rankOffersByLatency(offers) {', 'rankOffersByLatency'),
    fnBody(STEWARD, 'async function autoJoinPublicRelays() {', 'autoJoinPublicRelays'),
  ].join('\n');
  const fn = new Function(...names, src + '\nreturn autoJoinPublicRelays;')(...names.map((k) => scope[k]));
  return { run: fn, log, writtenChosen, adopted: () => log.filter((x) => x.startsWith('sign:')).map((x) => x.slice(5)) };
}

test('1. skips unless own console, prefs COMPLETE, and publicAuto on', async () => {
  const offers = [offer(1, 10)];
  assert.equal((await runJoin({ offers, complete: false }).run()).incomplete, true, 'an incomplete read must FAIL CLOSED — never auto-join');
  assert.equal((await runJoin({ offers, prefs: { publicAuto: false, publicTarget: 5 }, complete: true }).run()).optedOut, true, 'an opted-out church was auto-joined anyway');
  assert.equal((await runJoin({ offers, actingChurch: 'f'.repeat(64) }).run()).skipped, 'not this church’s own console');
  assert.equal((await runJoin({ offers, network: true }).run()).skipped, 'not this church’s own console');
  // absent prefs + complete = ON: it DOES run (default-on opt-out).
  const on = runJoin({ offers });
  const r = await on.run();
  assert.equal(r.ran, true, 'ABSENT + COMPLETE must run — community relays are ON by default');
  assert.equal(on.adopted().length, 1, 'the default-on pass adopted nothing');
});

test('2. the cap counts LISTED (chosen + canonical), NOT answering — an outage never opens a slot', async () => {
  // target 5, canonical counts as 1 → community cap 4.
  const c = (n) => Array.from({ length: n }, (_, i) => ({ pubkey: key('9' + i), url: 'x', name: '' }));
  const offers = [offer(1, 10), offer(2, 20), offer(3, 30)];
  const atTarget = await runJoin({ offers, prefs: { publicAuto: true, publicTarget: 5, chosen: c(4) } }).run();
  assert.equal(atTarget.atTarget, true, 'a church already at its per-church cap kept adopting');
  assert.equal(atTarget.cap, 4, 'the community cap is not target minus the canonical pin');

  // one short of the cap (3 chosen) → adopts exactly 1, regardless of how many offers answered.
  const deficit1 = runJoin({ offers, prefs: { publicAuto: true, publicTarget: 5, chosen: c(3) } });
  await deficit1.run();
  assert.equal(deficit1.adopted().length, 1, 'the deficit of 1 did not adopt exactly one');

  // lowering the target stops adoption without removing anything: target 1 → cap 0 → nothing adopted, nothing removed.
  const lowered = runJoin({ offers, prefs: { publicAuto: true, publicTarget: 1, chosen: c(2) } });
  const lr = await lowered.run();
  assert.equal(lr.atTarget, true, 'target below current chosen still adopted');
  assert.equal(lowered.adopted().length, 0);
});

test('FIX 1 — the deficit counts the LIVE relay-net community set (excluding pins + own box), not the stale `chosen`', async () => {
  const canonical = key('ca');                                          // a canonical/shared pin, signed into relay-net
  const own = key('07');                                                // this church's OWN box key, proved at its address
  const comm = (n) => Array.from({ length: n }, (_, i) => key('8' + i));// community-box keys already in relay-net

  // (a) NO OVER-ADOPTION. 4 community boxes are ALREADY in relay-net, but this console's `chosen` read came back
  //     EMPTY (a swallowed write-back, or a SECOND owner console). cap 4. Counted from reality the church is full →
  //     adopt NOTHING. Counted from the stale `chosen` the deficit is 4 and the pass would DOUBLE the church past
  //     its cap, with nothing to auto-remove it — the exact defect FIX 1 closes.
  {
    const offers = [offer(1, 10), offer(2, 20), offer(3, 30), offer(4, 40)];   // fresh keys, NOT in relay-net
    const j = runJoin({ offers, prefs: { publicAuto: true, publicTarget: 5, chosen: [] }, listedKeys: comm(4) });
    const r = await j.run();
    assert.equal(r.cap, 4);
    assert.equal(r.atTarget, true, 'the live relay-net set already fills the cap — the pass must NOT adopt more');
    assert.equal(j.adopted().length, 0, 'OVER-ADOPTION: it counted the stale `chosen`, not relay-net, and adopted past the cap');
  }

  // (b) PINS AND THE OWN BOX DO NOT COUNT as community. relay-net lists 2 community boxes + the canonical pin + the
  //     church's own box (4 keys), cap 4. If those two were counted the deficit would be 0 and nothing would adopt;
  //     counted correctly the community deficit is 2, so the two fastest fresh candidates are taken.
  {
    const offers = [offer(1, 10), offer(2, 20), offer(3, 30)];
    const j = runJoin({
      offers, prefs: { publicAuto: true, publicTarget: 5, chosen: [] },
      listedKeys: [...comm(2), canonical, own],
      sharedKeys: [canonical],
      ownUrls: ['wss://self.example/relay'],
      ownKeyAt: (u) => (u === 'wss://self.example/relay' ? own : ''),   // the gate's CACHED proof — no probe
    });
    const r = await j.run();
    assert.equal(r.listed, 2, 'the canonical pin and/or the own box were counted toward the community cap');
    assert.equal(j.adopted().length, 2, 'pins/own box ate community slots — the live-community count must exclude them');
  }
});

test('3. a pick is REGISTERED before it counts; a 403 / 429 skips to the next candidate', async () => {
  // box-1 is full (429), box-2 invite-only (403), box-3 accepts.
  const offers = [offer(1, 10), offer(2, 20), offer(3, 30)];
  const j = runJoin({ offers, prefs: { publicAuto: true, publicTarget: 5, chosen: [] },
    reg: (u) => u.includes('box-1') ? { ok: false, status: 429 } : u.includes('box-2') ? { ok: false, status: 403 } : { ok: true, status: 200 } });
  const r = await j.run();
  // register was attempted on all three in order; only box-3 was signed, and only AFTER its register.
  assert.deepEqual(j.log.filter((x) => x.startsWith('reg:')), ['reg:wss://box-1.example/relay', 'reg:wss://box-2.example/relay', 'reg:wss://box-3.example/relay'], 'registration order / attempts wrong');
  assert.deepEqual(j.adopted(), ['wss://box-3.example/relay'], 'a box that refused registration (403/429) was adopted, or an accepting one was not');
  assert.ok(j.log.indexOf('reg:wss://box-3.example/relay') < j.log.indexOf('sign:wss://box-3.example/relay'), 'REGISTRATION DID NOT PRECEDE SIGNING — an unregistered box would be adopted');
  assert.equal(r.added.length, 1);
});

test('4. declined / tombstoned / shared / already-listed candidates are skipped', async () => {
  const offers = [offer(1, 10), offer(2, 20), offer(3, 30), offer(4, 40), offer(5, 50)];
  const j = runJoin({
    offers, prefs: { publicAuto: true, publicTarget: 10, chosen: [] },
    declined: ['wss://box-1.example/relay'],
    shared: ['wss://box-2.example/relay'],
    tomb: [key('3')],                       // box-3's proved key is tombstoned
    listedKeys: [key('4')],                 // box-4's key is already in the church's relay-net
  });
  const r = await j.run();
  assert.deepEqual(j.adopted(), ['wss://box-5.example/relay'], 'a declined/shared/tombstoned/already-listed candidate was adopted');
  const reasons = Object.fromEntries(r.skipped);
  assert.equal(reasons['wss://box-1.example/relay'], 'declined');
  assert.equal(reasons['wss://box-2.example/relay'], 'shared');
  assert.equal(reasons['wss://box-3.example/relay'], 'tombstoned');
  assert.equal(reasons['wss://box-4.example/relay'], 'already');
});

test('5. a successful pick is signed into relay-net, recorded in chosen, and publishRelayList is called', async () => {
  const offers = [offer(1, 10)];
  const j = runJoin({ offers, prefs: { publicAuto: true, publicTarget: 5, chosen: [] } });
  const r = await j.run();
  assert.deepEqual(j.adopted(), ['wss://box-1.example/relay'], 'the pick was not signed into relay-net');
  assert.ok(j.log.includes('add:wss://box-1.example/relay'), 'the pick was not added to the relay panel');
  assert.ok(j.log.includes('remember:wss://box-1.example/relay:' + key('1').slice(0, 2)), 'the pick was not name/key bound');
  assert.ok(j.log.includes('publishRelayList'), 'the authoritative 10002 was not republished');
  // recorded church-wide in `chosen` (newest-wins write)
  assert.equal(j.writtenChosen.length, 1, 'the chosen set was not written back church-wide');
  assert.ok(j.writtenChosen[0].some((c) => c.pubkey === key('1')), 'the adopted box was not recorded in chosen');
  assert.equal(r.added[0].pubkey, key('1'));
});

test('6. nothing is ever auto-removed (removeRelay / unsignRelay are never reached)', async () => {
  // the spies throw if called; a clean run over several picks proves the pass never removes.
  const offers = [offer(1, 10), offer(2, 20)];
  const j = runJoin({ offers, prefs: { publicAuto: true, publicTarget: 5, chosen: [] } });
  await assert.doesNotReject(j.run());
  assert.equal(j.adopted().length, 2);
  assert.ok(!j.log.some((x) => x.startsWith('remove') || x.startsWith('unsign')), 'the pass removed something');
});

test('7. candidates are adopted FASTEST-MEASURED-ACCESS FIRST (within the deficit)', async () => {
  // offers arrive out of order; the deficit is 2, so the two FASTEST (ms 5 and 15) must be the ones taken.
  const offers = [offer(1, 40), offer(2, 5), offer(3, 25), offer(4, 15)];
  const j = runJoin({ offers, prefs: { publicAuto: true, publicTarget: 3, chosen: [] } });   // cap 2, deficit 2
  await j.run();
  assert.deepEqual(j.adopted(), ['wss://box-2.example/relay', 'wss://box-4.example/relay'],
    'the pass did not take the fastest-measured candidates first');
});
