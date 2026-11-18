// A HELPER (A DELEGATED STEWARD) MUST BE ABLE TO SEND THE CHURCH'S VERSE PROMPT, AND IT MUST REACH A MEMBER.
//   Run: node --test scripts/a-helpers-verse-prompt-reaches-a-member-phone.test.mjs
//
// RETEST-vp-other-2026-11-18 (TrinityOne-internal/reference): a helper holding every capability pressed
// "Set for church" on Resources > Verse prompt and the relay answered
// `OK false "blocked: not a member or not permitted for this group"`. The relay had no write rule for the
// bare d-tag `trinityone/verse-prompt`, so the helper's copy (signed by her OWN key, naming the church with
// feChurch()'s ['church', <cp>] tag) fell to the member catch-all and was refused — while the same helper's
// devotional, through the same console, was accepted. Every reader already trusted a rostered steward's copy.
//
// ── HOW THIS ASSERTS ─────────────────────────────────────────────────────────────────────────────────────
// A REAL relay (scripts/gateway.mjs) on a private data dir. The console half drives the SHIPPED
// publishVersePrompt / subscribeVersePrompt / feChurch lifted out of vendor/steward.js, publishing over a real
// websocket. The member half reads the relay over a real, NIP-42-authenticated SimplePool as a plain member,
// using the docs hub's own two filters (`authors:[cp]` / `'#church':[cp]`, src/fellowship.src.js
// _docsHubOpen), and feeds what the relay actually served into the SHIPPED subscribeChurchVersePrompt and
// _churchVoice lifted out of vendor/fellowship.js, with the roster taken from the relay's own stewards: doc.
// So deleting the relay rule makes the helper's publish return false AND leaves the member's card on the
// church's older prompt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';

const PORT = 19947;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', STEWARDS_D = 'trinityone/stewards:';
const VP_D = 'trinityone/verse-prompt';
const STEWARD_VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOWSHIP_VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church  = K();   // church A — the owner's laptop holds this key
const harriet = K();   // a helper of church A holding 'content' (the Resources tab's capability)
const carl    = K();   // a helper of church A holding only 'care'
const rob     = K();   // an ordinary member of church A
const other   = K();   // church B, on the same relay
const eve     = K();   // a content helper of church B, and of nothing else
const cp = church.pub;

let _t = Math.floor(Date.now() / 1000) - 400; const now = () => ++_t;
let relay, dataDir, ws;

const connect = () => new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
const send = (sock, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { sock.off('message', on); res([m[2], m[3] || '']); } }; sock.on('message', on); sock.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra], content: JSON.stringify(content) }, who.sk);
const prompt = (who, ref, extra = []) => doc(who, VP_D, { ref, note: '' }, extra);

