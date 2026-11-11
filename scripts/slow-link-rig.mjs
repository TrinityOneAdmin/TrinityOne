// RIG: the real console, on a real gateway, through a SMALL PIPE (scripts/slow-link-proxy.mjs). Not a test.
//
// openSlowConsole() starts a real gateway (scripts/gateway.mjs, or `entry` — another tree's gateway, which then
// serves THAT tree's console bundle), puts the slow-link proxy in front of it, opens steward.html THROUGH the
// proxy in headless chromium, and makes a church the real way (Start a new church, PIN, name, recovery words,
// Skip setup). The console's own relay is its page origin, so every relay socket it opens crosses the pipe.
//
// It records, per relay socket the browser opened (CDP requestId): decompressed bytes and EVENT frames the
// console received, and every EVENT it SENT (d-tag + time) — so a test can count writes such as pubevent:.
// The proxy records the wire bytes and the relay's own close codes.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { getPublicKey } from 'nostr-tools/pure';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import * as H from './relay-network-harness.mjs';
import { startSlowLink } from './slow-link-proxy.mjs';
import { CHROME, PIN, typePh, typeInto, sleep } from './new-church-session.mjs';
export { H, CHROME, sleep };

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;

export async function openSlowConsole({ entry, name = 'slow', rate = 64 * 1024 * 1024 } = {}) {
  if (!CHROME) throw new Error('no chromium');
  const t0 = Date.now();
  // the proxy first: the relay proves its identity only at an address it DECLARES (RELAY_PUBLIC_URL), and the console
  // dials the proxy — so the relay must be told the proxy's address before it boots
  const link = await startSlowLink({ rate });
  const base = `http://127.0.0.1:${link.port}`;
  const relay = await H.startRelay({ name, entry: entry || undefined, env: { TRINITY_TAILSCALE_BIN: '/nonexistent', RELAY_PUBLIC_URL: `ws://127.0.0.1:${link.port}/relay` } });
  link.target = relay.port;
  const cdp = await H.freePort('the slow-link console Chrome debug port');
  const prof = mkdtempSync(join(tmpdir(), 'trin-slow-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${base}/steward.html`], { stdio: 'ignore' });
  let cws = null;
  const s = { relay, link, base, t0, sockets: new Map(), sent: [], errors: [], churchPub: '', mnemonic: '', lastRx: 0 };
  // wait until the relay sockets have carried nothing for `quietMs` (or `maxMs` passes); resolves true if it went quiet
  s.quiet = async (quietMs = 6000, maxMs = 90000) => { const tt = Date.now(); await sleep(1000); while (Date.now() - tt < maxMs) { if (Date.now() - Math.max(s.lastRx, s.link.lastDown || 0) >= quietMs) return true; await sleep(500); } return false; };
  s.close = async () => {
    try { cws && cws.close(); } catch {}
    try { chr.kill('SIGKILL'); } catch {}
    try { await link.close(); } catch {}
    relay.stop();
    await sleep(600);
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
  };
  try {
    let targets = null;
    for (let i = 0; i < 60 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
    if (!targets || !targets.length) throw new Error('chromium never exposed a debug target');
    const page = targets.find(t => t.type === 'page') || targets[0];
    cws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { cws.on('open', res); cws.on('error', rej); });
    let id = 0; const pend = new Map();
    const relayUrl = `127.0.0.1:${link.port}`;
    cws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; s.errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
      if (m.method === 'Network.webSocketCreated' && m.params.url.includes(relayUrl)) s.sockets.set(m.params.requestId, { opened: Date.now() - t0, closed: 0, bytes: 0, events: 0, reqs: [], bySub: {} });
      if (m.method === 'Network.webSocketClosed') { const k = s.sockets.get(m.params.requestId); if (k) k.closed = Date.now() - t0; }
      if (m.method === 'Network.webSocketFrameReceived') {
        const k = s.sockets.get(m.params.requestId); if (!k) return;
        const p = m.params.response.payloadData || ''; k.bytes += p.length; s.lastRx = Date.now();
        if (p.startsWith('["EVENT"')) {
          k.events++;
          const sid = (/^\["EVENT","([^"]*)"/.exec(p) || [])[1] || '?';
          const b = (k.bySub[sid] ||= { bytes: 0, events: 0 }); b.bytes += p.length; b.events++;
        }
      }
      if (m.method === 'Network.webSocketFrameSent') {
        const k = s.sockets.get(m.params.requestId); if (!k) return;
        const p = m.params.response.payloadData || '';
        try {
          const j = JSON.parse(p);
          if (j[0] === 'REQ') k.reqs.push({ sid: j[1], filters: j.slice(2), t: Date.now() - t0 });
          if (j[0] === 'EVENT' && j[1] && j[1].tags) s.sent.push({ t: Date.now() - t0, kind: j[1].kind, d: ((j[1].tags.find(x => x[0] === 'd') || [])[1]) || '', id: j[1].id });
        } catch {}
      }
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); cws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable'); await send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
    s.ev = async (expression) => {
      const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
      return rr?.result?.result?.value;
    };
    s.waitFor = async (expr, ms = 60000, label = expr) => { const tt = Date.now(); while (Date.now() - tt < ms) { try { if (await s.ev(expr)) return true; } catch {} await sleep(300); } throw new Error('timed out waiting for: ' + label); };
    s.press = async (re, label) => { if (await s.ev(click(re)) !== 'ok') throw new Error('nothing on screen matched ' + (label || re)); await sleep(400); };

    await s.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
    await s.press(/Start a new church/i);
    await s.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
    await s.ev(typePh('At least 8', PIN)); await s.ev(typePh('Type it again', PIN));
    await s.press(/Set PIN/i);
    await s.waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
    s.churchPub = await s.ev(`window.Steward.churchPub`);
    s.mnemonic = await s.ev(`window.Steward.exportMnemonic()`);
    const sk = privateKeyFromSeedWords(s.mnemonic);
    if (getPublicKey(sk) !== s.churchPub) throw new Error('recovery words do not give the church key');
    s.church = { sk, pub: s.churchPub };
    await s.ev(typeInto('input[aria-label="Church name"]', 'Slow Pipe Church'));
    await s.press(/^Continue$/);
    await s.waitFor(`/12 words are your church/.test(document.body.innerText)`, 60000, 'the recovery step');
    await s.ev(`(() => { const i=document.querySelector('input[type=checkbox]'); if(!i.checked) i.click(); return 1; })()`);
    await sleep(500); await s.press(/^Continue$/);
    await s.waitFor(`/Quick check/.test(document.body.innerText)`, 30000, 'the quick check');
    const words = s.mnemonic.split(' ');
    await s.ev(`(() => { const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; const words=${JSON.stringify(words)}; const nums=[...document.body.innerText.matchAll(/WORD #(\\d+)/g)].map(m=>Number(m[1])); const ins=[...document.querySelectorAll('input')].filter(i=>i.type==='text').slice(0,3); ins.forEach((i,k)=>{set.call(i,words[nums[k]-1]); i.dispatchEvent(new Event('input',{bubbles:true}));}); return ins.length; })()`);
    await sleep(500); await s.press(/^Continue$/);
    await s.waitFor(`/Create a few spaces/.test(document.body.innerText)`, 30000, 'the rooms step');
    await s.press(/^Skip setup$/);
    await s.waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]') && !/Skip setup/.test(document.body.innerText)`, 30000, 'the dashboard');
  } catch (e) { await s.close(); throw e; }
  return s;
}

