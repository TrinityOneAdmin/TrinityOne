// A MEMBER'S WHOLE NAME IS ON THEIR ROW (owner, 2026-10-13).
//   Run: node --test scripts/the-console-member-row-shows-the-whole-name.test.mjs
//
// WHAT WENT WRONG, and why nothing caught it. The Members row put the name block on `flex: '1 1 90px'`
// beside control blocks that are all `flexShrink: 0`, inside a panel grid of `2fr 1fr`. Flex line-breaking
// uses each item's HYPOTHETICAL size, so all four blocks fitted one line and the name was handed what was
// left: 104.5px of a 620px column (measured, headless, 1280x900). "Persephone Wilde" ellipsised and the
// @handle beside it collapsed to 0px — and since 1e57878 a member who HAS a name no longer shows a raw
// npub, so the row showed a cut-off name and nothing else identifying the person, on the screen carrying
// the Child and Clear-for-youth controls.
//
// The two tests that already covered this row could not see it: one renders the tree and asserts /@tobias/
// is PRESENT — and it is, in a box 0px wide — and the other asserts the row's HEIGHT and that the buttons
// share a line, which a squeezed name does not disturb. CLAUDE.md rule 3: text in app/*.jsx proves nothing.
// So this file measures RENDERED WIDTH in a real browser: the name's scrollWidth against its clientWidth
// (the ellipsis), the name block against its floor, and the identity line against zero.
//
// It also measures the panel grid itself. The fix needed both a 150px floor on the name block AND a wider
// list column (`3fr 1fr`); putting `2fr 1fr` back would re-truncate every name while every other assertion
// in the suite stayed green, so the ratio is asserted here at its point of use.
//
// Seeding is the one from the-member-row-is-one-line-on-the-console.test.mjs: real steward.html off a real
// gateway, the states written by the console's own engine. Browser-rendered only: no device check.
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
const PORT = 8693, CDP = 9460;   // 88xx/86xx: 8693 unused; 93xx taken: 9350-9372, 9376-9382, 9392, 9441-9443
const ROOT = new URL('..', import.meta.url).pathname;
const VW = 360, VH = 730;
const PIN = 'cedar-harbour-lamp-42';
const FLOOR = 150;        // the name block's flex-basis AND minWidth in app/stew-dashboard.jsx
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The same church and the same people as the sibling file: the names are read back off the screen, so each
// is distinct, none is a substring of another, and the longest ("Persephone Wilde", 136.9px at 14.5px/700)
// is the one the old layout truncated.
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
// `cv: 2` is the stamp subscribeMembers puts on a cached roster row; without it a cached message count is
// ignored and Ruth is drawn with a "joined" pill she would never have on a real console.
const ROSTER = Object.values(PEOPLE).map(p => ({ npub: 'npub1' + p.pubkey.slice(0, 58), picture: '', count: 0, lastTs: 0, firstTs: 0, cv: 2, ...p }));
const ADMITTED = Object.entries(PEOPLE).filter(([k]) => k !== 'pending').map(([, p]) => p.pubkey);

