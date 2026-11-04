// Preload warming — the console Finance-page SEED (SEALED-MONEY-AT-REST), 2026-11-04.
// Run: node --test scripts/console-finance-seed-preload.test.mjs
//
// DashFinanceBook rebuilds the whole double-entry book from the relay on every open via encSubscribe('finance/'),
// so it flashes blank for a tunnel round-trip. This adds a cache-first, NIP-44-SEALED on-disk seed so the page
// paints instantly, cleared with the church key, read as ABSENT when the key is locked. encSubscribe is GENERIC
// — it also serves check-in (the children's safeguarding register) and Manna (benevolence person-data), and BOTH
// run with kk==='finance' — so the seed is gated on the PREFIX string 'finance/', never on `kk`.
//
// Each test LIFTS the REAL encSubscribe out of the SHIPPED bundle (vendor/steward.js) together with the REAL
// _finBookGet/_finBookSet/_finBookKeep seal helpers (via deps), run against a fake pool with an INVERTIBLE fake
// nip44 (bundled as encrypt2/decrypt3) + a churchSk, so "no plaintext on disk" is a genuine assertion and a
// source-only change that was never built, or a regression that drops the seed, fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, deps } from './test-slice.mjs';
import { Buffer } from 'node:buffer';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const FB = 'trinityone.steward.financebook.';
const KEY = (cp) => FB + cp;

// the bundle renames nip44e/nip44d to encrypt2/decrypt3 — invertible fakes so a seal really round-trips and the
// "no plaintext on disk" / "church bound inside the seal" assertions are real, not merely "the string is absent".
const ENC = (pt) => 'SEAL:' + Buffer.from(String(pt), 'utf8').toString('base64');
const DEC = (ct) => Buffer.from(String(ct).replace(/^SEAL:/, ''), 'base64').toString('utf8');
const unseal = (onDisk) => JSON.parse(DEC(JSON.parse(onDisk).s));

