// THE MEMBER ROW IS ONE LINE AT CONSOLE WIDTH (owner, 2026-10-13: "about 50% the height").
//   Run: node --test scripts/the-member-row-is-one-line-on-the-console.test.mjs
// Real steward.html off the real gateway in headless Chromium at 1280x900, the seeding copied from
// the-member-card-is-one-row-on-a-phone.test.mjs. It asserts what only a browser can see (height, one line);
// what the row SAYS is asserted by the-member-row-is-compact.test.mjs. Browser-rendered only: no device check.
// Skips itself when chromium is unavailable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { generateSeedWords, privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8872, CDP = 9373;   // 88xx: 8868 batch-a, 8869/8871 taken; 93xx taken: 9350-9358, 9360-9364, 9366-9372, 9381, 9412
// 9372 was free on this branch and ALSO chosen by the-pin-gate-goes-back-in-a-browser.test.mjs on another; the two
// only met at the integration merge, where a shared debug port deadlocked both files. scripts/test-ports.test.mjs
// caught it. Moved to 9373.
const ROOT = new URL('..', import.meta.url).pathname;
const VW = 360, VH = 730, LW = 730, LH = 328, DW = 1280, DH = 900;
const PIN = 'cedar-harbour-lamp-42';
const FLOOR = 44;       // the codebase's touch floor
const ROW_MAX = 72;     // the row budget: an avatar (36) with the card's padding and a 44px control beside it
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The church, and its people. Every pubkey is a stand-in the way batch-a's is; the names are what is read
// back off the screen, so each is distinct and none is a substring of another.
const WORDS = generateSeedWords();
const CHURCH_PK = getPublicKey(privateKeyFromSeedWords(WORDS));
const pk = (c) => c.repeat(64);
const NOW = Math.floor(Date.now() / 1000);
const PEOPLE = {
  adult:    { pubkey: pk('a'), name: 'Persephone Wilde', nip05: 'persephonewilde@example.org', joined: NOW - 19 * 3600 },
  adult2:   { pubkey: pk('b'), name: 'Tobias Ashcroft',  joined: NOW - 2 * 86400, count: 3, lastTs: NOW - 7200 },
  child:    { pubkey: pk('c'), name: 'Ivy Whitlock',     joined: NOW - 3 * 86400 },
  cleared:  { pubkey: pk('d'), name: 'Ruth Whitlock',    joined: NOW - 40 * 86400, count: 12, lastTs: NOW - 86400 },
  pending:  { pubkey: pk('e'), name: 'Nia Okafor',       joined: NOW - 600 },
  inactive: { pubkey: pk('f'), name: 'Gideon Marsh',     joined: NOW - 200 * 86400 },
};
// `cv: 2` is the stamp subscribeMembers puts on every roster row it caches (sim item 27, message-counts-do-not-climb-on-replay):
// a cached row WITHOUT it has its stored message count ignored, because an older build may have inflated it. These rows
// stand in for what the shipped code wrote, so they carry it — otherwise Ruth's cached 12 messages read as 0 and she is
// drawn with a "joined" pill she would never have on a real console.
const ROSTER = Object.values(PEOPLE).map(p => ({ npub: 'npub1' + p.pubkey.slice(0, 58), picture: '', count: 0, lastTs: 0, firstTs: 0, cv: 2, ...p }));
const ADMITTED = Object.entries(PEOPLE).filter(([k]) => k !== 'pending').map(([, p]) => p.pubkey);