let relay, chr, ws, dataDir, prof, evalIn, send;
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
  await requireFreePort(PORT, 'the-console-member-row-shows-the-whole-name.test.mjs');
  await requireFreePort(CDP, 'the-console-member-row-shows-the-whole-name.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-whole-name-'));
  // Chromium is pointed at a black hole for the production hosts: the console dials CANONICAL_RELAYS
  // regardless of who served the page (see app-boots.test.mjs). Nothing here reaches production.
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(CHURCH_PK), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-whole-name-chr-' + process.pid);
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

  // The forced PIN over a plaintext seed, then the dashboard. POLLED, not slept (HANDOFF 2026-09-20).
  let pinned = 'miss';
  for (const t0 = Date.now(); pinned !== 'ok' && Date.now() - t0 < 60000;) { await sleep(500); pinned = await evalIn(type('At least 8', PIN)); }
  assert.equal(pinned, 'ok', 'no "Set a console PIN" field within 60s — the churchkey hook did not load the seed');
  await evalIn(type('Type it again', PIN));
  await evalIn(click('/Set PIN/i'));
  let up = false;
  for (const t0 = Date.now(); !up && Date.now() - t0 < 60000;) { await sleep(500); up = await evalIn(`!!document.querySelector('button[aria-label="Sections"]') && window.Steward.churchPub === ${JSON.stringify(CHURCH_PK)}`); }
  assert.equal(up, true, 'the console did not reach its phone dashboard on the seeded church within 60s');

  const seed1 = JSON.parse(await evalIn(`(async () => {
    const r = {};
    r.policy = await window.Steward.setJoinPolicy(true);
    r.group = await window.Steward.publishGroup({ name: 'Whole Church', kind: 'group' });
    return JSON.stringify(r); })()`));
  for (const [k, v] of Object.entries(seed1)) assert.notEqual(v, false, `the relay refused the ${k} seed: ${JSON.stringify(seed1)} — this is not this box's church`);
  // The list writers refuse until the console has AUTHENTICATED, and the relay's NIP-42 challenge is lazy:
  // it comes only when a REQ names something it withholds. Opening a section is what draws it.
  let authed = false;
  for (let i = 0; i < 6 && !authed; i++) {
    await openMenu(); await pickSection(i % 2 ? 'Overview' : 'Groups');
    for (const t0 = Date.now(); !authed && Date.now() - t0 < 5000;) { await sleep(300); authed = await evalIn(`!!(window.Steward.relayAuthed && window.Steward.relayAuthed())`); }
  }
  assert.equal(authed, true, 'the console never authenticated to its own relay');
  const seed2 = JSON.parse(await evalIn(`(async () => {
    const r = {};
    r.admitted = await window.Steward.setAdmitted(${JSON.stringify(ADMITTED)});
    r.minors = await window.Steward.setMinors([${JSON.stringify(PEOPLE.child.pubkey)}]);
    r.approved = await window.Steward.setApproved([${JSON.stringify(PEOPLE.cleared.pubkey)}], { listKnown: true });
    return JSON.stringify(r); })()`));
  for (const [k, v] of Object.entries(seed2)) assert.notEqual(v, false, `the relay refused the ${k} seed: ${JSON.stringify(seed2)}`);
  // The roster cache is written LAST and Members opened straight after it: subscribeMembers rewrites that
  // cache from its own map on every delivery, so a seed planted earlier is overwritten by the first empty one.
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.members.' + window.Steward.churchPub, JSON.stringify(${JSON.stringify(ROSTER)})); return 'ok'; })()`);
  await openMenu(); await pickSection('Overview'); await openMenu(); await pickSection('Members'); await sleep(1500);
  // The clearance-backfill alert and the safeguarding note take ~180px at the top and squeeze the list's
  // scroll box to 0px tall in this harness; dismissing them is what a steward does once. Neither is under test.
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

// A member's NAME, measured where it is drawn. The name span is the only childless node whose text is
// exactly their name; its block is two parents up (span -> the name/handle row -> the flex item that gets
// the floor), and the card is the nearest bordered ancestor. `scrollWidth > clientWidth` IS the ellipsis:
// the span carries overflow:hidden + text-overflow:ellipsis, so this is the browser telling us it had to
// cut the text, which no assertion over the source or the rendered tree can see.
const NAME_OF = (name) => `(() => {
  const NAME = ${JSON.stringify(name)};
  const main = document.querySelector('main') || document.body;
  const nm = [...main.querySelectorAll('span, div')].find(s => (s.textContent || '').trim() === NAME && s.children.length === 0 && !s.closest('[role="dialog"]'));
  if (!nm) return JSON.stringify({ found: false });
  let card = nm; while (card && card !== document.body && getComputedStyle(card).borderTopWidth === '0px') card = card.parentElement;
  card.scrollIntoView({ block: 'center' });
  const nameRow = nm.parentElement, block = nameRow.parentElement;
  const W = e => Math.round(e.getBoundingClientRect().width * 10) / 10;
  // the identity beside the name: an @handle, or the short npub when there is no name at all
  const ident = [...nameRow.children].find(c => c !== nm);
  const identText = ident ? ident.querySelector('span') : null;
  const cr = card.getBoundingClientRect();
  return JSON.stringify({ found: true, vw: innerWidth,
    cardW: W(card), cardH: Math.round(cr.height), cardRight: Math.round(cr.right),
    blockW: W(block), nameW: W(nm), nameScrollW: nm.scrollWidth, nameClientW: nm.clientWidth,
    ellipsised: nm.scrollWidth > nm.clientWidth + 1,
    identW: ident ? W(ident) : null, identTextW: identText ? W(identText) : null,
    identText: ident ? (ident.textContent || '').trim() : null }); })()`;
