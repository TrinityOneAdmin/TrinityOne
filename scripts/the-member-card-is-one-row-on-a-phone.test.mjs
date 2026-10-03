// THE MEMBER CARD IS ONE ROW ON A PHONE (P12). Owner, 2026-09-20: "compress or hide all those tags/pills,
// the whole card shouldn't be much bigger than the display picture size."
//   Run: node --test scripts/the-member-card-is-one-row-on-a-phone.test.mjs
//
// Measured on the Oppo at 360x730 (TrinityOne-internal/shots-console-2026-09-19/p/here/01-a1-members.png):
// each member was a ~380px card — avatar, name, two icon buttons, a JOINED pill, Chat, then Child / Clear for
// youth / Reconnect stacked one per line — so forty members were fifteen screens. Re-measured on 74eade2 in
// this harness before the change: 209px for a plain adult, 173 for one who has posted, 312 for a child, 204
// for a cleared adult at 360x730; 101 and 137 at 730x328. After: 56px each, at both sizes. Agreed shape: ONE
// ROW per member — avatar · name / handle · Chat · ⋯ — with every action the card carried behind ⋯, and the
// two safeguarding FACTS ("Child", "Cleared") as a small tag on the row for the members who have them.
//
// MEASURED RED/GREEN, 2026-09-20, each sabotage scoped to the enclosing function and verified to occur exactly
// once inside it before the edit, the source restored byte-for-byte after:
//   · the branch as committed                                                    7 pass / 0 fail
//   · memberRow: `if (narrow) {` → `if (false && narrow) {` (the old card)       2 pass / 5 fail (rows 1, 2, 3, 4, 6)
//   · DashMembers: the pending row's Approve wrapped in `{false ? … : null}`     5 pass / 2 fail (rows 2, 3)
//   · memberActions: "Mark as a child" `onPick: () => toggleMinor(pk)` → `() => {}`   6 pass / 1 fail (row 4)
//
// ── WHY A BROWSER, AND WHAT IS REAL ──────────────────────────────────────────────────────────────────────
// The same instrument as scripts/console-phone-layout-batch-a.test.mjs: the real steward.html off the real
// gateway, in Chromium at exactly the Oppo's CSS pixels (360x730, and 730x328 for the row height), every
// claim a rect, a hit test or a visible node — nothing here matches text in app/*.jsx (CLAUDE.md rule 3).
//
// ── THE CHURCH IS THIS BOX'S OWN, so its writes LAND ─────────────────────────────────────────────────────
// The sibling files pin the relay to ANOTHER church on purpose (dialog-footers' before() says why); their
// cost is that nothing can be seeded through a publish. This file needs a child, a cleared adult and a
// pending member — three states that exist only as documents the church key signs — so the church key is
// generated HERE, the relay is pinned to it, and the console is handed the words through the dev-only
// `?churchkey=` hook (app/steward-root.jsx initChurch: loopback only, never over an existing key). The
// console then forces a PIN, as it does for any plaintext seed, and comes up on its dashboard with no
// first-run wizard (nothing set `newchurch`). setMinors / setApproved / setJoinPolicy / setAdmitted are the
// console's own engine calls, accepted by the relay because the church IS this box's church, and read back
// through the same subscriptions the Members page paints from. The MEMBERS themselves are seeded through the
// roster cache the page paints from on mount (as batch-a row 1 does): a member is a presence the relay
// aggregates from their OWN key's events, which this harness does not hold.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs, so CI without a browser is green.
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
const PORT = 8870, CDP = 9370;   // 88xx: 8868 batch-a, 8869/8871 taken; 93xx taken: 9350-9358, 9360-9364, 9366-9369, 9371, 9381, 9412
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
  await requireFreePort(PORT, 'the-member-card-is-one-row-on-a-phone.test.mjs');
  await requireFreePort(CDP, 'the-member-card-is-one-row-on-a-phone.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-member-card-'));
  // Chromium is pointed at a black hole for the production hosts: the console dials CANONICAL_RELAYS
  // regardless of who served the page (see app-boots.test.mjs). Nothing here reaches production.
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(CHURCH_PK), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-member-card-chr-' + process.pid);
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

