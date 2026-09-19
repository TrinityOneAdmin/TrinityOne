// EVERY TEAM CARD ON THE ROTA IS FULL HEIGHT, AND EVERY ASSIGN BUTTON CAN BE TAPPED — ON THE PHONE, BOTH WAYS UP.
//   Run: node --test scripts/the-rota-teams-are-reachable-on-the-phone.test.mjs
//
// Measured on the Oppo CPH2477 (360 x 730), a full church with three teams and six services, 2026-09-19
// (TrinityOne-internal/UI-AUDIT-console-2026-09-19.md, shots p/here/01-46-rota-full.png, l/here/01-47-rota-full.png):
// the Rota tab showed three HAIRLINES where the team cards should be. Computed `grid-template-rows: 10px 10px
// 10px 96px` in a 168px grid; each card had 196px of content, including every Assign button; `main` was 487px
// with a scrollHeight of 487, so nothing scrolled. In landscape (730 x 328) the cards were 2px. The rota's core
// action — Assign — was unreachable at both orientations.
//
// ── THE CAUSE, REPRODUCED AND NOT REASONED ─────────────────────────────────────────────────────────────────
// The team grid is `flex: 1; minHeight: 0; overflow: auto` inside a fixed-height flex column, and each team CARD
// is `overflow: hidden`. A grid item that is a scroll container has an automatic minimum size of 0 (CSS Grid §6.6
// / CSS Sizing: the `auto` minimum does not apply to scroll containers). So the `auto` rows' base size is 0, the
// definite-height grid shares its free space out among the rows, and the rows NEVER exceed the container —
// `overflow: auto` has nothing to scroll. In a scratch fixture (same styles, three 196px cards, headless
// Chromium): shipped → rows `132px 132px 132px` at 360x730 and `13px 107px` at 730x328, grid scrollHeight equal
// to its height; `gridAutoRows: 'max-content'` on the grid → rows `198px 198px 198px`, the grid scrolls, the
// cards are whole. `minHeight: 'max-content'` on the CARDS is not a fix: the cards grow but the tracks do not,
// so the cards overlap and the grid still does not scroll. The plan's first theory (align-self / align-content)
// was wrong; the plan audit found the real one.
//
// ── WHY THIS BOOTS A BROWSER ──────────────────────────────────────────────────────────────────────────────
// Nothing in the JSX says 10px. Grid track sizing is what the browser resolves, so the only honest instrument
// is the real steward console laid out in Chromium at the phone's exact CSS pixels, read back with
// getBoundingClientRect(). This satisfies CLAUDE.md rules 1 and 3 the strongest way available: the assertions
// are on the LIVE DOM of the compiled console, never on text in app/*.jsx, and `false && ` in front of the fix
// changes what the browser measures.
//
// The church here is seeded through the console's own Steward API (publishGroup / publishRoster /
// publishService), the same calls the setup wizard and the "New team" dialog make — never by writing relay
// documents by hand, which would silently drift from the real shape.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs, so CI without a browser is green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The viewports this file measures. The two phone ones are the Oppo CPH2477 both ways up, the sizes the
// defect was photographed at. The short desktop window is the owner's Suite window: the same collapse
// happens in any window the grid does not fit, it is just less dramatic there (measured here before the
// fix: rows 2px 96px at 1100x420).
//
// Landscape is a second defect on top of the row collapse, and the row property alone does not reach it:
// measured on the real console at 730x328, the header takes 207px, <main> has 121px, the service strip and
// the summary card already overrun the rota column, and the grid's box was 0px tall (459..459 with 467px of
// content) — whole cards behind no window at all. The phone floor on the grid (DashRota, `minHeight` when
// narrow) is what this row proves; delete it and this row fails while portrait still passes.
const VIEWS = [
  { name: 'portrait 360x730', w: 360, h: 730, mobile: true },
  { name: 'landscape 730x328', w: 730, h: 328, mobile: true },
  { name: 'short desktop 1100x420', w: 1100, h: 420, mobile: false },
];

let relay, chr, ws, prof, evalIn, send, booted = '', registered = '', seeded = null;
const errors = [];