function fakeLS() {
  const m = new Map();
  return { store: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}
// run the coalesced seed write synchronously so the test is deterministic (the 0 return is falsy, so the
// `!_finT` re-arm guard behaves exactly as with a real timer handle — same trick as the overview seed tests).
const SYNC_TIMEOUT = (fn) => { try { fn(); } catch (e) {} return 0; };

// Lift the REAL encSubscribe (and, via deps, the REAL _finBook* seal helpers) and run it over a fake pool.
function loadFinance(opts = {}) {
  const body = fnBody(BUNDLE, 'encSubscribe(prefix, cb, kind)');
  const subs = [];
  const ls = opts.localStorage || fakeLS();
  const ctx = {
    pool: { subscribeMany: (r, f, h) => { subs.push({ filters: f, handlers: h }); return { close() {} }; } },
    relays: () => [],
    actingChurch: ('actingChurch' in opts) ? opts.actingChurch : '',
    pub: ('pub' in opts) ? opts.pub : 'CHURCH_A',
    churchSk: ('churchSk' in opts) ? opts.churchSk : 'SK',      // null → the console's key is locked/absent
    NET: 'trinityone',
    FINBOOK_LS: FB,
    FINBOOK_MAX_BYTES: ('cap' in opts) ? opts.cap : 3 * 1024 * 1024,
    // the bundled crypto names the lifted _finBook* helpers call; fake-but-invertible so deps() does NOT lift the
    // real crypto stack and "no plaintext on disk" is real.
    encrypt2: ENC,
    decrypt3: DEC,
    lsGet: (k) => ls.getItem(k), lsSet: (k, v) => ls.setItem(k, v), localStorage: ls,
    setTimeout: SYNC_TIMEOUT, clearTimeout: () => {},
    // plumbing encSubscribe closes over, stubbed where unrelated to the seed:
    _encOpenSealedCopy: () => null,         // the helper's-copy fallback — not exercised (encOpen opens every doc)
    _capWaiters: {},
    _careRoster: new Set(),
    window: { Steward: { encOpen: (kk, content) => { try { return JSON.parse(content); } catch (e) { return null; } } } },
  };
  const depsCode = deps(BUNDLE, body, Object.keys(ctx));
  const make = new Function(...Object.keys(ctx), depsCode + 'function ' + body + '\n;return encSubscribe;');
  const encSubscribe = make(...Object.values(ctx));
  return { encSubscribe, subs, localStorage: ls };
}

// ─── event builders ───
const journalEv = (cp, seq, memo, amount = 1000, ts) => ({
  id: 'j' + seq, pubkey: cp, created_at: (ts == null ? 1000 + seq : ts),
  content: JSON.stringify({ seq, date: '2026-01-01', memo, postings: [{ account: 'bank', dir: 'dr', amount }, { account: 'income', dir: 'cr', amount }] }),
  tags: [['d', 'finance/journal:' + seq], ['t', 'trinityone']],
});
const settingsEv = (cp) => ({ id: 'set', pubkey: cp, created_at: 10, content: JSON.stringify({ baseCurrency: 'GBP', decimals: 2, fiscalYearStart: '01-01' }), tags: [['d', 'finance/settings'], ['t', 'trinityone']] });
const accountEv = (cp, code) => ({ id: 'acc' + code, pubkey: cp, created_at: 20, content: JSON.stringify({ code, name: 'Acct ' + code, type: 'asset', archived: false }), tags: [['d', 'finance/account:' + code], ['t', 'trinityone']] });
const attachmentEv = (cp, id) => ({ id: 'att' + id, pubkey: cp, created_at: 30, content: JSON.stringify({ data: 'data:image/jpeg;base64,RECEIPTBLOB' }), tags: [['d', 'finance/attachment:' + id], ['t', 'trinityone']] });
const checkinEv = (cp) => ({ id: 'ck', pubkey: cp, created_at: 40, content: JSON.stringify({ child: 'CHILD-NAME-SECRET', room: 'toddlers' }), tags: [['d', 'trinityone/checkin:sess1'], ['t', 'trinityone']] });
// the side docs the OLD whitelist dropped and the NEW blacklist keeps — DashFinanceBook's encSubscribe split
// feeds these to setBills/setInvoices/setDonors/setContacts/setBudgets. Generic: id is the d-suffix.
const sideEv = (cp, id, body, ts = 50) => ({ id: 'x' + id, pubkey: cp, created_at: ts, content: JSON.stringify(body), tags: [['d', 'finance/' + id], ['t', 'trinityone']] });
const mannaEv = (cp) => ({ id: 'mn', pubkey: cp, created_at: 40, content: JSON.stringify({ person: 'GRANT-PERSON-SECRET', amount: 5000 }), tags: [['d', 'trinityone/manna-1:rec1'], ['t', 'trinityone']] });

// write a sealed seed the way the engine would, for the "paints on open" / "locked" / isolation tests
function seedFinance(cp, events, opts = {}) {
  const ls = opts.localStorage || fakeLS();
  const w = loadFinance({ localStorage: ls, pub: cp, churchSk: ('churchSk' in opts) ? opts.churchSk : 'SK', cap: opts.cap });
  w.encSubscribe('finance/', () => {});
  for (const e of events) w.subs[0].handlers.onevent(e);
  w.subs[0].handlers.oneose();
  return ls;
}

// ───────────────────────── cache-first paint ─────────────────────────
test('finance: paints the cached book on first open — the FULL journal is restored', () => {
  const evs = [settingsEv('CHURCH_A'), accountEv('CHURCH_A', 'bank'), accountEv('CHURCH_A', 'income')];
  for (let s = 1; s <= 50; s++) evs.push(journalEv('CHURCH_A', s, 'entry ' + s));
  const ls = seedFinance('CHURCH_A', evs);
  const { encSubscribe } = loadFinance({ localStorage: ls });
  const paints = [];
  encSubscribe('finance/', (items, genuine) => paints.push({ items, genuine }));
  assert.ok(paints.length >= 1, 'never painted the cached book on open');
  const journals = paints[0].items.filter(i => String(i.id).startsWith('journal:'));
  assert.equal(journals.length, 50, 'the full 50-entry journal was not restored from the seed (got ' + journals.length + ')');
  assert.ok(paints[0].items.some(i => i.id === 'settings'), 'the settings doc was not restored from the seed');
  assert.equal(paints[0].genuine, false, 'the seed paint must NOT claim a genuine relay delivery');
});

test('finance: the journal is NEVER capped — the opened book is complete, not empty', () => {
  // rebuildBook needs a contiguous journal from seq 1; a cap that dropped early entries would paint an empty/error
  // book. Prove every seq round-trips in order.
  const evs = [settingsEv('CHURCH_A')];
  for (let s = 1; s <= 50; s++) evs.push(journalEv('CHURCH_A', s, 'm' + s));
  const ls = seedFinance('CHURCH_A', evs);
  const seed = unseal(ls.getItem(KEY('CHURCH_A')));
  const seqs = seed.docs.filter(d => String(d.id).startsWith('journal:')).map(d => d.seq).sort((a, b) => a - b);
  assert.equal(seqs.length, 50, 'the seed dropped journal entries — the journal must never be capped');
  assert.deepEqual(seqs, Array.from({ length: 50 }, (_, i) => i + 1), 'the seeded journal is not a contiguous 1..50 — rebuildBook would paint empty');
});

// ───────────────────────── SEALED at rest ─────────────────────────
test('finance: the seed on disk is SEALED — no journal memo or amount in cleartext; blob is the sealed shape', () => {
  const ls = seedFinance('CHURCH_A', [settingsEv('CHURCH_A'), journalEv('CHURCH_A', 1, 'SECRET-TITHE-MEMO', 987654)]);
  const onDisk = ls.getItem(KEY('CHURCH_A'));
  assert.ok(onDisk, 'nothing was sealed on settle');
  assert.equal(onDisk.includes('SECRET-TITHE-MEMO'), false, 'a journal memo is in CLEARTEXT on disk — must be sealed');
  assert.equal(onDisk.includes('987654'), false, 'a journal amount is in CLEARTEXT on disk — must be sealed');
  assert.ok(onDisk.includes('SEAL:'), 'the seed must be the sealed shape');
  const parsed = JSON.parse(onDisk);
  assert.ok(typeof parsed.s === 'string' && parsed.s.startsWith('SEAL:'), 'the on-disk shape must be { s: "SEAL:..." }');
  // round-trips under the key → "sealed", not merely "absent"
  assert.equal(unseal(onDisk).docs.find(d => d.id === 'journal:1').memo, 'SECRET-TITHE-MEMO', 'the sealed blob did not round-trip under the key');
});

test('finance: side docs & receipt blobs are DROPPED from the seed — only book docs are kept', () => {
  const ls = seedFinance('CHURCH_A', [settingsEv('CHURCH_A'), accountEv('CHURCH_A', 'bank'), journalEv('CHURCH_A', 1, 'm'), attachmentEv('CHURCH_A', 'a1')]);
  const seed = unseal(ls.getItem(KEY('CHURCH_A')));
  const ids = seed.docs.map(d => String(d.id));
  assert.ok(ids.includes('settings') && ids.includes('account:bank') && ids.includes('journal:1'), 'a book doc was dropped from the seed');
  assert.ok(!ids.some(i => i.startsWith('attachment:')), 'a receipt blob survived into the seed — side docs must be dropped');
  assert.equal(ls.getItem(KEY('CHURCH_A')).includes('RECEIPTBLOB'), false, 'the receipt blob reached disk');
});

// ───────────────── BLACKLIST: side docs are now SEEDED (bills/invoices/donors/contacts/budgets) ─────────────────
test('finance: bills/invoices/donors/contacts/budgets are NOW seeded — a return visit shows them without a relay round-trip', () => {
  const evs = [
    settingsEv('CHURCH_A'), accountEv('CHURCH_A', 'bank'), journalEv('CHURCH_A', 1, 'm'),
    sideEv('CHURCH_A', 'bill:b1', { payee: 'Acme', amount: 100 }),
    sideEv('CHURCH_A', 'invoice:i1', { client: 'Hall Hire', amount: 200 }),
    sideEv('CHURCH_A', 'donor:d1', { name: 'A Donor' }),
    sideEv('CHURCH_A', 'contact:c1', { name: 'A Contact' }),
    sideEv('CHURCH_A', 'budget:2026', { total: 9000 }),
    sideEv('CHURCH_A', 'template:t1', { name: 'A Template' }),
    sideEv('CHURCH_A', 'reconcile:r1', { account: 'bank' }),
    sideEv('CHURCH_A', 'billapproval:a1', { bill: 'b1' }),
  ];
  const ls = seedFinance('CHURCH_A', evs);
  // round-trip: reload and paint from the seed via _finBookGet — the display really gets them back
  const { encSubscribe } = loadFinance({ localStorage: ls });
  const paints = [];
  encSubscribe('finance/', (items) => paints.push(items));
  assert.ok(paints.length >= 1, 'never painted the cached book on open');
  const ids = paints[0].map(i => String(i.id));
  for (const want of ['bill:b1', 'invoice:i1', 'donor:d1', 'contact:c1', 'budget:2026']) {
    assert.ok(ids.includes(want), want + ' was not restored from the seed — the blacklist must keep it');
  }
  // and the on-disk seed itself carries them (round-trip of _finBookSet)
  const seed = unseal(ls.getItem(KEY('CHURCH_A')));
  const sids = seed.docs.map(d => String(d.id));
  for (const want of ['bill:b1', 'invoice:i1', 'donor:d1', 'contact:c1', 'budget:2026']) {
    assert.ok(sids.includes(want), want + ' is missing from the sealed seed on disk');
  }
});

test('finance: receipt BLOBS are STILL dropped even when other side docs are kept (blacklist keeps all but attachment:)', () => {
  const ls = seedFinance('CHURCH_A', [
    settingsEv('CHURCH_A'), journalEv('CHURCH_A', 1, 'm'),
    sideEv('CHURCH_A', 'donor:d1', { name: 'A Donor' }),
    attachmentEv('CHURCH_A', 'a1'),
  ]);
  const seed = unseal(ls.getItem(KEY('CHURCH_A')));
  const ids = seed.docs.map(d => String(d.id));
  assert.ok(ids.includes('donor:d1'), 'a non-attachment side doc was dropped');
  assert.ok(!ids.some(i => i.startsWith('attachment:')), 'a receipt blob survived into the seed — attachment: must still be dropped');
  assert.equal(ls.getItem(KEY('CHURCH_A')).includes('RECEIPTBLOB'), false, 'the receipt blob reached disk');
});

test('finance: side-doc PII is SEALED at rest — a donor name and a bill payee are never in cleartext', () => {
  const ls = seedFinance('CHURCH_A', [
    settingsEv('CHURCH_A'),
    journalEv('CHURCH_A', 1, 'SECRET-JOURNAL-MEMO', 778899),
    sideEv('CHURCH_A', 'donor:d1', { name: 'SECRET-DONOR-NAME' }),
    sideEv('CHURCH_A', 'bill:b1', { payee: 'SECRET-BILL-PAYEE', amount: 100 }),
  ]);
  const onDisk = ls.getItem(KEY('CHURCH_A'));
  assert.ok(onDisk && onDisk.includes('SEAL:'), 'the seed must be the sealed shape');
  assert.equal(onDisk.includes('SECRET-DONOR-NAME'), false, 'a donor name is in CLEARTEXT on disk — must be sealed');
  assert.equal(onDisk.includes('SECRET-BILL-PAYEE'), false, 'a bill payee is in CLEARTEXT on disk — must be sealed');
  assert.equal(onDisk.includes('SECRET-JOURNAL-MEMO'), false, 'a journal memo is in CLEARTEXT on disk — must be sealed');
  assert.equal(onDisk.includes('778899'), false, 'a journal amount is in CLEARTEXT on disk — must be sealed');
  // round-trips under the key → genuinely sealed, not merely absent
  const seed = unseal(onDisk);
  assert.equal(seed.docs.find(d => d.id === 'donor:d1').name, 'SECRET-DONOR-NAME', 'the sealed donor did not round-trip under the key');
  assert.equal(seed.docs.find(d => d.id === 'bill:b1').payee, 'SECRET-BILL-PAYEE', 'the sealed bill did not round-trip under the key');
});

test('finance: the journal stays FULL + CONTIGUOUS alongside the newly-seeded side docs', () => {
  const evs = [settingsEv('CHURCH_A'), sideEv('CHURCH_A', 'donor:d1', { name: 'D' }), sideEv('CHURCH_A', 'bill:b1', { payee: 'P' })];
  for (let s = 1; s <= 40; s++) evs.push(journalEv('CHURCH_A', s, 'm' + s));
  const ls = seedFinance('CHURCH_A', evs);
  const seed = unseal(ls.getItem(KEY('CHURCH_A')));
  const seqs = seed.docs.filter(d => String(d.id).startsWith('journal:')).map(d => d.seq).sort((a, b) => a - b);
  assert.equal(seqs.length, 40, 'a journal entry was dropped — the journal must stay complete under the blacklist');
  assert.deepEqual(seqs, Array.from({ length: 40 }, (_, i) => i + 1), 'the seeded journal is not a contiguous 1..40 — rebuildBook would paint empty');
});

// ───────────────────────── THE SAFEGUARDING GATE: finance/ ONLY ─────────────────────────
test('GATE: a CHECK-IN subscription (kk===finance) writes NO finance seed', () => {
  const ls = fakeLS();
  const { encSubscribe, subs } = loadFinance({ localStorage: ls });
  encSubscribe('trinityone/checkin:', () => {});   // no kind → kk = kind || 'finance' = 'finance'
  subs[0].handlers.onevent(checkinEv('CHURCH_A'));
  subs[0].handlers.oneose();
  assert.equal(ls.getItem(KEY('CHURCH_A')), null, 'a check-in subscription wrote a FINBOOK seed — the children register would be sealed into the finance cache');
  for (const [, v] of ls.store) assert.equal(String(v).includes('CHILD-NAME-SECRET'), false, 'a child name reached disk via the finance seed');
});

test('GATE: a MANNA subscription (kk===finance) writes NO finance seed', () => {
  const ls = fakeLS();
  const { encSubscribe, subs } = loadFinance({ localStorage: ls });
  encSubscribe('trinityone/manna-1:', () => {}, 'finance');   // Manna passes MANNA_CAP === 'finance'
  subs[0].handlers.onevent(mannaEv('CHURCH_A'));
  subs[0].handlers.oneose();
  assert.equal(ls.getItem(KEY('CHURCH_A')), null, 'a Manna subscription wrote a FINBOOK seed — benevolence person-data would be sealed into the finance cache');
  for (const [, v] of ls.store) assert.equal(String(v).includes('GRANT-PERSON-SECRET'), false, 'manna person-data reached disk via the finance seed');
});

// ───────────────────────── write-on-settle ─────────────────────────
test('finance: writes the seed on SETTLE (oneose), not during the backfill', () => {
  const ls = fakeLS();
  const { encSubscribe, subs } = loadFinance({ localStorage: ls });
  encSubscribe('finance/', () => {});
  subs[0].handlers.onevent(journalEv('CHURCH_A', 1, 'x'));
  assert.equal(ls.getItem(KEY('CHURCH_A')), null, 'wrote during the backfill — must wait for EOSE');
  subs[0].handlers.oneose();
  assert.ok(ls.getItem(KEY('CHURCH_A')), 'nothing was sealed on settle');
});

test('finance: the cb genuine flag is false for the seed/backfill and true ONLY after SETTLE (the write gate)', () => {
  const ls = seedFinance('CHURCH_A', [settingsEv('CHURCH_A'), journalEv('CHURCH_A', 1, 'm')]);
  const { encSubscribe, subs } = loadFinance({ localStorage: ls });
  const flags = [];
  encSubscribe('finance/', (items, genuine) => flags.push(genuine));
  assert.equal(flags[0], false, 'the seed paint must carry genuine=false (the seed feeds the display, not a write)');
  subs[0].handlers.onevent(journalEv('CHURCH_A', 2, 'm2'));
  assert.ok(!flags.includes(true), 'a pre-EOSE backfill delivery claimed genuine=true — a write would derive its seq from a partial book');
  subs[0].handlers.oneose();
  assert.equal(flags[flags.length - 1], true, 'the post-EOSE delivery must carry genuine=true');
});

// ───────────────────────── locked / isolation / church-in-seal ─────────────────────────
test('finance: a LOCKED key (no churchSk) reads the seed as ABSENT — Finance opens blank', () => {
  const ls = seedFinance('CHURCH_A', [settingsEv('CHURCH_A'), journalEv('CHURCH_A', 1, 'm')]);
  const { encSubscribe } = loadFinance({ localStorage: ls, churchSk: null });
  const paints = [];
  encSubscribe('finance/', (items) => paints.push(items));
  assert.ok(!paints.some(p => p.some(i => String(i.id).startsWith('journal:'))), 'a locked console painted the sealed book');
});

test('finance: church isolation — church B never paints or overwrites church A', () => {
  const ls = seedFinance('CHURCH_A', [settingsEv('CHURCH_A'), journalEv('CHURCH_A', 1, 'A-ENTRY')]);
  const before = ls.getItem(KEY('CHURCH_A'));
  const { encSubscribe, subs } = loadFinance({ localStorage: ls, pub: 'CHURCH_B' });
  const paints = [];
  encSubscribe('finance/', (items) => paints.push(items));
  assert.ok(!paints.some(p => p.some(i => String(i.id).startsWith('journal:'))), 'church B painted church A book');
  subs[0].handlers.onevent(journalEv('CHURCH_B', 1, 'B-ENTRY'));
  subs[0].handlers.oneose();
  assert.equal(ls.getItem(KEY('CHURCH_A')), before, 'church A seed was overwritten by church B');
  assert.ok(ls.getItem(KEY('CHURCH_B')), 'church B seed must be under its own key');
});

test('finance: a seed sealed for ANOTHER church is rejected (church bound inside the seal)', () => {
  const lsA = seedFinance('CHURCH_A', [settingsEv('CHURCH_A'), journalEv('CHURCH_A', 1, 'm')]);
  const aBlob = lsA.getItem(KEY('CHURCH_A'));
  const ls = fakeLS();
  ls.setItem(KEY('CHURCH_B'), aBlob);                 // A's sealed book copied under B's key (same fake churchSk)
  const { encSubscribe } = loadFinance({ localStorage: ls, pub: 'CHURCH_B' });
  const paints = [];
  encSubscribe('finance/', (items) => paints.push(items));
  assert.ok(!paints.some(p => p.some(i => String(i.id).startsWith('journal:'))), 'a foreign-church seed was painted — the cp-inside-seal check is not enforced');
});

// ───────────────────────── all-or-nothing cap ─────────────────────────
test('finance: an over-cap book is skipped ALL-OR-NOTHING — never a truncated journal on disk', () => {
  const evs = [settingsEv('CHURCH_A')];
  for (let s = 1; s <= 50; s++) evs.push(journalEv('CHURCH_A', s, 'entry ' + s));
  const ls = seedFinance('CHURCH_A', evs, { cap: 200 });   // 200-byte ceiling — the full book far exceeds it
  assert.equal(ls.getItem(KEY('CHURCH_A')), null, 'an over-cap book was persisted (a truncated journal) instead of skipped entirely');
});

// ───────────────────────── LEAKS ─────────────────────────
test('LEAKS: no finance memo/amount, no child name, no manna person reaches disk in cleartext', () => {
  const f = loadFinance();
  f.encSubscribe('finance/', () => {});
  f.subs[0].handlers.onevent(journalEv('CHURCH_A', 1, 'LEAK-MEMO', 424242));
  f.subs[0].handlers.oneose();
  for (const [, v] of f.localStorage.store) {
    assert.equal(String(v).includes('LEAK-MEMO'), false, 'finance memo in cleartext on disk: ' + v);
    assert.equal(String(v).includes('424242'), false, 'finance amount in cleartext on disk: ' + v);
  }
});