let relay, chr, ws, dataDir, prof, evalIn, send, booted = '';
const errors = [];

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
  if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'the-member-row-is-one-line-on-the-console.test.mjs');
  await requireFreePort(CDP, 'the-member-row-is-one-line-on-the-console.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-member-row-'));
  // Chromium is pointed at a black hole for the production hosts: the console dials CANONICAL_RELAYS
  // regardless of who served the page (see app-boots.test.mjs). Nothing here reaches production.
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(CHURCH_PK), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-member-row-chr-' + process.pid);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, `--window-size=${VW},${VH}`,
    `http://127.0.0.1:${PORT}/steward.html?churchkey=${encodeURIComponent(WORDS)}`], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      errors.push((e.exception?.description || e.text || '').split('\n')[0]);
    }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

  // The forced PIN over a plaintext seed, then the dashboard. POLLED, not slept: the sibling files' fixed
  // 9s/13s lose the boot race under load (HANDOFF 2026-09-20).
  let pinned = 'miss';
  for (const t0 = Date.now(); pinned !== 'ok' && Date.now() - t0 < 60000;) { await sleep(500); pinned = await evalIn(type('At least 8', PIN)); }
  assert.equal(pinned, 'ok', 'no "Set a console PIN" field within 60s — the churchkey hook did not load the seed');
  await evalIn(type('Type it again', PIN));
  booted = await evalIn(click('/Set PIN/i'));
  let up = false;
  for (const t0 = Date.now(); !up && Date.now() - t0 < 60000;) { await sleep(500); up = await evalIn(`!!document.querySelector('button[aria-label="Sections"]') && window.Steward.churchPub === ${JSON.stringify(CHURCH_PK)}`); }
  assert.equal(up, true, 'the console did not reach its phone dashboard on the seeded church within 60s');

  // THE STATES, written by the console's own engine and accepted because this relay holds this church:
  // approval-to-join on, everyone but Nia admitted, Ivy a child, Ruth cleared. Each result is checked: a
  // refused write would leave the page painting a church with none of the rows this file measures.
  const seed1 = JSON.parse(await evalIn(`(async () => {
    const r = {};
    r.policy = await window.Steward.setJoinPolicy(true);
    r.group = await window.Steward.publishGroup({ name: 'Whole Church', kind: 'group' });
    return JSON.stringify(r); })()`));
  for (const [k, v] of Object.entries(seed1)) assert.notEqual(v, false, `the relay refused the ${k} seed: ${JSON.stringify(seed1)} — this is not this box's church`);
  // The list writers refuse until the console has AUTHENTICATED to a relay (_requireTrustedView), and the
  // relay's NIP-42 challenge is lazy: it comes only when a REQ names something it withholds from an anonymous
  // reader. A church that is seconds old has nothing to withhold — hence the one group above, the first thing
  // the wizard would have made — and the page's long-lived subscriptions were opened before it existed, so
  // opening a section (new REQs naming that group) is what draws the challenge, as it does for a steward.
  let authed = false;
  for (let i = 0; i < 6 && !authed; i++) {
    await openMenu(); await pickSection(i % 2 ? 'Overview' : 'Groups');
    for (const t0 = Date.now(); !authed && Date.now() - t0 < 5000;) { await sleep(300); authed = await evalIn(`!!(window.Steward.relayAuthed && window.Steward.relayAuthed())`); }
  }
  assert.equal(authed, true, 'the console never authenticated to its own relay — relayStatus: ' + await evalIn(`window.Steward.relayStatus().then(s => JSON.stringify(s))`));
  const seed2 = JSON.parse(await evalIn(`(async () => {
    const r = {};
    r.admitted = await window.Steward.setAdmitted(${JSON.stringify(ADMITTED)});
    r.minors = await window.Steward.setMinors([${JSON.stringify(PEOPLE.child.pubkey)}]);
    r.approved = await window.Steward.setApproved([${JSON.stringify(PEOPLE.cleared.pubkey)}], { listKnown: true });
    return JSON.stringify(r); })()`));
  for (const [k, v] of Object.entries(seed2)) assert.notEqual(v, false, `the relay refused the ${k} seed: ${JSON.stringify(seed2)}`);
  // The roster cache is written LAST and Members opened straight after it: subscribeMembers rewrites that
  // cache from its own map on every delivery, so a seed planted before the page's subscription settled was
  // overwritten by its first empty delivery. Opened this way the mount reads the seed into the map first.
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.members.' + window.Steward.churchPub, JSON.stringify(${JSON.stringify(ROSTER)})); return 'ok'; })()`);
  await openMembersOnPhone();
  // ROOM FOR THE LIST. The Members panel is the viewport's height and its list scrolls INSIDE it, under the
  // join queue, the cleared-list fold and the safeguarding note; the console also raises an alert of its own
  // here (the clearance backfill cannot reach members who exist only in a cache) that takes ~180px at the top
  // of the page. With both up, the list's scroll box was measured at 0px tall in this harness — every row laid
  // out and none of them on screen — so the alert is dismissed and the note put away (its ×, the same thing a
  // steward does once), exactly as batch-a does before measuring. Neither is under test here.
  await evalIn(`(() => { [...document.querySelectorAll('[role="alert"] button[aria-label^="Dismiss"], button[aria-label="Dismiss this note"]')].forEach(b => b.click()); return 'ok'; })()`);
  await sleep(600);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// ── the instrument ────────────────────────────────────────────────────────────────────────────────────────