// ── A LIVING-WORD-SHAPED CHURCH ───────────────────────────────────────────────────────────────────────────────
// Measured on the live relay 2026-11-11: ~258 kind-30078 documents, ~1.0 MB — one ~376 KB devotional (plain text),
// one ~262 KB sealed document, the name-key and care-key envelopes, ~45 members' join + sealed-name documents,
// their clearances, a finance journal and accounts, plans, groups, events. This makes that SHAPE, every document
// written the way the real writer writes it: the console's own API in the page for everything a steward makes
// (so sealing, tags and the console's own follow-on writes — key envelopes, clearances — are real), and each
// member's own key for their join and name documents (the member app's exact tags and { c, m } sealing, sealed to
// the church because they are not yet admitted when they write it). Run it on a FAST link; slow the link after.
export async function seedChurch(s, { members = 30, journal = 60, accounts = 20, events = 20, plans = 8, groups = 8, devos = 5 } = {}) {
  const { finalizeEvent, nip44 } = await import('nostr-tools');
  const cp = s.churchPub, at = () => Math.floor(Date.now() / 1000);
  const ppl = [];
  for (let i = 0; i < members; i++) ppl.push(H.key());
  const seal = (body, a, b) => nip44.v2.encrypt(body, nip44.v2.utils.getConversationKey(a, b));
  const mine = [];
  for (const [i, m] of ppl.entries()) {
    mine.push(finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['p', cp]], content: JSON.stringify({ joined: at() }) }, m.sk));
    const body = JSON.stringify({ name: 'Member ' + (i + 1) + ' ' + ['Adeyemi', 'Brown', 'Chen', 'Davies', 'Evans', 'Fraser'][i % 6] });
    mine.push(finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/name:' + cp], ['t', 'trinityone'], ['church', cp]], content: JSON.stringify({ c: seal(body, m.sk, cp), m: seal(body, m.sk, m.pub) }) }, m.sk));
  }
  await H.publishAll(s.relay, mine);
  s.members = ppl;
  const words = (n) => { const w = ['grace', 'and', 'peace', 'to', 'you', 'from', 'God', 'our', 'Father', 'the', 'Lord', 'Jesus', 'Christ', 'who', 'gave', 'himself', 'for', 'sins', 'rescue', 'us', 'present', 'evil', 'age']; let o = ''; let k = 7; while (o.length < n) { k = (k * 1103515245 + 12345) % 2147483648; o += w[k % w.length] + ((k % 13) ? ' ' : '.\n'); } return o.slice(0, n); };
  const rnd = (n) => { const b = new Uint8Array(Math.ceil(n * 3 / 4)); for (let i = 0; i < b.length; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(b.length, i + 65536))); return Buffer.from(b).toString('base64').slice(0, n); };
  const img = 'data:image/jpeg;base64,' + rnd(190000);
  const r = await s.ev(`(async () => {
    const S = window.Steward, out = { fail: [] };
    const ok = (k, v) => { if (!v) out.fail.push(k); };
    ok('admitted', await S.setAdmitted(${JSON.stringify(ppl.map(m => m.pub))}));
    for (let i = 0; i < 40; i++) { if (await S.setWebsiteShare({ calendar: true })) { out.share = true; break; } await new Promise(r => setTimeout(r, 500)); }
    ok('devo-big', await S.publishDevotional({ title: 'Lent readings', ref: 'Galatians 1', text: ${JSON.stringify(words(376000))} }));
    for (let i = 0; i < ${devos - 1}; i++) ok('devo' + i, await S.publishDevotional({ id: 'devo-s' + i, title: 'Reflection ' + i, ref: 'Psalm ' + (20 + i), text: ${JSON.stringify(words(6000))} }));
    ok('event-image', await S.publishEvent({ title: 'Harvest supper', date: '2026-12-05', time: '18:30', where: 'Church hall', blurb: 'Bring a dish', image: ${JSON.stringify(img)} }));
    for (let i = 0; i < ${events - 1}; i++) ok('event' + i, await S.publishEvent({ title: 'Event ' + i, date: '2026-12-' + String(1 + (i % 28)).padStart(2, '0'), time: '19:00', where: 'Room ' + i, blurb: ${JSON.stringify(words(500))} }));
    for (let i = 0; i < ${plans}; i++) ok('plan' + i, await S.publishPlan({ id: 'plan-' + i, title: 'Plan ' + i, blurb: 'A reading plan', days: Array.from({ length: 30 }, (_, d) => ({ day: d + 1, ref: 'John ' + (d % 21 + 1), note: ${JSON.stringify(words(80))} })) }));
    for (let i = 0; i < ${groups}; i++) ok('group' + i, await S.publishGroup({ name: 'Group ' + i, sub: 'A small group', kind: 'group' }));
    for (let i = 0; i < ${accounts}; i++) ok('acct' + i, await S.encPublish('finance/account:a' + i, { code: String(1000 + i * 10), name: 'Account ' + i, type: ['asset', 'income', 'expense', 'liability'][i % 4], archived: false }));
    for (let i = 0; i < ${journal}; i++) ok('jnl' + i, await S.encPublish('finance/journal:' + (i + 1), { seq: i + 1, date: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), memo: 'Offering ' + (i + 1) + ' ' + ${JSON.stringify(words(300))}, postings: [{ acct: 'a0', amt: 12345 }, { acct: 'a1', amt: -12345 }], by: S.pubkey || '', ts: Date.now(), reverses: null, importKey: null, attachmentRefs: [], invoice: null, bill: null }));
    return JSON.stringify(out);
  })()`);
  return JSON.parse(r);
}

