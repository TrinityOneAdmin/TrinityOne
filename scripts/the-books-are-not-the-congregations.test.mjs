// THE CHURCH'S BOOKS ARE NOT THE CONGREGATION'S TO READ.
// Run: node --test scripts/the-books-are-not-the-congregations.test.mjs
//
// MEASURED ON A LIVE RELAY, 2026-09-16, BEFORE THE FIX: an ordinary member of a church — not a steward, not
// the treasurer — asked for the church's finance documents and was SERVED them:
//
//     finance/journal:1   served      finance/account:a1   served
//     finance/journal:2   served      finance/settings     served
//
// The controls in the same run said the boundary was real but in the wrong place: an anonymous client got
// nothing, and a member of no church got nothing. So the line the relay was drawing was "any authenticated
// member of this church", and the line it should draw is "the church, its network, and a steward holding
// Finance" — the same principals the WRITE gate already names.
//
// WHAT LEAKED, said plainly, because overclaiming it would be worse than the bug. The entries are sealed
// with the finance capability key, which is wrapped to the church and to stewards holding Finance and to
// nobody else, so a member could not read a single amount. What a member COULD read is the SHAPE of the
// books, in the clear, off the address and the timestamp: how many entries there are, when each was written,
// how often the treasurer posts, which accounts exist and which funds. For a church under pressure that is a
// map of its money without a penny of it.
//
// AND scripts/trinity-doc-types.mjs HAS DECLARED `finance/journal:` AS `read: 'church'` THE WHOLE TIME. The
// declaration was a description of a rule the relay never had. The code wins, so the declaration was a lie;
// this file is what makes it true.
//
// EVERY ASSERTION BELOW RUNS AGAINST A REAL GATEWAY PROCESS over a real websocket with real signed events,
// and every refusal is measured beside a grant PROVING THE SAME DOCUMENT EXISTS. A read gate that is
// default-deny will report a perfect score to a test that forgot to authenticate, or that asked for a
// document nobody ever wrote, so each refusal here is paired with a re-anchor in the same run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';
import { D } from './trinity-doc-types.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const PORT = 19217;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs — deliberately far above the
                      // 8800-9400 block so a concurrent suite in another worktree cannot collide with it
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

// THE BOOKS' KEY. In the shipped product this is minted by the owner console and wrapped to the church and
// to every steward holding Finance (trinityone/financekey:). The relay never sees it and cannot read a
// single entry — which is exactly why the SHAPE of the ledger is what this file is about.
const BOOKS_KEY = '7a'.repeat(32);
const seal = obj => nip44.encrypt(JSON.stringify(obj), unhex(BOOKS_KEY));

// THE CAST. Named for what each one proves.
const church = K();
const treasurer = K();   // a steward the church ticked for FINANCE — the books are her job
const sgLead = K();      // a steward ticked for SAFEGUARDING and nothing else — a steward is not a treasurer
const mary = K();        // AN ORDINARY MEMBER. The whole defect, in one person.
const olive = K();       // held Finance, wrote entry 1, and is no longer on the steward roster at all.
                         // Her entry must still be served to the church, or the months she served vanish.
const nomad = K();       // a member of NO church — the control that says the gate is not simply off