test('CONTROL: the console is on the seeded church at 360x730, Members open, six people on the page', SKIP, async () => {
  assert.equal(booted, 'ok', 'the "Set PIN" button was never found');
  const v = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
  assert.deepEqual(v, { w: VW, h: VH }, 'the viewport is not the phone we claim to be measuring');
  for (const p of Object.values(PEOPLE)) {
    if (p === PEOPLE.inactive) continue;   // folded under "See inactive" — row 6 opens it
    await rowOf(p.name);
  }
  assert.deepEqual(errors, [], 'the console threw while reaching Members:\n  ' + errors.join('\n  '));
});


// ── 1. one row per member, about the avatar's height ──────────────────────────────────────────────────────
// The rows measured are the MEMBER rows (memberRow): the four admitted people on the page and, in row 6, the
// inactive one. The pending row is a different element in the "Requests to join" box and is measured in
// row 2 by what it shows, not by this budget: at 360px its second line wraps under a 102px Approve and it
// stands at 80px, which this change did not touch.
const MEMBERS = ['adult', 'adult2', 'child', 'cleared'].map(k => PEOPLE[k]);
test(`1. at 360x730 and 730x328 every member row is at most ${ROW_MAX}px tall, and the rows together are no taller than their count times that plus gaps`, SKIP, async () => {
  // Before this change, same harness, same church: 209px (a plain adult), 173 (an adult who has posted),
  // 312 (a child), 204 (a cleared adult) at 360x730; 101 and 137 at 730x328.
  for (const [w, h] of [[VW, VH], [LW, LH]]) {
    await setSize(w, h);
    const rows = [];
    for (const p of MEMBERS) rows.push({ name: p.name, ...(await rowOf(p.name)) });
    for (const r of rows) assert.ok(r.height <= ROW_MAX, `at ${w}x${h} the row for ${r.name} is ${r.height}px tall — not one row. Buttons: ${JSON.stringify(r.buttons.map(b => b.label))}, tags ${JSON.stringify(r.tags)}`);
    // the whole run of rows: from the top of the first to the bottom of the last, no more than N rows + N gaps
    const tops = rows.map(r => r.top), bottoms = rows.map(r => r.top + r.height);
    const span = Math.max(...bottoms) - Math.min(...tops);
    assert.ok(span <= rows.length * ROW_MAX + (rows.length - 1) * 12, `at ${w}x${h} ${rows.length} member rows span ${span}px — more than ${rows.length}x${ROW_MAX} plus gaps; something between them grew`);
    console.log(`    measured at ${w}x${h}: ` + rows.map(r => `${r.name.split(' ')[0]} ${r.height}px`).join(' · ') + `; ${rows.length} rows span ${span}px`);
  }
  await setSize(VW, VH);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 2. what each kind of member shows ─────────────────────────────────────────────────────────────────────
test('2. a plain adult shows name, handle, Chat and ⋯ and NO tag; a child shows "Child"; a cleared adult shows "Cleared"; a pending member shows Approve and not Chat', SKIP, async () => {
  const adult = await rowOf(PEOPLE.adult.name);
  assert.ok(adult.text.includes('@persephonewilde'), `the adult's row does not show their handle: "${adult.text}"`);
  assert.equal(has(adult, /^Chat with /).length, 1, `no Chat control on the adult's row: ${JSON.stringify(adult.buttons.map(b => b.label))}`);
  assert.equal(has(adult, /^More for /).length, 1, `no ⋯ ("More for") control on the adult's row: ${JSON.stringify(adult.buttons.map(b => b.label))}`);
  assert.equal(adult.buttons.length, 2, `the adult's row carries ${adult.buttons.length} controls, not two (Chat, ⋯): ${JSON.stringify(adult.buttons.map(b => b.label))}`);
  // DOMAIN.md, "safeguarding is a mechanism, not a policy": a member the church has said nothing about
  // carries nothing. A "joined" pill, an "anonymous" pill — any tag at all — is the old card.
  assert.deepEqual(adult.tags, [], `a plain adult's row carries tags: ${JSON.stringify(adult.tags)}`);
  const child = await rowOf(PEOPLE.child.name);
  assert.deepEqual(child.tags, ['Child'], `the child's row does not say Child (and only Child): ${JSON.stringify(child.tags)}`);
  const cleared = await rowOf(PEOPLE.cleared.name);
  assert.deepEqual(cleared.tags, ['Cleared'], `the cleared adult's row does not say Cleared (and only Cleared): ${JSON.stringify(cleared.tags)}`);
  // Human admission only (decided 2026-08-18): the one act a steward takes on this list stays on the row.
  const pending = await rowOf(PEOPLE.pending.name);
  assert.ok(pending.text.includes('wants to join'), `the pending row does not say "wants to join": "${pending.text}"`);
  const approve = has(pending, /^Approve$/);
  assert.equal(approve.length, 1, `no Approve on the pending row: ${JSON.stringify(pending.buttons.map(b => b.label))}`);
  assert.ok(approve[0].w > 0 && approve[0].h > 0, `Approve is on the pending row but not painted (${approve[0].w}x${approve[0].h})`);
  assert.equal(has(pending, /^Chat/).length, 0, `the pending row offers Chat: ${JSON.stringify(pending.buttons.map(b => b.label))}`);
  assert.equal(has(pending, /^More for /).length, 0, `the pending row has a ⋯: ${JSON.stringify(pending.buttons.map(b => b.label))}`);
  console.log(`    adult: tags ${JSON.stringify(adult.tags)}, ${adult.buttons.map(b => b.label.split(' ')[0]).join(' + ')}; child ${JSON.stringify(child.tags)}; cleared ${JSON.stringify(cleared.tags)}; pending ${pending.buttons.map(b => b.label.split(' ')[0]).join(' + ')} at ${pending.height}px`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 3. the controls are reachable and do not overlap ──────────────────────────────────────────────────────
test(`3. Chat, ⋯ and Approve are each at least ${FLOOR}px both ways, 90%+ of a 4px grid over each reaches it, and no two controls on a row overlap`, SKIP, async () => {
  const seen = [];
  for (const p of [PEOPLE.adult, PEOPLE.child, PEOPLE.pending]) {
    const m = await rowOf(p.name, true);
    const named = m.buttons.filter(b => /^(Chat with |More for |Approve$)/.test(b.label));
    assert.ok(named.length >= (p === PEOPLE.pending ? 1 : 2), `re-anchor: ${p.name}'s row has ${named.length} of the named controls`);
    for (const b of named) {
      assert.ok(b.w >= FLOOR && b.h >= FLOOR, `"${b.label}" on ${p.name}'s row is ${b.w}x${b.h} — under the ${FLOOR}px floor`);
      assert.ok(b.reach >= 0.9, `only ${Math.round(b.reach * 100)}% of the grid over "${b.label}" (${p.name}) reaches it — something sits over it`);
      seen.push(`${b.label.split(' ')[0]} ${b.w}x${b.h} ${Math.round(b.reach * 100)}%`);
    }
    for (let i = 0; i < m.buttons.length; i++) for (let j = i + 1; j < m.buttons.length; j++) {
      const a = m.buttons[i], b = m.buttons[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      assert.equal(overlap, false, `"${a.label}" and "${b.label}" overlap on ${p.name}'s row`);
    }
  }
  console.log('    ' + seen.join(' · '));
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 4. ⋯ opens the sheet, and a pick there does what the old button did ───────────────────────────────────
const SHEET = `document.querySelector('[role="dialog"][aria-label^="More for "]')`;
const sheetOf = async () => JSON.parse(await evalIn(`(() => { const d = ${SHEET}; if (!d) return JSON.stringify({ open: false });
  const r = d.getBoundingClientRect();
  return JSON.stringify({ open: true, label: d.getAttribute('aria-label'), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
    items: [...d.querySelectorAll('button')].map(b => ({ label: (b.getAttribute('aria-label') || (b.textContent || '').trim()), text: (b.textContent || '').trim(), h: Math.round(b.getBoundingClientRect().height) })),
    facts: [...d.querySelectorAll('.sk-pill')].map(p => (p.textContent || '').trim()) }); })()`));
const pressMore = async (name) => {
  const r = await evalIn(`(() => { const b = document.querySelector('button[aria-label="More for ${name}"]'); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no ⋯ ("More for ${name}") on the page`);
  await sleep(700);
};
const expandedOf = (name) => evalIn(`(() => { const b = document.querySelector('button[aria-label="More for ${name}"]'); return b ? b.getAttribute('aria-expanded') : 'gone'; })()`);
const pickInSheet = async (aria) => {
  const r = await evalIn(`(() => { const d = ${SHEET}; if (!d) return 'no sheet'; const b = [...d.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(aria)}); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${aria}" in the sheet to press`);
};

test('4. pressing ⋯ on an adult opens their sheet with the card\'s actions; "Mark as a child" there runs the real handler and the row grows a "Child" tag; Escape and the backdrop close it; ⋯ carries aria-expanded', SKIP, async () => {
  const NAME = PEOPLE.adult2.name;
  assert.equal(await expandedOf(NAME), 'false', 're-anchor: ⋯ does not carry aria-expanded="false" while closed');
  assert.deepEqual((await rowOf(NAME)).tags, [], 're-anchor: the adult under test already carries a tag');
  await pressMore(NAME);
  let s = await sheetOf();
  assert.equal(s.open, true, 'pressing ⋯ opened no dialog labelled "More for …"');
  assert.equal(s.label, 'More for ' + NAME);
  assert.equal(await expandedOf(NAME), 'true', '⋯ does not say aria-expanded="true" while its sheet is open');
  // the actions the card carried for a plain adult, by the accessible names the desktop buttons have
  const labels = s.items.map(i => i.label);
  for (const want of ['Copy npub', /^Remove \/ block /, 'Mark as a child: ' + NAME, 'Clear for youth work: ' + NAME + ' — this also lets them message a child privately', 'Reconnect']) {
    assert.ok(labels.some(l => (want instanceof RegExp ? want.test(l) : l === want)), `the sheet lacks "${want}": ${JSON.stringify(labels)}`);
  }
  for (const i of s.items) assert.ok(i.h >= FLOOR, `the "${i.label}" row in the sheet is ${i.h}px tall — under the ${FLOOR}px floor`);
  assert.ok(s.bottom <= s.vh + 1, `the sheet's bottom (${s.bottom}) is below the viewport (${s.vh})`);
  // Escape closes it, and ⋯ says so
  await escape();
  assert.equal((await sheetOf()).open, false, 'Escape did not close the sheet');
  assert.equal(await expandedOf(NAME), 'false', 'aria-expanded stayed "true" after the sheet closed');
  // the backdrop closes it: a tap at a point above the panel that is not the panel
  await pressMore(NAME);
  s = await sheetOf();
  assert.equal(s.open, true);
  const hit = await evalIn(`(() => { const d = ${SHEET}; const y = Math.max(4, Math.round(d.getBoundingClientRect().top / 2)); const e = document.elementFromPoint(innerWidth / 2, y); if (!e || d.contains(e)) return 'panel'; e.click(); return 'ok'; })()`);
  assert.equal(hit, 'ok', 'could not find the backdrop above the sheet to tap');
  await sleep(600);
  assert.equal((await sheetOf()).open, false, 'tapping the backdrop did not close the sheet');
  // THE PICK. "Mark as a child: Tobias Ashcroft" in the sheet calls toggleMinor — the console's own engine
  // writes minors:<church> to this relay, which accepts it, and the row's tag is read back from the
  // subscription the page paints from. Nothing is stubbed: the tag appearing proves the whole chain.
  await pressMore(NAME);
  await pickInSheet('Mark as a child: ' + NAME);
  let tags = [];
  for (const t0 = Date.now(); Date.now() - t0 < 12000 && !tags.includes('Child');) { await sleep(400); tags = (await rowOf(NAME)).tags; }
  assert.deepEqual(tags, ['Child'], `after "Mark as a child" from the sheet, ${NAME}'s row shows ${JSON.stringify(tags)} — the pick did not produce the state the old button did`);
  assert.equal((await sheetOf()).open, false, 'the sheet stayed open after a pick');
  // …and the sheet now offers the reverse, so the same control un-marks (which also leaves the church as
  // rows 5 and 6 expect it)
  await pressMore(NAME);
  s = await sheetOf();
  assert.ok(s.items.some(i => i.label === 'Unmark as a child: ' + NAME), `the reopened sheet does not offer "Unmark as a child": ${JSON.stringify(s.items.map(i => i.label))}`);
  assert.deepEqual(s.facts, ['child', 'no guardian'], `the sheet's header does not carry the child's facts: ${JSON.stringify(s.facts)}`);
  await pickInSheet('Unmark as a child: ' + NAME);
  for (const t0 = Date.now(); Date.now() - t0 < 12000 && tags.includes('Child');) { await sleep(400); tags = (await rowOf(NAME)).tags; }
  assert.deepEqual(tags, [], `after "Unmark as a child", ${NAME}'s row still shows ${JSON.stringify(tags)}`);
  console.log(`    sheet for ${NAME}: ${labels.length} actions ${JSON.stringify(labels.map(l => l.split(':')[0].split(' — ')[0]))}; marked → ["Child"] → unmarked → []`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 5. the desktop row is the row it was ──────────────────────────────────────────────────────────────────
// Recorded at 1280x900 on 74eade2, before the change, from this harness: the accessible names of every
// control on the row, in order, and its pills. The phone row must not have reached the desktop.
const DESKTOP = {
  [PEOPLE.adult.name]:   { tags: ['joined'], buttons: ['Copy npub', 'Remove / block this member', 'Chat', 'Mark as a child: Persephone Wilde', 'Clear for youth work: Persephone Wilde — this also lets them message a child privately', 'Reconnect'] },
  [PEOPLE.child.name]:   { tags: ['joined', 'child', 'no guardian'], buttons: ['Copy npub', 'Remove / block this member', 'Chat', 'Unmark as a child: Ivy Whitlock', 'Clear for youth work: Ivy Whitlock — this also lets them message a child privately', 'Link parent', 'Reconnect', 'Photos off ✓'] },
  [PEOPLE.cleared.name]: { tags: ['cleared for youth'], buttons: ['Copy npub', 'Remove / block this member', 'Chat', 'Mark as a child: Ruth Whitlock', 'Remove youth clearance from Ruth Whitlock', 'Reconnect'] },
};
test('5. at 1280 wide the member row is the desktop card it was: the same controls in the same order, the same pills, no ⋯', SKIP, async () => {
  await setSize(DW, DH);
  try {
    for (const [name, want] of Object.entries(DESKTOP)) {
      const m = await rowOf(name);
      assert.deepEqual(m.buttons.map(b => b.label), want.buttons, `the desktop row for ${name} changed`);
      assert.deepEqual(m.tags, want.tags, `the desktop pills for ${name} changed`);
      assert.equal(has(m, /^More for /).length, 0, `the phone's ⋯ reached the desktop row for ${name}`);
    }
    console.log(`    desktop rows unchanged for ${Object.keys(DESKTOP).length} members`);
  } finally { await setSize(VW, VH); }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 6. an inactive member, compressed the same way ────────────────────────────────────────────────────────
test(`6. under "See inactive" a member unseen for 90 days is the same one row (at most ${ROW_MAX}px, Chat + ⋯, no tag) and says "inactive" on its second line`, SKIP, async () => {
  assert.equal(await evalIn(click('/See inactive/')), 'ok', 'no "See inactive" fold on the page — the inactive seed did not paint');
  await sleep(600);
  const m = await rowOf(PEOPLE.inactive.name);
  assert.ok(m.height <= ROW_MAX, `the inactive row is ${m.height}px tall`);
  assert.equal(has(m, /^Chat with /).length, 1, `no Chat on the inactive row: ${JSON.stringify(m.buttons.map(b => b.label))}`);
  assert.equal(has(m, /^More for /).length, 1, `no ⋯ on the inactive row: ${JSON.stringify(m.buttons.map(b => b.label))}`);
  assert.deepEqual(m.tags, [], `the inactive row carries tags: ${JSON.stringify(m.tags)}`);
  assert.match(m.text, /inactive/, `the inactive row does not say so: "${m.text}"`);
  console.log(`    inactive row ${m.height}px: "${m.text}"`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 7. every sheet action reaches ITS OWN handler — the audit's sabotage ─────────────────────────────
// The audit of 2d3bc63 wired the sheet's "Clear for youth" to toggleMinor (mark a child instead of clear
// an adult) and all seven rows above stayed green: only "Mark as a child" was proved at the point of use.
// So: clear the plain adult from the sheet and read the tag the relay hands back. A wrong handler would
// paint "Child" here, and the row would say so.
test('7. "Clear for youth" from the sheet clears THAT adult — the row grows "Cleared", never "Child" — and the sheet then offers to remove it', SKIP, async () => {
  await setSize(360, 730);
  await sleep(600);
  const NAME = PEOPLE.adult2.name;
  assert.deepEqual((await rowOf(NAME)).tags, [], 're-anchor: the adult under test already carries a tag');
  await pressMore(NAME);
  await pickInSheet('Clear for youth work: ' + NAME + ' — this also lets them message a child privately');
  let tags = [];
  for (const t0 = Date.now(); Date.now() - t0 < 12000 && !tags.includes('Cleared');) { await sleep(400); tags = (await rowOf(NAME)).tags; }
  assert.deepEqual(tags, ['Cleared'], `after "Clear for youth" from the sheet, ${NAME}'s row shows ${JSON.stringify(tags)} — the wrong handler ran, or none`);
  await pressMore(NAME);
  const s = await sheetOf();
  assert.ok(s.items.some(i => i.label === 'Remove youth clearance from ' + NAME), `the reopened sheet does not offer to remove the clearance: ${JSON.stringify(s.items.map(i => i.label))}`);
  await pickInSheet('Remove youth clearance from ' + NAME);
  for (const t0 = Date.now(); Date.now() - t0 < 12000 && tags.includes('Cleared');) { await sleep(400); tags = (await rowOf(NAME)).tags; }
  assert.deepEqual(tags, [], `after removing the clearance, ${NAME}'s row still shows ${JSON.stringify(tags)}`);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// ── 8. Android Back disarms an armed block — the audit's defect ──────────────────────────────────────
// 2d3bc63 registered the sheet's Capacitor backButton listener once, so it kept the FIRST render's onClose,
// which had seen no block armed. ⋯ → Remove / block → Back → the arm survived, and the next ⋯ opened with
// "Confirm: block …" where "Remove / block" belongs — one tap from a ban and a key rotation. A fake App
// plugin is installed BEFORE the sheet mounts (the listener is read at mount), Back is fired through it,
// and the reopened sheet must be disarmed exactly as it is after Escape.
test('8. ⋯ → Remove / block → Android Back: the sheet closes disarmed, and the next ⋯ offers "Remove / block", not "Confirm: block"', SKIP, async () => {
  const NAME = PEOPLE.adult2.name;
  const installed = await evalIn(`(() => { window.__backs = []; window.Capacitor = window.Capacitor || {}; window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.App = { addListener: (ev, fn) => { if (ev === 'backButton') window.__backs.push(fn); return { remove: () => { window.__backs = window.__backs.filter(f => f !== fn); } }; } }; return 'ok'; })()`);
  assert.equal(installed, 'ok');
  await pressMore(NAME);
  await pickInSheet('Remove / block ' + NAME + ' — asks you to confirm');
  await sleep(300);
  let s = await sheetOf();
  assert.equal(s.open, true, 'the sheet closed on the first (arming) tap of Remove / block');
  assert.ok(s.items.some(i => i.label === 'Confirm: block ' + NAME), `the block is not armed after one tap: ${JSON.stringify(s.items.map(i => i.label))}`);
  const fired = await evalIn(`(() => { const n = window.__backs.length; window.__backs.forEach(f => f()); return n; })()`);
  assert.equal(fired, 1, `expected exactly one backButton listener while the sheet is open, found ${fired}`);
  await sleep(600);
  assert.equal((await sheetOf()).open, false, 'Android Back did not close the sheet');
  await pressMore(NAME);
  s = await sheetOf();
  const labels = s.items.map(i => i.label);
  assert.ok(!labels.some(l => /^Confirm: block /.test(l)), `THE DEFECT: after Back, the reopened sheet still has the block ARMED — one tap would ban ${NAME}: ${JSON.stringify(labels)}`);
  assert.ok(labels.some(l => l === 'Remove / block ' + NAME + ' — asks you to confirm'), `the reopened sheet does not offer the two-tap "Remove / block": ${JSON.stringify(labels)}`);
  await escape();
  assert.equal(await evalIn(`window.__backs.length`), 0, 'the backButton listener was not removed when the sheet closed');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