// What the relay holds for this church, by family: { docs, bytes, byFamily: { family: [n, bytes] } }. Read from the
// relay's own database (read-only), so it is the corpus a broad read could return, not what the console saw.
export async function corpusSize(s) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(s.relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT dtag, raw FROM events WHERE kind = 30078').all();
    const out = { docs: 0, bytes: 0, byFamily: {} };
    for (const r of rows) {
      const raw = String(r.raw || ''), d = String(r.dtag || '');
      const fam = d.replace(/[:].*$/, ':') || '(none)';
      out.docs++; out.bytes += raw.length;
      const f = (out.byFamily[fam] ||= [0, 0]); f[0]++; f[1] += raw.length;
    }
    return out;
  } finally { db.close(); }
}

// The Overview "Members" tile, read off the real screen: its value text ('Checking…', a count, '—'), or null if absent.
export const membersTile = (s) => s.ev(`(() => { const el = [...document.querySelectorAll('*')].find(x => x.children.length === 0 && (x.textContent || '').trim() === 'Members' && x.closest('button,[role=button],div') && x.parentElement && /reading your church|invite/.test(x.parentElement.parentElement ? x.parentElement.parentElement.innerText : '')); if (!el) return null; const box = el.parentElement.parentElement; const t = box.innerText.split('\\n').map(x => x.trim()).filter(Boolean); return t.find(x => x !== 'Members' && !/reading your church|invite/.test(x)) || null; })()`);