const cp = church.pub;
let relay, dataDir, w;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
const authFrame = (challenge, sk) => finalizeEvent(
  { kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', challenge]], content: '' }, sk);

// A socket that AUTHENTICATES as `who` before its write — the finance write gate is authed-only.
async function publishAs(who, e) {
  const s = await conn();
  const authed = new Promise(res => {
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', authFrame(m[1], who.sk)])); res(true); } };
    s.on('message', on); setTimeout(() => res(false), 400);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await authed; await sleep(80);
  const out = await send(s, e);
  s.close();
  return out;
}
function req(s, sub, f, sk, ms = 700) {
  return new Promise(res => { const out = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', authFrame(m[1], sk)])); };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms); });
}
// Ask AS somebody. ONE SOCKET PER QUESTION, so a stale AUTH from an earlier question can never make a
// refusal look like a grant — or a grant look like a refusal.
async function asks(who, filter) {
  const s = await conn();
  if (who) await req(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 300);   // provoke + answer the challenge
  const got = await req(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who && who.sk);
  s.close();
  return got;
}
const byD = d => ({ kinds: [30078], '#d': [d] });

const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
// A finance document as the console writes one: sealed under the books' key, with the church named in a
// ['church'] tag (that tag is how a steward-authored doc says which church's books these are).
const fin = (who, d, body, at) => finalizeEvent({ kind: 30078, created_at: at || now(),
  tags: [['d', d], ['t', NET], ['church', cp]], content: seal(body) }, who.sk);
const roster = (pubkeys, caps, at) => finalizeEvent({ kind: 30078, created_at: at,
  tags: [['d', D.STEWARDS + cp], ['t', NET]], content: JSON.stringify({ pubkeys, caps }) }, church.sk);

// THE FOUR DOCUMENT FAMILIES THE MODULE HAS. Exempting the journal alone would leave a member reading the
// chart of accounts and the fund list, which is most of the same disclosure by another route.
const A1 = 'finance/account:a1', F1 = 'finance/fund:f1', SET = 'finance/settings';
const J1 = D.FIN_JOURNAL + '1', J2 = D.FIN_JOURNAL + '2';
const EVERY_FINANCE_DOC = [J1, J2, A1, F1, SET];

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
}

before(async () => {
  await requireFreePort(PORT, 'the-books-are-not-the-congregations.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-books-'));
  await boot();
  w = await conn();

  // everyone but nomad joins the congregation
  for (const who of [treasurer, sgLead, mary, olive]) await send(w, doc(who, D.MEMBER + cp, { joined: now() }));

  const t = now();
  // THE ROSTER AS IT WAS. Olive holds Finance and writes entry 1.
  await send(w, roster([treasurer.pub, sgLead.pub, olive.pub],
    { [treasurer.pub]: ['finance'], [sgLead.pub]: ['safeguarding'], [olive.pub]: ['finance'] }, t - 10));
  await sleep(150);
  const [ok1, why1] = await publishAs(olive, fin(olive, J1, { seq: 1, memo: 'Harvest offering' }, t - 9));
  assert.equal(ok1, true, 'the fixture could not write entry 1 as a finance steward: ' + why1);

  // THE ROSTER AS IT IS. Olive has left the church's leadership entirely — the hardest version of "narrowed
  // away", because it is the one the general retraction rule would bite on.
  await send(w, roster([treasurer.pub, sgLead.pub],
    { [treasurer.pub]: ['finance'], [sgLead.pub]: ['safeguarding'] }, t + 1));
  await sleep(150);

  for (const [d, body] of [[J2, { seq: 2, memo: 'Hall hire' }], [A1, { code: '1000', name: 'Bank', type: 'asset' }],
                           [F1, { name: 'Building fund', kind: 'restricted' }], [SET, { baseCurrency: 'GBP', decimals: 2 }]]) {
    const [ok, why] = await publishAs(treasurer, fin(treasurer, d, body, t + 2));
    assert.equal(ok, true, `the fixture could not write ${d} as the treasurer: ` + why);
  }
  // The books' key envelope, as the owner console mints it. Served to MEMBERS on purpose — a recipient can
  // only ever unwrap their own slot — and used below as the proof that an ordinary member really did
  // authenticate, so that a zero from the finance documents is a refusal and not a dead socket.
  await send(w, doc(church, D.FINANCEKEY + cp, { rev: 1, keys: { [cp]: 'ct-church', [treasurer.pub]: 'ct-fin' } }));
  await sleep(300);
});
after(() => { try { w && w.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE DOOR ──────────────────────────────────────────────────────────────────────────────────────────────

test('the treasurer is served every finance document — without this every refusal below is vacuous', async () => {
  for (const d of EVERY_FINANCE_DOC) {
    const got = await asks(treasurer, byD(d));
    assert.equal(got.length, 1, `the treasurer was not served ${d}. Either the fixture never wrote it, or the ` +
      'gate now blinds the one person whose job this is — and every "a member gets zero" assertion in this ' +
      'file would pass for the wrong reason.');
  }
});

test('an ordinary member is served NONE of the church\'s books', async () => {
  // THE PROOF THAT SHE IS REALLY LOGGED IN, first. canRead() is default-deny for kind-30078, so a test that
  // silently failed to answer the AUTH challenge would score a perfect zero against a completely open gate.
  const proof = await asks(mary, byD(D.FINANCEKEY + cp));
  assert.equal(proof.length, 1, 'the ordinary member was served nothing at all, so she is not authenticated ' +
    'and every zero below proves nothing. Fix the AUTH handshake in this file before reading further.');

  for (const d of EVERY_FINANCE_DOC) {
    assert.deepEqual(await asks(mary, byD(d)), [],
      `an ordinary member of the church was served ${d}. The entries are sealed, so she reads no amount — ` +
      'but the address and the timestamp are in the clear, so she reads how many entries the books hold, ' +
      'when each was written, how often the treasurer posts, and which accounts and funds exist.');
  }
});

test('a whole-ledger sweep returns nothing to an ordinary member', async () => {
  // The single-document questions above are how an auditor asks. THIS is how an attacker asks: one REQ for
  // the whole kind, no d-tag at all. A gate that answered the narrow question and leaked to the broad one
  // would be worse than no gate, because it would test green for ever.
  const got = await asks(mary, { kinds: [30078], '#church': [cp] });
  const finance = got.filter(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith('finance/'));
  assert.deepEqual(finance.map(e => (e.tags.find(t => t[0] === 'd') || [])[1]).sort(), [],
    'an ordinary member swept the church corpus and the books came back in the results');
  const asTreasurer = await asks(treasurer, { kinds: [30078], '#church': [cp] });
  assert.ok(asTreasurer.some(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith('finance/')),
    're-anchor: the same sweep returns no finance document to the TREASURER either, so the zero above is ' +
    'the filter failing, not the gate holding');
});

test('a steward the church ticked for SAFEGUARDING and not Finance is not served the books', async () => {
  // Deliberate, and it mirrors the write gate exactly: accept() admits `e.pubkey === cp ||
  // stewardCan(e.pubkey, cp, 'finance')` and nobody else, so the read side names the same principals. A
  // church that writes a capability list has said what each steward does; a safeguarding lead is not the
  // treasurer. (A steward with NO capability list recorded still holds everything — see the test below.)
  const proof = await asks(sgLead, byD(D.FINANCEKEY + cp));
  assert.equal(proof.length, 1, 're-anchor: the safeguarding lead is not authenticated, so her zeroes prove nothing');
  for (const d of EVERY_FINANCE_DOC) {
    assert.deepEqual(await asks(sgLead, byD(d)), [],
      `a steward ticked only for safeguarding was served ${d}`);
  }
});

test('an outsider and an anonymous client are served nothing — the controls', async () => {
  for (const d of EVERY_FINANCE_DOC) {
    assert.deepEqual(await asks(nomad, byD(d)), [], `a member of no church was served ${d}`);
    assert.deepEqual(await asks(null, byD(d)), [], `an anonymous client was served ${d}`);
  }
});

// ── THE HISTORY THAT A CARELESS FIX DELETES ───────────────────────────────────────────────────────────────

test('an entry written by a treasurer who has since LEFT THE ROSTER is still served to the church', async () => {
  // This is `retractionExempt`, and it is the invariant a tidy-looking fix breaks. canRead() stops serving
  // anything authored by somebody no longer acting for the church — right for a group or a rota, and for the
  // JOURNAL it deletes history: the church opens its accounts and the months Olive served are simply
  // missing, with the surrounding sequence numbers still there. The journal is append-only and the relay
  // pins every entry to an exact next sequence number, so there is nothing to retract.
  //
  // Olive is OFF the steward roster at this point in the run (the fixture replaced it above), which is what
  // makes the assertion able to fail.
  const asChurch = await asks(church, byD(J1));
  assert.equal(asChurch.length, 1, 'the church cannot read an entry its own former treasurer wrote. The ' +
    'months she served have vanished from the accounts, with the sequence numbers either side still there.');
  assert.deepEqual(JSON.parse(nip44.decrypt(asChurch[0].content, unhex(BOOKS_KEY))), { seq: 1, memo: 'Harvest offering' },
    "the entry served is not the one Olive wrote, so this test is not measuring what it says");
  const asTreasurer = await asks(treasurer, byD(J1));
  assert.equal(asTreasurer.length, 1, "the SITTING treasurer cannot read her predecessor's entries — the " +
    'ledger she opens starts halfway through');
  // …and the narrowing still applies to it, so this exemption is not a hole of its own.
  assert.deepEqual(await asks(mary, byD(J1)), [], 'a departed treasurer\'s entry is served to the congregation');
});

test('a steward with NO capability list recorded still reads the books', async () => {
  // COMPATIBILITY, and it is the load-bearing half. CAP_KEYS.finance is `legacy: true, explicit: false`: a
  // steward appointed before capabilities existed holds the books' key TODAY. If this gate asked
  // stewardCanExplicitly() instead of stewardCan(), the first church to update its relay would find its
  // working treasurer staring at an empty ledger — an availability failure dressed up as security, and
  // exactly the failure the capability layer's own compatibility branch exists to prevent.
  const gwen = K();
  await send(w, doc(gwen, D.MEMBER + cp, { joined: now() }));
  await send(w, roster([treasurer.pub, sgLead.pub, gwen.pub],
    { [treasurer.pub]: ['finance'], [sgLead.pub]: ['safeguarding'] }, now() + 20));   // gwen: no caps entry at all
  await sleep(250);
  assert.equal((await asks(gwen, byD(J2))).length, 1,
    'a steward the church never gave a capability list was refused the books. Every church that appointed a ' +
    'treasurer before capabilities existed loses its accounts the moment this relay updates.');
  // put the roster back, so no later test inherits gwen
  await send(w, roster([treasurer.pub, sgLead.pub],
    { [treasurer.pub]: ['finance'], [sgLead.pub]: ['safeguarding'] }, now() + 40));
  await sleep(250);
});

// ── THE POINT OF USE (CLAUDE.md rule 1) ───────────────────────────────────────────────────────────────────
//
// A well-tested gate nobody is required to consult is not a feature, and a gate that blinds the screen it
// guards is a worse bug than the leak. The console's finance page reads the ledger through ONE call —
// `S.encSubscribe('finance/', …)` in app/stew-finance.jsx — so the test below lifts the SHIPPED encSubscribe
// and encOpen out of vendor/steward.js and runs them against this same live relay, over a real websocket,
// authenticated as the treasurer. Delete the steward clause from the new gate and the treasurer's books go
// blank, which is what the sabotage run proves.
//
// It is lifted rather than text-matched because app/*.jsx ships unbundled: `false && ` in front of a
// condition leaves every word of it in place and any text-matching assertion still passes (CLAUDE.md rule 3).

// A pool that really talks to the relay, so the gate under test is the one deciding what arrives.
function livePool(who) {
  const open = [];
  return {
    closeAll: () => { for (const s of open) { try { s.close(); } catch {} } },
    subscribeMany(_relays, filters, h) {
      const id = 'p' + Math.random().toString(36).slice(2, 7);
      const p = conn().then(s => {
        open.push(s);
        s.on('message', d => { const m = JSON.parse(d);
          if (m[0] === 'EVENT' && m[1] === id) h.onevent(m[2]);
          else if (m[0] === 'EOSE' && m[1] === id) h.oneose && h.oneose();
          else if (m[0] === 'AUTH') s.send(JSON.stringify(['AUTH', authFrame(m[1], who.sk)])); });
        // warm the socket so the challenge is issued and answered BEFORE the real REQ goes out
        s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
        return sleep(300).then(() => { s.send(JSON.stringify(['REQ', id, ...filters])); return s; });
      });
      return { close() { p.then(s => { try { s.close(); } catch {} }); } };
    },
  };
}

// The SHIPPED reader, lifted whole, wired to the live pool. The only things stubbed are the console's own
// key ring (the relay never sees it) and the crypto shims the bundle names.
function consoleFinancePage(who) {
  const state = { finance: { ring: [BOOKS_KEY], docKeys: null, rev: 1, at: 0, checked: true } };
  const waiters = { finance: new Set() };
  const pool = livePool(who);
  const stubs = {
    _capState: state, _capWaiters: waiters,
    _capRingChanged: (k) => { for (const fn of waiters[k] || []) fn(); },
    actingChurch: cp, pub: who.pub, _careRoster: new Set(),
    relays: () => [WS_URL], NET, pool,
    nip44d: (c, k) => nip44.decrypt(c, k), _unhex: unhex,
    decrypt: (c, k) => nip44.decrypt(c, k),
    churchSkHeld: () => false,          // a DELEGATE console: the ring is all it has
    _encOpenSealedCopy: () => null,     // the check-in fallback, a no-op for 'finance' in the shipped code
    CAP_KEYS: { finance: { d: D.FINANCEKEY, cap: 'finance', legacy: true } },
    window: { Steward: {} },
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', `with (scope) { return { ${[['encSubscribe(prefix, cb, kind)', 'encSubscribe'], ['encOpen(kind', 'encOpen']].map(([s, n]) => fnBody(VENDOR, s, n)).join(',\n')} }; }`)(scope);
  Object.assign(stubs.window.Steward, api);
  return { api, pool };
}

// Open the page as `who` and return the rows the ledger would draw.
async function openFinancePage(who, prefix = 'finance/journal:') {
  const { api, pool } = consoleFinancePage(who);
  let rows = null;
  const off = api.encSubscribe(prefix, r => { rows = r; }, 'finance');
  await sleep(1500);
  off(); pool.closeAll();
  return rows;
}

test("the console's finance page still populates for the treasurer", async () => {
  const rows = await openFinancePage(treasurer);
  assert.ok(Array.isArray(rows) && rows.length > 0,
    'the treasurer opened the church books and the ledger was EMPTY. The gate is refusing the one person ' +
    'whose job this is, and on screen that looks like a church that has never recorded a penny — no error, ' +
    'no empty-state, nothing to tell her the relay is withholding it.');
  assert.deepEqual(rows.map(r => r.memo).sort(), ['Hall hire', 'Harvest offering'],
    "the treasurer's ledger is missing entries. Her predecessor's are the ones at risk: they are authored " +
    'by somebody no longer on the roster.');
});

test("the console's finance page draws NOTHING for an ordinary member", async () => {
  // The same shipped reader, the same relay, the same church — only the person differs. This is the leak as
  // the member's own device would have experienced it, rather than as a hand-built REQ.
  const rows = await openFinancePage(mary);
  assert.deepEqual(rows, [], 'an ordinary member ran the console\'s own ledger reader against the church ' +
    'relay and the entries came back');
});

test("the whole finance module — not just the journal — is drawn for the treasurer and not for a member", async () => {
  // app/stew-finance.jsx subscribes to the prefix 'finance/', not to 'finance/journal:', so the accounts,
  // the funds and the settings travel on the same subscription and must be gated with it.
  const mine = await openFinancePage(treasurer, 'finance/');
  assert.ok(mine.length >= 5, 'the treasurer is not served the whole finance module: got ' + mine.length +
    ' documents, expected the two entries plus the account, the fund and the settings');
  assert.deepEqual(await openFinancePage(mary, 'finance/'), [],
    'an ordinary member is served part of the finance module — the chart of accounts and the fund list are ' +
    'the same disclosure by another route');
});