async function setViewport(v) {
  await send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: v.mobile ? 2 : 1, mobile: v.mobile });
  await sleep(900);   // the console re-reads innerWidth on `resize` (useStewNarrow) and relays out
  const got = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
  assert.deepEqual(got, { w: v.w, h: v.h }, `the viewport is not ${v.name}`);
}

before(async () => {
  if (!CHROME) return;
  // A fresh, PRIVATE box with no churches, on a free port (no fixed-port collisions with a concurrent suite):
  // the church the console creates below registers itself on it, exactly as the wizard's name step does on a
  // Suite install (a-church-created-on-a-suite-box-publishes-to-it.test.mjs). That is what makes the
  // console's own writes — the teams, rosters and service seeded below — land somewhere it then reads them
  // back from. The gateway with a fixed CHURCH_NPUB (the-console-fits-a-360px-phone.test.mjs) is not that:
  // it holds a DIFFERENT church, so this console's writes would all be refused and the Rota would be empty.
  // Chromium is pointed at a black hole for the production hosts, as every browser test here is.
  relay = await H.startRelay({ name: 'rota-box' });
  const cdp = await H.freePort('the-rota-teams-are-reachable-on-the-phone.test.mjs (Chrome debug port)');
  prof = mkdtempSync(join(tmpdir(), 'trin-rota-fits-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, `--window-size=${VIEWS[0].w},${VIEWS[0].h}`,
    `${relay.base}/steward.html`], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
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
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
  await setViewport(VIEWS[0]);

  // ── KEEP THE FIRST-RUN WIZARD OFF THE SCREEN ──────────────────────────────────────────────────────────
  // Creating a church deliberately shows the setup wizard: a full-screen overlay with its own backdrop, and
  // step 0 has no exit (the-console-fits-a-360px-phone.test.mjs explains why it cannot cheaply be dismissed
  // and simply measures around it). This file cannot measure around it: `elementFromPoint` over an Assign
  // button would return the wizard's backdrop and every reachability claim below would be about the wizard.
  // The gate is `localStorage['trinityone.steward.wizard.done'] === '1'`, read once when the dashboard
  // mounts; the create path REMOVES that key on purpose (app/steward-root.jsx, seedNewChurch), so setting it
  // in advance is undone. This test-only shim keeps the key: `removeItem` ignores that one name inside this
  // Chromium profile. It touches nothing in the app and nothing this file asserts on — it only stops an
  // unrelated overlay from sitting on top of the thing under test.
  await evalIn(`(() => {
    localStorage.setItem('trinityone.steward.wizard.done', '1');
    const rm = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) { if (k === 'trinityone.steward.wizard.done') return; return rm.call(this, k); };
    return 'ok';
  })()`);

  // Drive the real path to a real dashboard, exactly as app-boots.test.mjs does: the console refuses to hold a
  // plaintext seed, so a seeded fixture would have to reproduce its AES-GCM format and would silently drift.
  const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
  const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
    if(!i) return 'miss';
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
  await sleep(9000);
  booted = await evalIn(click('/Start a new church/i'));
  await sleep(2500);
  await evalIn(type('At least 8', 'cedar-harbour-lamp-42'));
  await evalIn(type('Type it again', 'cedar-harbour-lamp-42'));
  await evalIn(click('/Set PIN/i'));
  await sleep(13000);

  // The wizard's name step, without the wizard: register the church on the box that serves this console
  // (`createHere` is the one opt-in that makes the serving box a registration target — the same call the
  // wizard's saveName makes, app/stew-dashboard.jsx), then give it a name. Until a box holds the church,
  // it refuses every one of the church's writes.
  registered = await evalIn(`(async () => {
    const S = window.Steward;
    try { await Promise.resolve(S.selfRegister('St Test on the Rota', { createHere: true })); } catch (e) { return 'selfRegister threw: ' + e.message; }
    const p = await Promise.resolve(S.publishProfile({ name: 'St Test on the Rota' }));
    return p ? 'ok' : 'profile not saved';
  })()`);
  await sleep(3000);

  // Then reload and unlock. The sockets this session opened were dialled BEFORE the box held the church, and
  // the name-key mint below refuses to act on a view it has not authenticated (steward.src.js, the mint gate);
  // a-church-created-on-a-suite-box-publishes-to-it.test.mjs records that "a reload and an unlock" is what
  // recovers this. The wizard flag survives the reload (only creating a church clears it), so no shim is
  // needed a second time; the PIN is the one set above.
  await send('Page.reload', { ignoreCache: false });
  await sleep(9000);
  const unlocked = await evalIn(type('Your PIN or passphrase', 'cedar-harbour-lamp-42'));
  assert.equal(unlocked, 'ok', 'no PIN field after the reload — the console did not remember its church');
  await evalIn(click('/^Unlock$/'));
  await sleep(12000);

  // ── A CHURCH WITH THREE SERVING TEAMS, ROLES ON EACH, AND ONE SERVICE ─────────────────────────────────
  // Through the console's own API — the calls the wizard's "serving team" step and the New team dialog make
  // (app/stew-dashboard.jsx, `publishGroup({ kind: 'team' })` then `publishRoster`). Each returns null when
  // the church key has not arrived or no relay accepted; the first test below refuses to go on in that case
  // rather than measure an empty Rota and call it fixed.
  const sunday = (() => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10); })();
  //
  // Rosters and services are SEALED under the church's name key, and a brand-new church has none: the wizard's
  // meetings step mints it on the create path with ensureNameKeyForMembers (app/stew-dashboard.jsx says why
  // — publishRoster / publishService wait NAME_KEY_WAIT_MS for a ring and then correctly return null rather
  // than write in the clear). So the seed mints it the same way first, and retries while the relay's answer
  // (which the mint waits for) is still on its way.
  seeded = JSON.parse(await evalIn(`(async () => {
    const S = window.Steward;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const teams = [['Welcome team', ['On the door', 'Coffee', 'Bibles']], ['Music', ['Leading', 'Keys', 'Drums']], ['Readings', ['Reader', 'Prayers']]];
    const out = { teams: [], rosters: [], service: null, nameKey: null, authedAfterMs: null };
    // The mint acts only on an AUTHENTICATED view, and the relay's NIP-42 challenge is lazy: it challenges
    // only when a REQ asks for something it withholds from an anonymous reader. A church that is minutes old
    // has nothing to withhold, so nothing here has been challenged yet. A safety-check response list is gated
    // to the church and its stewards whether or not one exists, so subscribing to it (the console's own API)
    // draws the challenge; the console signs it the way it always does (pool.automaticallyAuth).
    const off = S.subscribeSafetyResponses('rota-test-draws-the-challenge', () => {});
    const t0 = Date.now();
    for (let i = 0; i < 40 && !S.relayAuthed(); i++) await sleep(250);
    out.authedAfterMs = S.relayAuthed() ? Date.now() - t0 : null;
    try { off(); } catch (e) {}
    for (let i = 0; i < 10 && !out.nameKey; i++) {
      try { out.nameKey = (await Promise.resolve(S.ensureNameKeyForMembers([], []))) ? 'minted' : null; } catch (e) { out.nameKey = 'threw: ' + e.message; }
      if (!out.nameKey) await sleep(1500);
    }
    for (const [name, roles] of teams) {
      const g = await S.publishGroup({ name, kind: 'team', sub: 'Serving team' });
      out.teams.push(g && g.id ? g.id : null);
      if (!g || !g.id) continue;
      const r = await S.publishRoster(g.id, { roles: roles.map(n => ({ name: n })), people: [] });
      out.rosters.push(r ? 'ok' : null);
    }
    const svc = await S.publishService({ name: 'Sunday Gathering', date: ${JSON.stringify(sunday)}, time: '10:30' });
    out.service = svc && svc.id ? svc.id : null;
    // diagnostics for the failure message only: where this console thinks its church lives
    try { out.relays = S.relayList(); out.lives = S.whereChurchLives(); out.authed = S.relayAuthed(); out.status = S.relayStatus ? await Promise.resolve(S.relayStatus()) : null; out.boxhosts = localStorage.getItem('trinityone.steward.boxhosts.' + S.churchPub); } catch (e) { out.diag = 'threw: ' + e.message; }
    return JSON.stringify(out);
  })()`));
  await sleep(2500);   // the console learns of its own documents the way it learns of anyone's: from the relay
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { H.stopAll(); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

// The console's section buttons, wherever this build keeps them. Before feat/console-hamburger-nav the
// phone shows a strip of pills; after it the same buttons live in a drawer behind a ☰ (`aria-label="Sections"`)
// and exist only while it is open. This test must pass on either side of that merge — an audit of the two
// branches found it red 3/4 the moment they met — so: open the drawer if there is one, then look.
const SECTIONS_JS = `(async () => {
  const burger = document.querySelector('button[aria-label="Sections"]');
  if (burger && burger.getAttribute('aria-expanded') !== 'true') { burger.click(); await new Promise(r => setTimeout(r, 400)); }
  const scope = document.querySelector('[role="dialog"][aria-label="Sections"] nav') || document.querySelector('nav[aria-label="Console sections"]');
  return scope ? [...scope.querySelectorAll('button')].map(b => (b.textContent || '').trim()) : [];
})()`;
async function sectionLabels() { return evalIn(SECTIONS_JS); }

// Open one of the console's sections by pressing its real nav button, and prove we got there.
async function openTab(label) {
  const r = await evalIn(`(async () => {
    const burger = document.querySelector('button[aria-label="Sections"]');
    if (burger && burger.getAttribute('aria-expanded') !== 'true') { burger.click(); await new Promise(r => setTimeout(r, 400)); }
    const scope = document.querySelector('[role="dialog"][aria-label="Sections"] nav') || document.querySelector('nav[aria-label="Console sections"]');
    const b = scope && [...scope.querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith(${JSON.stringify(label)}));
    if (!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" button in the console's nav — re-anchor this test`);
  await sleep(2600);
}

// Every Assign button on the Rota, and the team card each one sits in.
//
// A card is found from its Assign button upwards: the ancestor whose parent is the grid (the nearest
// `display: grid` box). Nothing here matches text in app/*.jsx — the buttons are found by the accessible
// name the live DOM carries, and if that name ever changes the count assertion below says so, loudly.
//
// ⚠ REACHABILITY MUST NOT BE FAKED BY SCROLLING INSIDE THE CARD. Each card is `overflow: hidden`, which is a
// scroll container that a finger cannot move but `scrollIntoView` CAN — so a 10px card with a hidden Assign
// button would read as "reachable" after scrollIntoView had quietly scrolled the card itself. So after
// scrolling the button into view, every `overflow: hidden` ancestor is put back to scrollTop 0 — exactly
// where a steward's thumb leaves it — and only then is the hit test taken.
const MEASURE = `(() => {
  const assigns = [...document.querySelectorAll('main button[aria-label^="Assign someone to"]')];
  const cardOf = (b) => { let el = b; while (el.parentElement && getComputedStyle(el.parentElement).display !== 'grid') el = el.parentElement; return el; };
  const cards = [...new Set(assigns.map(cardOf))];
  const out = { cards: [], assigns: [], gridRows: null, geometry: null };
  if (cards.length) {
    const grid = cards[0].parentElement, main = document.querySelector('main');
    const rr = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
    out.gridRows = getComputedStyle(grid).gridTemplateRows;
    // where the height went, for the failure message: viewport, main, the rota's column, its two fixed rows, the grid
    out.geometry = { viewport: innerHeight, main: rr(main), mainScroll: [main.scrollTop, main.scrollHeight], rota: rr(grid.parentElement),
      above: [...grid.parentElement.children].filter(k => k !== grid && k.getBoundingClientRect().height > 0).map(rr), grid: rr(grid), gridScroll: [grid.scrollTop, grid.scrollHeight] };
  }
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    out.cards.push({ team: ((c.innerText || '').trim().split('\\n')[0] || '').slice(0, 24), height: Math.round(r.height), scrollHeight: c.scrollHeight });
  }
  for (const b of assigns) {
    b.scrollIntoView({ block: 'center', inline: 'nearest' });
    for (let el = b.parentElement; el; el = el.parentElement) { if (getComputedStyle(el).overflowY === 'hidden') el.scrollTop = 0; }
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    out.assigns.push({
      label: b.getAttribute('aria-label'), top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
      reachable: !!hit && (hit === b || b.contains(hit)),
      hit: hit ? hit.tagName.toLowerCase() + ' "' + (hit.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 30) + '"' : 'nothing (off-screen)',
    });
  }
  return JSON.stringify(out);
})()`;

test('the console reached its dashboard with three teams and a service — without which nothing below proves anything',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    assert.equal(booted, 'ok', 'the "Start a new church" button was never found');
    const labels = await sectionLabels();
    const nav = labels.length;
    assert.ok(nav >= 6, `the console's nav has ${nav} sections — it did not reach the dashboard, so every measurement below is of the wrong screen`);
    // Leave the drawer (if this build has one) closed again, so the geometry below is of the Rota, not the menu.
    await evalIn(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(registered, 'ok', 'the church did not register on its box, so nothing it publishes is stored: ' + registered);
    assert.ok(seeded && seeded.teams.every(Boolean) && seeded.teams.length === 3, 'the three teams were not all saved: ' + JSON.stringify(seeded));
    assert.deepEqual(seeded.rosters, ['ok', 'ok', 'ok'], 'the three rosters (which carry the roles the Assign buttons come from) were not all saved: ' + JSON.stringify(seeded));
    assert.ok(seeded.service, 'the service was not saved: ' + JSON.stringify(seeded));
    // the wizard shim: if the first-run wizard is up, every hit test below measures IT, so say so here
    const wizardUp = await evalIn(`(() => !![...document.querySelectorAll('input')].find(i => i.getAttribute('aria-label') === 'Church name'))()`);
    assert.equal(wizardUp, false, 'the first-run wizard is on screen — the reachability measurements below would be of its backdrop');
    assert.deepEqual(errors, [], 'the console threw while reaching its dashboard:\n  ' + errors.join('\n  '));
  });

for (const v of VIEWS) {
  test(`every team card is whole and every Assign button can be tapped — ${v.name}`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async (t) => {
      await setViewport(v);
      await openTab('Overview');   // leave and come back, so each size lays the Rota out afresh
      await openTab('Rota');
      // the eight Assign buttons come from the relay round-trip in before(); give a slow box a moment more
      let m = null;
      for (let i = 0; i < 12; i++) { m = JSON.parse(await evalIn(MEASURE)); if (m.assigns.length >= 8) break; await sleep(1000); }
      assert.ok(m.assigns.length >= 8, `expected the 8 Assign buttons of the 3 seeded teams on the Rota, found ${m.assigns.length} — the seed did not reach the screen, or the button's accessible name changed (re-anchor this test)`);
      assert.equal(m.cards.length, 3, `expected 3 team cards, found ${m.cards.length}: ${JSON.stringify(m.cards)}`);
      t.diagnostic(`${v.name}: grid rows ${m.gridRows}; cards ${m.cards.map(c => c.height + '/' + c.scrollHeight).join(' ')}; ${JSON.stringify(m.geometry)}`);

      // (1) nothing clipped: each card's box is at least as tall as its content. Before the fix, measured
      //     here: 10px cards over 196px of content in portrait, 2px in landscape.
      const clipped = m.cards.filter(c => c.height < c.scrollHeight - 1);
      assert.deepEqual(clipped, [], `${v.name}: team cards cut off (grid rows ${m.gridRows}):\n  ` + clipped.map(c => `${c.team}: ${c.height}px tall over ${c.scrollHeight}px of content`).join('\n  '));

      // (2) every Assign button is under the finger once its container is scrolled to it.
      const unreachable = m.assigns.filter(a => !a.reachable);
      assert.deepEqual(unreachable, [], `${v.name}: Assign buttons a steward cannot tap (geometry ${JSON.stringify(m.geometry)}):\n  ` + unreachable.map(a => `${a.label}: at y ${a.top}..${a.bottom}, the finger lands on ${a.hit}`).join('\n  '));
      assert.ok(m.assigns.every(a => a.height >= 40), `${v.name}: an Assign button is under 40px tall: ${JSON.stringify(m.assigns.map(a => a.height))}`);
      assert.deepEqual(errors, [], `the console threw on the Rota at ${v.name}:\n  ` + errors.join('\n  '));
    });
}
