// THE CONSOLE GOES NARROW WHEN IT SHRINKS (2026-11-13).
//   Run: node --test scripts/the-console-goes-narrow-when-it-shrinks.test.mjs
// Real steward.html off the real gateway in headless Chromium, the boot and seeding copied from
// the-member-row-is-one-line-on-the-console.test.mjs. The defect: the console's two width detectors
// (StewDashboard's own, and useStewNarrow behind every card) read window.innerWidth. The desktop header is
// 764px wide since 8fe85f1d added Messages, so once a console laid out wide was shrunk to a phone's width,
// mobile Chrome zoomed out to fit that header, innerWidth read 764, and the console never left the desktop
// layout: the header that caused the overflow stayed, and the join card's name column was 0px wide. That is
// a tablet or large phone rotated from landscape to portrait. A FRESH load at 360 never showed it.
// This drives the SCREEN, not the hook: it fails if the layout switch is deleted, broken, or reads innerWidth.
// Browser-rendered only: the device check (rotate a tablet with the console open) is separate.
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
const PORT = 8747, CDP = 9384;   // both free on 6b42955f (grep of scripts/ for each number)
const ROOT = new URL('..', import.meta.url).pathname;
const VW = 360, VH = 730, LW = 730, LH = 328, DW = 1280, DH = 900;
const PIN = 'cedar-harbour-lamp-42';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The church, and its people. Every pubkey is a stand-in the way batch-a's is; the names are what is read
// back off the screen, so each is distinct and none is a substring of another.
const WORDS = generateSeedWords();
const CHURCH_PK = getPublicKey(privateKeyFromSeedWords(WORDS));
const pk = (c) => c.repeat(64);
const NOW = Math.floor(Date.now() / 1000);
const PEOPLE = {
  adult:   { pubkey: pk('a'), name: 'Persephone Wilde', joined: NOW - 19 * 3600 },
  pending: { pubkey: pk('e'), name: 'Nia Okafor',       joined: NOW - 600 },
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
  await requireFreePort(PORT, 'the-console-goes-narrow-when-it-shrinks.test.mjs');
  await requireFreePort(CDP, 'the-console-goes-narrow-when-it-shrinks.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-narrow-shrink-'));
  // Chromium is pointed at a black hole for the production hosts: the console dials CANONICAL_RELAYS
  // regardless of who served the page (see app-boots.test.mjs). Nothing here reaches production.
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(CHURCH_PK), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-narrow-shrink-chr-' + process.pid);
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
// with an orientation, so the rotation case fires orientationchange the way a real phone does
const setSize = async (w, h, mobile = w < 1000) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile,
    screenOrientation: w > h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  await sleep(900);
};
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


const NIA = PEOPLE.pending.name;
// What a person sees after the shrink, read off the page: which layout is up, whether the page still
// overflows the screen, and Nia's join card (name width, clipped or not, actions under the name).
const READ = `(() => {
  const de = document.documentElement;
  const t = [...document.querySelectorAll('[data-join-card]')].find(c => (c.textContent||'').includes(${JSON.stringify(NIA)}));
  const out = { inner: innerWidth, client: de.clientWidth, scroll: de.scrollWidth,
    phoneHeader: !!document.querySelector('button[aria-label="Sections"]'), card: !!t };
  if (t) {
    t.scrollIntoView({ block: 'center' });
    const n = t.querySelector('[data-join-person] div div'), a = n.getBoundingClientRect(), p = t.querySelector('[data-join-actions]').getBoundingClientRect();
    Object.assign(out, { nameW: Math.round(a.width), nameBottom: a.bottom, actionsTop: p.top, clipped: n.scrollWidth > n.clientWidth + 1,
      text: n.textContent, right: Math.round(t.getBoundingClientRect().right) });
  }
  return JSON.stringify(out); })()`;
const read = async () => JSON.parse(await evalIn(READ));
async function settle(wantPhone) {   // polled: a resize re-renders on the next frame, a loaded box takes longer
  let m = await read();
  for (const t0 = Date.now(); m.phoneHeader !== wantPhone && Date.now() - t0 < 8000;) { await sleep(300); m = await read(); }
  return m;
}
function assertPhone(m, label) {
  assert.equal(m.phoneHeader, true, `${label}: still the DESKTOP layout after the shrink (no Sections button): ` + JSON.stringify(m));
  assert.ok(m.scroll <= m.client + 1, `${label}: the page is wider than the screen (${m.scroll}px in ${m.client}px): ` + JSON.stringify(m));
  assert.equal(m.card, true, `${label}: no join card for ${NIA}`);
  assert.ok(m.nameW >= 60, `${label}: the join card's name column is ${m.nameW}px wide: ` + JSON.stringify(m));
  assert.equal(m.clipped, false, `${label}: the name is clipped: ` + JSON.stringify(m));
  assert.equal(m.text, NIA);
  assert.ok(m.actionsTop >= m.nameBottom - 2, `${label}: the actions are not below the name: ` + JSON.stringify(m));
  assert.ok(m.right <= m.client, `${label}: the card runs off the screen: ` + JSON.stringify(m));
}