before(async () => {
  await requireFreePort(PORT, 'a-helpers-verse-prompt-reaches-a-member-phone.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-helper-vp-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp) + ',' + npubEncode(other.pub), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {} await sleep(200); }
  ws = await connect();
  for (const c of [church, other]) assert.equal((await send(ws, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]], content: JSON.stringify({ name: 'Church' }) }, c.sk)))[0], true, 'church profile');
  for (const who of [harriet, carl, rob]) assert.equal((await send(ws, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined A');
  assert.equal((await send(ws, doc(eve, MEMBER_D + other.pub, { joined: now() })))[0], true, 'joined B');
  assert.equal((await send(ws, doc(church, STEWARDS_D + cp, { pubkeys: [harriet.pub, carl.pub], caps: { [harriet.pub]: ['content'], [carl.pub]: ['care'] } })))[0], true, 'roster A');
  assert.equal((await send(ws, doc(other, STEWARDS_D + other.pub, { pubkeys: [eve.pub], caps: { [eve.pub]: ['content'] } })))[0], true, 'roster B');
  // the church's own prompt, as the owner console sends it — the "before" the member sees
  assert.equal((await send(ws, prompt(church, 'John 3:16')))[0], true, 'the church key’s own prompt');
  await sleep(300);
});
after(async () => { try { ws && ws.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── the shipped console, lifted out of vendor/steward.js, on a REAL SimplePool against the REAL relay ──────
function consoleApi({ signer, actingChurch }) {
  const pool = new SimplePool();
  pool.automaticallyAuth = (_url) => async (authEvent) => finalizeEvent(authEvent, signer.sk);   // plumbing: answers the relay's NIP-42 challenge
  const ls = new Map();
  const scope = {
    sk: signer.sk, pub: cp, actingChurch,
    pool, relays: () => [WS_URL],
    NET, VERSE_PROMPT_D: VP_D,
    _monotonic: (t) => t,
    now,
    lsGet: (k) => (ls.has(k) ? ls.get(k) : null), lsSet: (k, v) => { ls.set(k, v); },
    localStorage: { removeItem: (k) => ls.delete(k) },
    sent: [], results: [],
    publish: async (evt) => { scope.sent.push(evt); const r = await send(ws, evt); scope.results.push(r); return r[0] ? evt : null; },
  };
  const feBody = fnBody(STEWARD_VENDOR, 'function feChurch(tmpl, signer) {', 'feChurch');
  const signerName = (/return\s+(finalizeEvent\w*)\s*\(/.exec(feBody) || [])[1];
  assert.ok(signerName, 'feChurch in vendor/steward.js no longer ends by calling finalizeEvent — re-anchor this fixture');
  scope[signerName] = finalizeEvent;
  const pvBody = fnBody(STEWARD_VENDOR, 'publishVersePrompt(ref, note, schedule) {', 'publishVersePrompt');
  const svBody = fnBody(STEWARD_VENDOR, 'subscribeVersePrompt(cb) {', 'subscribeVersePrompt');
  Object.assign(scope, new Function('scope', `with (scope) { ${feBody}
    return ({ ${pvBody},\n ${svBody} }); }`)(scope));
  return scope;
}
function settle(sub, ms = 1500) {
  return new Promise((resolve) => { let last; const unsub = sub((m) => { last = m; }); setTimeout(() => { unsub(); resolve(last); }, ms); });
}

// ── the shipped member reader, fed by what the REAL relay serves a plain member ────────────────────────────
async function relayServesMember(who) {
  const pool = new SimplePool();
  pool.automaticallyAuth = (_url) => async (authEvent) => finalizeEvent(authEvent, who.sk);
  const got = new Map();
  const sub = pool.subscribeMany([WS_URL], [{ kinds: [30078], authors: [cp], '#t': [NET] }, { kinds: [30078], '#church': [cp], '#t': [NET] }],
    { onevent(e) { got.set(e.id, e); } });
  await sleep(1500);
  try { sub.close(); } catch {} try { pool.close([WS_URL]); } catch {}
  return [...got.values()];
}
async function memberCard(who) {
  const events = await relayServesMember(who);
  const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
  const rosterDoc = events.filter(e => dOf(e) === STEWARDS_D + cp && e.pubkey === cp).sort((a, b) => b.created_at - a.created_at)[0];
  const roster = new Set(rosterDoc ? (JSON.parse(rosterDoc.content).pubkeys || []) : []);
  let handler = null;
  const stubs = { toPub: () => cp, _churchRoster: new Map([[cp, roster]]), _onChurchDocs: (_cp, h) => { handler = h; return () => {}; } };
  const cvBody = fnBody(FELLOWSHIP_VENDOR, 'function _churchVoice(cp, doc) {', '_churchVoice');
  const scBody = fnBody(FELLOWSHIP_VENDOR, 'subscribeChurchVersePrompt(churchNpub, cb) {', 'subscribeChurchVersePrompt');
  const names = Object.keys(stubs);
  const built = new Function(...names, `${cvBody}\n return ({ ${scBody} });`)(...names.map(k => stubs[k]));
  let card;
  built.subscribeChurchVersePrompt('npub1c', (v) => { card = v; });
  for (const e of events.sort((a, b) => a.created_at - b.created_at)) handler.onevent(e, dOf(e));
  handler.oneose();
  return { card, events };
}

// ══════════════════════════════════════════════ POSITIVE ══════════════════════════════════════════════
test('POINT OF USE: a content helper’s console sends a verse prompt and the relay STORES it', async () => {
  const hc = consoleApi({ signer: harriet, actingChurch: cp });
  const out = await hc.publishVersePrompt('Romans 8:28', '');
  assert.equal(hc.sent[0].pubkey, harriet.pub, 'fixture: a delegated console signs with the helper’s own key');
  assert.equal((hc.sent[0].tags.find(t => t[0] === 'church') || [])[1], cp, 'fixture: the console names the church');
  assert.equal(hc.results[0][0], true,
    'THE RELAY REFUSED A CONTENT HELPER’S VERSE PROMPT — the RETEST-vp-other-2026-11-18 bug. Reply: ' + JSON.stringify(hc.results[0]));
  assert.ok(out && out.ref === 'Romans 8:28', 'publishVersePrompt did not resolve with the prompt: ' + JSON.stringify(out));
  await sleep(300);
});

test('POINT OF USE: a MEMBER’S phone shows the helper’s prompt (served by the relay, trusted by the app)', async () => {
  const { card, events } = await memberCard(rob);
  assert.ok(events.some(e => e.pubkey === harriet.pub && (e.tags.find(t => t[0] === 'd') || [])[1] === VP_D),
    'the relay did not SERVE the helper’s prompt to a member of the church (canRead): ' + events.length + ' events served');
  assert.ok(card && card.ref === 'Romans 8:28',
    'the member’s Verse prompt card is not showing the helper’s newer prompt: ' + JSON.stringify(card));
});

test('POINT OF USE: the OWNER’S console sees the helper’s prompt as the current one', async () => {
  const oc = consoleApi({ signer: church, actingChurch: '' });
  const cur = await settle(oc.subscribeVersePrompt);
  assert.ok(cur && cur.ref === 'Romans 8:28', 'the owner console still shows an older prompt: ' + JSON.stringify(cur));
});

test('the church key’s own prompt is still accepted (unchanged path)', async () => {
  assert.equal((await send(ws, prompt(church, 'Psalm 23:1')))[0], true);
});

// ══════════════════════════════════════════════ NEGATIVE ══════════════════════════════════════════════
test('REFUSED: a plain member of the church (not a steward), naming the church', async () => {
  const [ok, why] = await send(ws, prompt(rob, 'Forged 1:1', [['church', cp]]));
  assert.equal(ok, false, 'the relay stored a plain member’s verse prompt: ' + why);
});

test('REFUSED: a plain member naming no church', async () => {
  const [ok, why] = await send(ws, prompt(rob, 'Forged 1:2'));
  assert.equal(ok, false, 'the relay stored a plain member’s untagged verse prompt: ' + why);
});

test('REFUSED: a content helper of ANOTHER church naming this one — and accepted for her own (control)', async () => {
  const [ok, why] = await send(ws, prompt(eve, 'Forged 1:3', [['church', cp]]));
  assert.equal(ok, false, 'a steward of church B wrote church A’s verse prompt: ' + why);
  const [okOwn, whyOwn] = await send(ws, prompt(eve, 'Mark 1:1', [['church', other.pub]]));
  assert.equal(okOwn, true, 'control: church B’s own content helper was refused for church B, so the refusal above proves nothing: ' + whyOwn);
});

test('REFUSED: a helper of this church WITHOUT the content capability (care only)', async () => {
  const cc = consoleApi({ signer: carl, actingChurch: cp });
  await cc.publishVersePrompt('Forged 1:4', '');
  assert.equal(cc.results[0][0], false, 'a care-only helper wrote the church’s verse prompt: ' + JSON.stringify(cc.results[0]));
});

test('REFUSED: the content helper naming no church at all', async () => {
  const [ok, why] = await send(ws, prompt(harriet, 'Forged 1:5'));
  assert.equal(ok, false, 'an untagged verse prompt from a steward was stored: ' + why);
});

test('none of the refused prompts reaches a member’s phone', async () => {
  const { card, events } = await memberCard(rob);
  const refs = events.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1] === VP_D).map(e => JSON.parse(e.content || '{}').ref);
  assert.ok(!refs.some(r => /^Forged/.test(r || '')), 'a refused prompt was served: ' + JSON.stringify(refs));
  assert.equal(card && card.ref, 'Psalm 23:1', 'the member’s card is not the newest TRUSTED prompt: ' + JSON.stringify(card));
});