const nameOf = async (name) => { const m = JSON.parse(await evalIn(NAME_OF(name))); assert.equal(m.found, true, `"${name}" is not on the Members page — the seed did not paint`); return m; };

// The panel's two columns, read off the grid that lays them out.
const COLUMNS = `(() => {
  const main = document.querySelector('main') || document.body;
  const g = [...main.querySelectorAll('div')].find(d => getComputedStyle(d).display === 'grid' && /fr/.test(d.style.gridTemplateColumns || ''));
  if (!g) return JSON.stringify({ found: false });
  const w = [...g.children].map(c => Math.round(c.getBoundingClientRect().width * 10) / 10);
  return JSON.stringify({ found: true, vw: innerWidth, declared: g.style.gridTemplateColumns,
    resolved: getComputedStyle(g).gridTemplateColumns, cols: w }); })()`;

// ── what the owner asked for ──────────────────────────────────────────────────────────────────────────────

// Measured on 2026-10-13 BEFORE the fix, in this harness: the name block 104.5px of a 620px column, the name
// 104.5px against 137px of text (ellipsised), the @handle 0px. AFTER: block 182px, name 136.9px whole, handle
// 38.1px.
//   The widths are 1440 and 1366, NOT 1280 and 1024 (owner's choice, 2026-10-14). 1366 is the LOWEST width
// at which this row works: the row stays one line down to 1240, but the @handle beside the name is 88.6px at
// 1366, 24.1px at 1280 and 0px at 1240, because in that band the controls take their width first. Below 1366
// Members is the phone card — see the sibling test below, which holds 1280, 1024 and 900.
test('at console widths a member\'s whole name is on their row — never ellipsised, never below the name block\'s floor', SKIP, async () => {
  for (const vw of [1440, 1366]) {
    await setSize(vw, 900);
    for (const p of [PEOPLE.adult, PEOPLE.adult2, PEOPLE.cleared, PEOPLE.child]) {
      const m = await nameOf(p.name);
      assert.equal(m.ellipsised, false,
        `at ${vw}px "${p.name}" is CUT OFF: the name box is ${m.nameClientW}px and the text needs ${m.nameScrollW}px (block ${m.blockW}px of a ${m.cardW}px card). A steward cannot tell who this row is.`);
      assert.ok(m.blockW >= FLOOR,
        `at ${vw}px the name block is ${m.blockW}px, below its ${FLOOR}px floor (card ${m.cardW}px) — the controls took the width first`);
      assert.ok(m.cardRight <= m.vw, `at ${vw}px ${p.name}'s row runs off the screen: right ${m.cardRight} of ${m.vw}`);
      console.log(`    ${vw}px ${p.name}: block ${m.blockW}px, name ${m.nameW}/${m.nameScrollW}px, @handle ${m.identTextW}px, row ${m.cardH}px`);
    }
  }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// The second half of the same defect: since 1e57878 a member who HAS a name shows no raw npub, so if the
// @handle beside the name collapses there is nothing on the row but the name. At 1280 before the fix both
// adults' handles measured 0px wide. This asserts the identity line is never nothing.
test('the @handle beside the name never collapses to nothing', SKIP, async () => {
  for (const vw of [1440, 1366]) {
    await setSize(vw, 900);
    for (const p of [PEOPLE.adult, PEOPLE.adult2, PEOPLE.cleared, PEOPLE.child]) {
      const m = await nameOf(p.name);
      assert.ok(m.identTextW !== null, `${p.name} has no identity element beside their name at ${vw}px`);
      assert.ok(m.identTextW >= 12,
        `at ${vw}px ${p.name}'s "${m.identText}" is ${m.identTextW}px wide — it has been squeezed out of the row, which now identifies them by a name alone`);
    }
  }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// THE RATIO IS LOAD-BEARING. `2fr 1fr` gave the list 620px and truncated every name while every other test
// in the suite stayed green; `3fr 1fr` gives it 697.5px and a 52px row. Measured here, at the point of use,
// so putting 2fr back fails a test instead of shipping.
test('the Members panel gives the list column three times the private-messages column', SKIP, async () => {
  for (const vw of [1440, 1366]) {
    await setSize(vw, 900);
    const g = JSON.parse(await evalIn(COLUMNS));
    assert.equal(g.found, true, 'no grid lays out the Members panel — re-anchor this test');
    assert.equal(g.cols.length, 2, 'the Members panel is not two columns: ' + JSON.stringify(g));
    const [list, dm] = g.cols;
    assert.ok(list / dm > 2.6 && list / dm < 3.4,
      `the list column is ${list}px and the private-messages column ${dm}px (ratio ${(list / dm).toFixed(2)}) — expected about 3:1. At 2:1 the list is 620px at 1280 and every member's name is truncated.`);
    console.log(`    ${vw}px columns: list ${list}px, private messages ${dm}px (${g.declared})`);
  }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// BELOW 1366 MEMBERS IS THE PHONE LAYOUT, AND THAT IS THE POINT OF USE (owner's choice, 2026-10-14).
//
// 1280 — the console's own width — is in here deliberately. The desktop row technically fits on one line at
// 1280, but its @handle is squeezed to 24.1px ("@p…") and to 0px by 1240, so the row identifies a member by
// a cut-off name alone on the screen carrying Child, Clear-for-youth and Block. The phone card is 56px on
// ONE line with the name AND the handle whole at all three widths below, which is why the owner chose it
// here over the desktop row. What it costs: Child / Clear for youth / Reconnect / Block move into the ⋯
// sheet, Chat stays on the row.
//
// This is ALSO what fixes the private-messages panel. The two-column grid gave that column 137.5px at 900px
// wide, where a conversation name overflowed its card and ran under the chat icon (screenshots, 2026-10-14).
// The narrow branch never draws that column — private messages fold into a collapsible strip above the list
// — so the defect is unreachable below 1366 rather than patched. Hence the grid assertion first.
//
// Sabotage check, run 2026-10-14: putting `useStewNarrow()` back in DashMembers makes this test red at all
// three widths while every other test in this file stays green. The argument is load-bearing.
test('below 1366 the Members page is the one-line phone layout, and the two-column panel is gone', SKIP, async () => {
  for (const vw of [1280, 1024, 900]) {
    await setSize(vw, 900);
    const g = JSON.parse(await evalIn(COLUMNS));
    assert.equal(g.found, false,
      `at ${vw}px the Members panel is still drawing its two-column grid (${JSON.stringify(g)}) — DashMembers is not narrow here, so the private-messages column is back and a conversation name overflows it`);
    for (const p of [PEOPLE.adult, PEOPLE.adult2, PEOPLE.cleared]) {
      const m = await nameOf(p.name);
      assert.ok(m.cardH <= 60,
        `at ${vw}px ${p.name}'s card is ${m.cardH}px tall — that is the desktop row, not the one-line phone card`);
      assert.equal(m.ellipsised, false,
        `at ${vw}px "${p.name}" is CUT OFF on the phone card: the box is ${m.nameClientW}px and the text needs ${m.nameScrollW}px`);
      assert.ok(m.identTextW !== null && m.identTextW >= 12,
        `at ${vw}px ${p.name}'s "${m.identText}" is ${m.identTextW}px — the identity line has been squeezed out of the phone card too`);
      assert.ok(m.cardRight <= m.vw, `at ${vw}px ${p.name}'s card runs off the screen: right ${m.cardRight} of ${m.vw}`);
      console.log(`    ${vw}px ${p.name}: card ${m.cardH}px, name ${m.nameW}/${m.nameScrollW}px, @handle ${m.identTextW}px`);
    }
  }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// The phone card is a DIFFERENT branch of memberRow (`if (narrow)`, narrow = vw < 1366 on Members) and the floor must
// not reach it: it has its own one-row shape, measured at 56px. A floor that leaked in would push the card
// past the screen. (The phone card ellipsises a long name itself — that is older and not this fix's.)
test('the phone card is untouched: one row, inside the screen', SKIP, async () => {
  await setSize(360, 730);
  for (const p of [PEOPLE.adult, PEOPLE.cleared, PEOPLE.child]) {
    const m = await nameOf(p.name);
    assert.ok(m.cardH <= 60, `${p.name}'s phone card is ${m.cardH}px tall — the desktop row's floor has reached the phone branch`);
    assert.ok(m.cardRight <= m.vw, `${p.name}'s phone card runs off the screen: right ${m.cardRight} of ${m.vw}`);
  }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