test('a console laid out at 1280px goes to the phone layout when shrunk to 360px, with the name visible', SKIP, async () => {
  await setSize(1280, 900);
  const wide = await settle(false);
  assert.equal(wide.phoneHeader, false, 'the instrument: at 1280 the console should be in its DESKTOP layout: ' + JSON.stringify(wide));
  await setSize(360, 730);
  const m = await settle(true);
  console.log('    1280 -> 360:', JSON.stringify({ inner: m.inner, client: m.client, scroll: m.scroll, nameW: m.nameW }));
  assertPhone(m, '1280 -> 360');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('a tablet console rotated from 900x390 landscape to 390x900 portrait goes to the phone layout, and back', SKIP, async () => {
  await setSize(900, 390, true);
  const wide = await settle(false);
  assert.equal(wide.phoneHeader, false, 'the instrument: at 900 landscape the console should be in its DESKTOP layout: ' + JSON.stringify(wide));
  await setSize(390, 900, true);
  const m = await settle(true);
  console.log('    900x390 -> 390x900:', JSON.stringify({ inner: m.inner, client: m.client, scroll: m.scroll, nameW: m.nameW }));
  assertPhone(m, '900 -> 390 rotation');
  // and back: rotating to landscape again returns the desktop layout (the switch works both ways)
  await setSize(900, 390, true);
  const back = await settle(false);
  assert.equal(back.phoneHeader, false, 'rotated back to 900 landscape, the console stayed in the PHONE layout: ' + JSON.stringify(back));
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

// THE DESKTOP TOP BAR FITS THE NARROWEST DESKTOP WINDOW (audit of 99eedc61, finding 2). At 760 the console
// is in its desktop layout, and the top bar (section title, Messages, Invite code, New post, Settings) was
// 764-775px wide there depending on the tab's title (Members, Overview, Resources), so the page scrolled
// sideways. That scroll also took a 15px scrollbar off the width, which made the overflow worse. A
// vertical scrollbar is forced on here as well (`overflow-y: scroll` on the root), the way a desktop
// browser with classic scrollbars shows one, so the bar is measured in the 745px that leaves.
const pickDesktopSection = async (label) => {
  const r = await evalIn(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Console sections"] button')].find(x => (x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" in the desktop sidebar — re-anchor this test`);
  await sleep(1500);
};
test('at a 760px desktop window with a scrollbar, the top bar fits on Members, Overview and Resources (no sideways scroll)', SKIP, async () => {
  await setSize(760, 900, false);
  const wide = await settle(false);
  assert.equal(wide.phoneHeader, false, 'the instrument: at 760 the console should be in its DESKTOP layout: ' + JSON.stringify(wide));
  await evalIn(`(() => { document.documentElement.style.overflowY = 'scroll'; return 1; })()`);
  try {
    for (const tab of ['Members', 'Overview', 'Resources']) {
      await pickDesktopSection(tab);
      const m = JSON.parse(await evalIn(`(() => { const de = document.documentElement;
        const h1 = [...document.querySelectorAll('h1')].find(h => h.getBoundingClientRect().width > 0);
        const set = document.querySelector('button[aria-label="Settings"]');
        return JSON.stringify({ client: de.clientWidth, scroll: de.scrollWidth, title: h1 && (h1.textContent||'').trim(), titleW: h1 && Math.round(h1.getBoundingClientRect().width),
          settingsRight: set && Math.round(set.getBoundingClientRect().right), settingsW: set && Math.round(set.getBoundingClientRect().width) }); })()`));
      console.log(`    760 ${tab}:`, JSON.stringify(m));
      assert.ok(m.client < 760, `${tab}: no vertical scrollbar was put up (clientWidth ${m.client}) — the instrument did not take`);
      assert.equal(m.title, tab, `${tab}: the page title is not the section that was opened`);
      assert.ok(m.scroll <= m.client, `${tab}: the page is ${m.scroll}px wide in a ${m.client}px window — it scrolls sideways: ` + JSON.stringify(m));
      assert.ok(m.titleW >= 30, `${tab}: the section title has been squeezed out of sight (${m.titleW}px): ` + JSON.stringify(m));
      assert.ok(m.settingsRight <= m.client && m.settingsW >= 36, `${tab}: the Settings button is off the edge or squeezed: ` + JSON.stringify(m));
    }
  } finally {
    await evalIn(`(() => { document.documentElement.style.overflowY = ''; return 1; })()`);
  }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