const SKIP = { skip: !CHROME ? 'no chromium' : false, timeout: 300000 };
const setSize = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 1000 }); await sleep(900); };
const escape = async () => { await evalIn(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(600); };
async function openMenu() {
  const r = await evalIn(`(() => { const b = document.querySelector('button[aria-label="Sections"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', 'no ☰ ("Sections") control in the console\'s header — re-anchor this test');
  await sleep(700);
}
async function pickSection(label) {
  const r = await evalIn(`(() => { const b=[...document.querySelectorAll('[role="dialog"][aria-label="Sections"] nav[aria-label="Console sections"] button')].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" row in the console's sections menu — re-anchor this test`);
  await sleep(2000);
}
async function openMembersOnPhone() { await openMenu(); await pickSection('Overview'); await openMenu(); await pickSection('Members'); await sleep(1500); }

// A member's ROW is the nearest bordered ancestor of the node carrying their name — the card, whatever it is
// built from. Read back: its rect, every control in it by accessible name, the sk-pill tags, its text, and
// for each 44px control the share of a 4px grid over it that elementFromPoint hands back to it. `scroll`
// brings the row into view first: the list scrolls inside its panel, and a grid over a row below the fold
// reaches nothing. Row 1 measures WITHOUT it, so the rows' tops are read in one scroll position.
const ROW_OF = (name, scroll) => `(() => {
  const NAME = ${JSON.stringify(name)};
  const main = document.querySelector('main') || document.body;
  const nm = [...main.querySelectorAll('span, div')].find(s => (s.textContent || '').trim() === NAME && s.children.length === 0 && !s.closest('[role="dialog"]'));
  if (!nm) return JSON.stringify({ found: false });
  let el = nm; while (el && el !== document.body && getComputedStyle(el).borderTopWidth === '0px') el = el.parentElement;
  if (${scroll ? 'true' : 'false'}) el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const label = (b) => (b.getAttribute('aria-label') || (b.textContent || '').trim() || b.getAttribute('title') || '');
  const grid = (b) => { const br = b.getBoundingClientRect(); let hit = 0, total = 0;
    for (let y = Math.ceil(br.top) + 1; y < Math.floor(br.bottom); y += 4) for (let x = Math.ceil(br.left) + 1; x < Math.floor(br.right); x += 4) { total++; const e = document.elementFromPoint(x, y); if (e && (e === b || b.contains(e))) hit++; }
    return total ? hit / total : 0; };
  const buttons = [...el.querySelectorAll('button')].map(b => { const br = b.getBoundingClientRect(); return { label: label(b), w: Math.round(br.width), h: Math.round(br.height), left: Math.round(br.left), top: Math.round(br.top), right: Math.round(br.right), bottom: Math.round(br.bottom), reach: grid(b), expanded: b.getAttribute('aria-expanded'), popup: b.getAttribute('aria-haspopup') }; });
  const tags = [...el.querySelectorAll('.sk-pill')].map(p => (p.textContent || '').trim());
  return JSON.stringify({ found: true, vw: innerWidth, top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), buttons, tags, text: (el.innerText || '').replace(/\\s+/g, ' ').trim() }); })()`;
const rowOf = async (name, scroll = false) => { const m = JSON.parse(await evalIn(ROW_OF(name, scroll))); assert.equal(m.found, true, `"${name}" is not on the Members page — the seed did not paint`); return m; };
const has = (m, re) => m.buttons.filter(b => re.test(b.label));

// Measured BEFORE this change in this same harness at 1280x900 (list column 620px wide): 101px for an adult
// who has not posted, 137px for a cleared adult. The owner's target: about half.
test('at 1280px an adult row and a cleared-adult row are ONE line, at most 56px tall, with every control on the name line', SKIP, async () => {
  await setSize(1280, 900);
  for (const p of [PEOPLE.adult, PEOPLE.adult2, PEOPLE.cleared]) {
    const r = await rowOf(p.name, true);
    assert.ok(r.height <= 56, `${p.name}'s row is ${r.height}px tall - not the single line the owner asked for. Buttons: ${JSON.stringify(r.buttons.map(b => [b.label.slice(0, 14), b.left, b.top]))}`);
    const tops = r.buttons.map(b => b.top);
    assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `${p.name}: the controls are not on one line: ${JSON.stringify(tops)}`);
    console.log(`    ${p.name}: ${r.height}px, ${r.buttons.length} controls on one line`);
  }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// Measured BEFORE this change (1e57878) in this harness: Ivy, a child, 157px (87px after) - the guardian pill and "Link parent" wrapped
// her row to a second line, taller than the 137px she had before 1e57878. The parent controls now live in More.
test('at 1280px a CHILD row has the parent controls off it, a More button on it, every control on one line, and is far under its old height', SKIP, async () => {
  await setSize(1280, 900);
  const r = await rowOf(PEOPLE.child.name, true);
  // NOT 52 like an adult: a child carries Photo (children are photo-off by default) as well as Child / Clear / Reconnect, and
  // those controls fill the 620px column on their own (594px measured), so the NAME takes the line above. That is the owner's
  // call to make (move Photo / Reconnect / copy into More too); this test holds what THIS change achieved: 157px -> 87px.
  assert.ok(r.height <= 90, `${PEOPLE.child.name}'s row is ${r.height}px tall - more than the 87px this change measured (157px before it). Buttons: ${JSON.stringify(r.buttons.map(b => [b.label.slice(0, 14), b.left, b.top]))}`);
  const tops = r.buttons.map(b => b.top);
  assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `the controls are not on one line: ${JSON.stringify(tops)}`);
  assert.deepEqual(has(r, /^(Link parent|Parents)$/), [], 'the parent control is still on the child row');
  assert.ok(!r.tags.some(t => /no guardian|parent:/.test(t)), 'a guardian pill is still on the child row: ' + JSON.stringify(r.tags));
  const more = has(r, /^More for /);
  assert.equal(more.length, 1, 'no More control on the child row: ' + JSON.stringify(r.buttons.map(b => b.label)));
  assert.ok(more[0].reach > 0.9, 'More is covered by something else: reach ' + more[0].reach);
  console.log(`    ${PEOPLE.child.name}: ${r.height}px, ${r.buttons.length} controls on one line`);
  // and More really reaches Link parent, with the guardian state in the header
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='More for ${PEOPLE.child.name}'); if(!b) return 'miss'; b.click(); return 'ok'; })()`), 'ok');
  await sleep(600);
  const sheet = await evalIn(`(() => { const d=document.querySelector('[role="dialog"][aria-label="More for ${PEOPLE.child.name}"]'); return d ? (d.innerText||'').replace(/\\s+/g,' ') : null; })()`);
  assert.ok(sheet, 'More did not open the sheet');
  assert.ok(/Link parent/i.test(sheet) && /no guardian/i.test(sheet), 'the sheet lacks Link parent or the guardian state: ' + sheet);
  await escape();
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// THE "REQUESTS TO JOIN" CARD (owner 2026-10-13: "the webapp approve should be one line as well"). Nia is the one pending person.
// Before this change the card was a name row over an Approve row. Browser-rendered only, device check pending.
const NIA = PEOPLE.pending.name;
const JOIN_CARD = `[...document.querySelectorAll('[data-join-card]')].find(c => (c.textContent||'').includes(${JSON.stringify(NIA)}))`;
test('at 1280px the join-request card is ONE line, at most 56px, with avatar, name, Approve and decline together', SKIP, async () => {
  await setSize(1280, 900);
  const r = await rowOf(NIA, true);
  assert.ok(r.height <= 56, `the join card is ${r.height}px tall - not one line. Buttons: ${JSON.stringify(r.buttons.map(b => [b.label.slice(0, 14), b.left, b.top]))}`);
  // EXACT, not a prefix. The safeguarding round added a second control on this row whose accessible name
  // STARTS "Approve as a child: …", so /^Approve/ now matches two buttons. Anchoring on the exact label
  // keeps this test about the LAYOUT and leaves that label free to say what a steward needs to hear.
  const ap = has(r, /^Approve$/), dc = has(r, /^Decline/);
  assert.equal(ap.length, 1, 'no Approve on the card: ' + JSON.stringify(r.buttons.map(b => b.label)));
  assert.equal(dc.length, 1, 'no Decline on the card');
  assert.ok(Math.abs(ap[0].top - dc[0].top) <= 4, 'Approve and Decline are on different lines');
  const nm = JSON.parse(await evalIn(`(() => { const t = ${JOIN_CARD}; const n = t.querySelector('[data-join-person] div div'); const a = n.getBoundingClientRect(), b = t.querySelector('button').getBoundingClientRect(); return JSON.stringify({ nameTop: a.top, nameBottom: a.bottom, btnTop: b.top, btnBottom: b.bottom }); })()`));
  assert.ok(nm.btnTop < nm.nameBottom && nm.btnBottom > nm.nameTop, 'the name and the buttons are not on one line: ' + JSON.stringify(nm));
  console.log(`    join card: ${r.height}px (member row 52px)`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('at 360px the join-request card wraps to the two-row shape and the name is whole', SKIP, async () => {
  await setSize(360, 730);
  const m = JSON.parse(await evalIn(`(() => { const t = ${JOIN_CARD}; if (!t) return JSON.stringify({ found: false });
    t.scrollIntoView({ block: 'center' }); const n = t.querySelector('[data-join-person] div div'); const a = n.getBoundingClientRect(), p = t.querySelector('[data-join-actions]').getBoundingClientRect();
    return JSON.stringify({ found: true, nameBottom: a.bottom, actionsTop: p.top, clipped: n.scrollWidth > n.clientWidth + 1, text: n.textContent, right: t.getBoundingClientRect().right, vw: innerWidth }); })()`));
  assert.equal(m.found, true, 'no join card at phone width');
  assert.ok(m.actionsTop >= m.nameBottom - 2, 'the actions are not below the name on a phone: ' + JSON.stringify(m));
  assert.equal(m.clipped, false, 'the name is clipped on a phone');
  assert.equal(m.text, NIA);
  assert.ok(m.right <= m.vw, 'the card runs off the screen: ' + JSON.stringify(m));
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
