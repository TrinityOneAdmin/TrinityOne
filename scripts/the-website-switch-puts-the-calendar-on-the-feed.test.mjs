// THE SWITCH IN SETTINGS PUTS THE CALENDAR ON THE FEED, AND THE TICK ON AN EVENT KEEPS THAT EVENT OFF IT.
//   Run: node --test scripts/the-website-switch-puts-the-calendar-on-the-feed.test.mjs
//
// reference/DESIGN-embeddable-church-info.md, phase 1 — the point of USE (CLAUDE.md rule 1). The relay half
// is proved by scripts/a-churchs-public-calendar-is-served-only-when-asked.test.mjs with hand-made documents.
// This file proves the SCREENS write those documents: delete the switch from Settings → Your website, or the
// "Not on the website" tick from the New event dialog, or the reconciler that writes the public copies, and
// this file goes red while the relay test stays green.
//
// A real scripts/gateway.mjs on a fresh private box (no churches: the wizard's first registration is the
// bootstrap one the gateway accepts), the real console in headless chromium driven through the real wizard
// name step, then Settings and the Calendar. The feed is fetched over HTTP from the box and parsed here.
// Rule 3: nothing matches text in app/*.jsx — every claim is a control found on screen, pressed, and a byte
// read back from the relay. Production hosts are black-holed in chromium (--host-resolver-rules) and the
// relay is told there is no tailscale (TRINITY_TAILSCALE_BIN).
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const SUPPER = 'Harvest supper, all welcome', HELD = 'Safeguarding review';
const NEXT_MONTH = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(3); return d.toISOString().slice(0, 10); })();
const NEXT_MONTH_5 = NEXT_MONTH.slice(0, 8) + '05';

let relay, chr, ws, prof, evalIn, reloadAndUnlock, churchPub = '', npub = '';
const errors = [];

// What the box holds, read from its OWN sqlite — not from anything the console could answer from cache.
function heldBy(cp, prefix) {
  const db = new DatabaseSync(join(relay.dataDir, 'relay.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT dtag, raw FROM events WHERE pubkey = ? AND kind = 30078 AND dtag LIKE ? ORDER BY dtag').all(cp, prefix + '%').map(r => {
      let e = {}; try { e = JSON.parse(String(r.raw || '')); } catch {}
      return { dtag: String(r.dtag), content: String(e.content || ''), tombstone: (e.tags || []).some(t => t[0] === 'deleted') || !e.content };
    });
  }
  finally { db.close(); }
}

// ── a tiny iCalendar reader (unfold, then VEVENT blocks) ──────────────────────────────────────────────────
function parseIcs(text) {
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'), 'not an iCalendar file: ' + JSON.stringify(text.slice(0, 40)));
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
  const cal = { props: {}, events: [] }; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { cal.events.push(cur); cur = null; continue; }
    const i = line.indexOf(':'); const name = line.slice(0, i).split(';')[0]; (cur || cal.props)[name] = line.slice(i + 1);
  }
  return cal;
}
const unescape = (s) => String(s).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
const feedUrl = () => `${relay.base}/public/${npub}/calendar.ics`;
async function pollFeed(pred, ms = 30000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < ms) { const r = await fetch(feedUrl()); last = { status: r.status, text: await r.text(), headers: r.headers }; if (pred(last)) return last; await sleep(400); }
  return last;
}

// ── driving the page ──────────────────────────────────────────────────────────────────────────────────────
const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
const clickSel = (sel) => `(() => { const b=document.querySelector(${JSON.stringify(sel)}); if(b){b.click();return 'ok';} return 'miss'; })()`;
const typeInto = (sel, val) => `(() => { const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
const typePh = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)})); if(!i) return 'miss';
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
async function waitFor(expr, ms = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await evalIn(expr)) return true; } catch {} await sleep(400); }
  throw new Error('timed out waiting for: ' + label);
}
const press = async (re, label) => { assert.equal(await evalIn(click(re)), 'ok', `nothing on screen matched ${label || re}`); await sleep(500); };

before(async () => {
  if (!CHROME) return;
  relay = await H.startRelay({ name: 'website', env: { TRINITY_TAILSCALE_BIN: '/nonexistent' } });
  const cdp = await H.freePort('the website-feed test\'s Chrome debug port');
  prof = mkdtempSync(join(tmpdir(), 'trin-website-chr-'));
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu', BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `${relay.base}/steward.html`], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

  // The real path: a new church, a PIN, the wizard's name step (which registers the church on this box).
  await waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'Start a new church');
  await press('/Start a new church/i');
  await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  assert.equal(await evalIn(typePh('At least 8', PIN)), 'ok');
  assert.equal(await evalIn(typePh('Type it again', PIN)), 'ok');
  await press('/Set PIN/i');
  await waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  churchPub = await evalIn(`window.Steward && window.Steward.churchPub || ''`);
  assert.match(churchPub, /^[0-9a-f]{64}$/, 'no church key after the PIN step');
  npub = await evalIn(`window.Steward.npub || ''`);
  assert.match(npub, /^npub1[a-z0-9]{58}$/);
  assert.equal(await evalIn(typeInto('input[aria-label="Church name"]', 'Grace Church, Milltown')), 'ok');
  await sleep(300);
  await press('/^Continue$/');
  // the box registered the church (church.json is written on the first registration)
  { const t0 = Date.now(); let ok = false; while (!ok && Date.now() - t0 < 30000) { try { ok = (JSON.parse(readFileSync(join(relay.dataDir, 'church.json'), 'utf8')).churches || []).some(c => c && c.npub === npub); } catch {} if (!ok) await sleep(400); } assert.ok(ok, 'the box never registered the church'); }
  await waitFor(`localStorage.getItem('trinityone.steward.boxhosts.' + window.Steward.churchPub) === '1'`, 30000, 'the console to learn the box holds it');
  // Past the wizard by the door the console itself uses when setup is finished: the done marker, then a
  // reload and an unlock. (The words/quiz step is a ceremony this file is not about.)
  reloadAndUnlock = async () => {
    await evalIn(`(() => { location.reload(); return 'ok'; })()`);
    await sleep(3000);
    await waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('Your PIN or passphrase'))`, 90000, 'the unlock screen');
    assert.equal(await evalIn(typePh('Your PIN or passphrase', PIN)), 'ok');
    await press('/^Unlock/');
    await waitFor(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]')`, 90000, 'the dashboard, with no wizard');
    await sleep(2500);
  };
  await evalIn(`(() => { localStorage.setItem('trinityone.steward.wizard.done', '1'); localStorage.removeItem('trinityone.steward.newchurch'); return 'ok'; })()`);
  await reloadAndUnlock();
  // ONE GROUP, THE WAY THE WIZARD'S "Create a few spaces" STEP WOULD HAVE MADE ONE — and it is load-bearing.
  // MEASURED 2026-09-22 on this branch: a church whose corpus holds NO private document is never challenged by
  // the relay (NIP-42 is lazy: it challenges on a WITHHELD event), so the console never authenticates, so
  // _ensureNameKeyLocked refuses to mint the church name key ("!_isRelayAuthed()"), so no event can be sealed
  // and every calendar save reads "not saved". A group document is private, so the next boot is challenged
  // on the first REQ that matches it. That is the steward's second day; this file is not about it, and the
  // finding is recorded in the branch report rather than fixed here.
  await press('/^Groups$/', 'the Groups section');
  await press('/^New group$/', 'New group');
  await waitFor(`!!document.querySelector('input[aria-label="Name"]')`, 20000, 'the New group dialog');
  assert.equal(await evalIn(typeInto('input[aria-label="Name"]', 'Whole church')), 'ok');
  await press('/^Create group$/', 'Create group');
  { const t0 = Date.now(); let n = 0; while (Date.now() - t0 < 20000) { n = heldBy(churchPub, 'trinityone/group:').length; if (n) break; await sleep(400); } assert.equal(n, 1, 'the group never reached the box'); }
  await reloadAndUnlock();
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  H.stopAll();
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const SKIP = !CHROME ? 'no chromium' : false;

test('CONTROL: the console reached its dashboard on its own box, and nothing is on the feed yet', { skip: SKIP, timeout: 240000 }, async () => {
  assert.equal(await evalIn(`window.Steward.whereChurchLives()`), 'this-computer', 'the console does not know the box holds its church — every publish below would go to a black hole');
  assert.equal(await evalIn(`window.Steward.ownRelay()`), relay.wsUrl);
  assert.equal((await fetch(feedUrl())).status, 404, 'a feed is served before the church switched anything on');
  assert.deepEqual(errors, [], 'the console threw while booting:\n  ' + errors.join('\n  '));
});

test('two events are added on the Calendar page — one with "Not on the website" ticked', { skip: SKIP, timeout: 240000 }, async () => {
  // The church name key, which seals every event. The dashboard mints it on mount for a new church; an event
  // saved before it lands is refused ("not saved") rather than written in the clear, so wait for it as a
  // steward who paused to read the screen would.
  await waitFor(`window.Steward.nameKeyReady && window.Steward.nameKeyReady()`, 60000, 'the church name key (nameKeyReady) — a fresh church never got one, so no event can be sealed');
  await press('/^Calendar$/', 'the Calendar section');
  const addOne = async (title, date, tick) => {
    await press('/^New event$/', 'New event');
    await waitFor(`!!document.querySelector('input[aria-label="Title"]')`, 20000, 'the New event dialog');
    assert.equal(await evalIn(typeInto('input[aria-label="Title"]', title)), 'ok');
    assert.equal(await evalIn(typeInto('input[aria-label="Date"]', date)), 'ok');
    assert.equal(await evalIn(typeInto('input[aria-label="Where"]', 'The church hall')), 'ok');
    const tickPresent = await evalIn(`!!document.querySelector('input[aria-label="Not on the website"]')`);
    assert.equal(tickPresent, true, 'THE "NOT ON THE WEBSITE" TICK IS NOT IN THE NEW EVENT DIALOG');
    if (tick) assert.equal(await evalIn(clickSel('input[aria-label="Not on the website"]')), 'ok');
    assert.equal(await evalIn(`document.querySelector('input[aria-label="Not on the website"]').checked`), !!tick, 'the tick did not take');
    await sleep(200);
    await press('/^Add event$/', 'Add event');
    await waitFor(`!document.querySelector('input[aria-label="Title"]')`, 30000, 'the dialog to close after saving');
  };
  await addOne(SUPPER, NEXT_MONTH, false);
  await addOne(HELD, NEXT_MONTH_5, true);
  // the box holds two SEALED event documents (ciphertext: the relay cannot read them), and the opt-out
  { const t0 = Date.now(); let ev = []; while (Date.now() - t0 < 20000) { ev = heldBy(churchPub, 'trinityone/event:'); if (ev.length >= 2) break; await sleep(400); }
    assert.equal(ev.length, 2, 'the box holds ' + ev.length + ' event documents');
    for (const e of ev) { assert.ok(/^\{"e":"/.test(e.content), 'an event reached the box in the clear: ' + e.content.slice(0, 60)); } }
  { const t0 = Date.now(); let sh = []; while (Date.now() - t0 < 20000) { sh = heldBy(churchPub, 'trinityone/share:'); if (sh.length) break; await sleep(400); }
    assert.equal(sh.length, 1, 'ticking "Not on the website" wrote no share: document');
    const c = JSON.parse(sh[0].content);
    assert.equal(c.calendar, false, 'the tick switched the calendar ON');
    assert.equal(c.optOut.length, 1, 'the tick recorded ' + c.optOut.length + ' opt-outs, not 1'); }
  assert.equal(heldBy(churchPub, 'trinityone/pubevent:').length, 0, 'public copies were written while the switch is OFF');
  assert.equal((await fetch(feedUrl())).status, 404, 'a feed is served while the switch is OFF');
});

test('Settings → Your website → the switch: the feed appears at the address shown, with the supper and without the held event', { skip: SKIP, timeout: 240000 }, async () => {
  await press('/^Settings$/', 'the Settings section');
  await waitFor(`[...document.querySelectorAll('button.set-item')].some(b => /Your website/.test(b.textContent||''))`, 20000, 'the Your website row');
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('button.set-item')].find(b => /Your website/.test(b.textContent||'')); b.click(); return 'ok'; })()`), 'ok');
  await waitFor(`!!document.querySelector('button[aria-label="Share our calendar on our website"]')`, 20000, 'the switch');
  assert.equal(await evalIn(`document.querySelector('button[aria-label="Share our calendar on our website"]').getAttribute('aria-checked')`), 'false', 'the switch is already on');
  assert.equal(await evalIn(`!!document.querySelector('input[aria-label="Feed address"]')`), false, 'the feed address is shown while sharing is off');
  await waitFor(`!document.querySelector('button[aria-label="Share our calendar on our website"]').disabled`, 20000, 'the switch to be enabled (the engine has answered)');
  assert.equal(await evalIn(clickSel('button[aria-label="Share our calendar on our website"]')), 'ok');
  await waitFor(`document.querySelector('button[aria-label="Share our calendar on our website"]').getAttribute('aria-checked') === 'true'`, 20000, 'the switch to read on');
  const shown = await evalIn(`(document.querySelector('input[aria-label="Feed address"]') || {}).value || ''`);
  assert.equal(shown, feedUrl(), 'the address on screen is not the address the box serves');
  const r = await pollFeed(x => x.status === 200 && x.text.includes('SUMMARY'));
  assert.equal(r.status, 200, 'THE SWITCH IS ON AND THE FEED IS STILL A 404 — the console wrote no share: document, or no public copies');
  assert.equal(r.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.equal(r.headers.get('set-cookie'), null, 'a cookie was set on the public feed');
  const cal = parseIcs(r.text);
  assert.equal(unescape(cal.props['X-WR-CALNAME']), 'Grace Church, Milltown', 'the feed is not named after the church');
  const titles = cal.events.map(e => unescape(e.SUMMARY));
  assert.deepEqual(titles, [SUPPER], 'the feed holds ' + JSON.stringify(titles) + ' — it must hold the supper and NOT the held event');
  assert.equal(cal.events[0].DTSTART, NEXT_MONTH.replace(/-/g, '') + 'T193000', 'the supper is not at its date and time');
  assert.equal(unescape(cal.events[0].LOCATION), 'The church hall');
  assert.equal(/\b(https?|wss?):\/\//.test(r.text), false, 'the feed carries a URL: ' + (r.text.match(/\b(https?|wss?):\/\/\S+/) || [])[0]);
  assert.equal(r.text.includes(HELD), false, 'THE HELD EVENT LEAKED');
  // and the box holds exactly one public copy — the supper's, in the clear, with the noticeboard fields only
  const copies = heldBy(churchPub, 'trinityone/pubevent:').filter(c => !c.tombstone);
  assert.equal(copies.length, 1, 'the box holds ' + copies.length + ' live public copies, not 1');
  const body = JSON.parse(copies[0].content);
  assert.deepEqual(Object.keys(body).sort(), ['blurb', 'date', 'day', 'recur', 'time', 'title', 'where'], 'the public copy carries fields beyond the noticeboard ones: ' + Object.keys(body));
  assert.equal(body.title, SUPPER);
  // the per-event address works for the public one and is a 404 for the held one
  const supperId = copies[0].dtag.slice('trinityone/pubevent:'.length);
  assert.equal((await fetch(`${relay.base}/public/${npub}/e/${supperId}.ics`)).status, 200);
  const heldId = JSON.parse(heldBy(churchPub, 'trinityone/share:')[0].content).optOut[0];
  assert.equal((await fetch(`${relay.base}/public/${npub}/e/${heldId}.ics`)).status, 404, 'the held event is served at its own address');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('Copy copies the address that is on screen', { skip: SKIP, timeout: 60000 }, async () => {
  // a fake clipboard, because a headless page has no real one; the Copy control must still hand it the URL
  await evalIn(`(() => { window.__copied = ''; const orig = document.execCommand; document.execCommand = function (c) { if (c === 'copy') { window.__copied = String(getSelection()); return true; } return orig.apply(this, arguments); };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = String(t); } }, configurable: true }); return 'ok'; })()`);
  assert.equal(await evalIn(clickSel('button[aria-label="Copy feed address"]')), 'ok', 'no Copy control beside the address');
  await sleep(300);
  assert.equal(await evalIn(`window.__copied`), feedUrl(), 'Copy did not put the feed address on the clipboard');
});

test('after a fresh boot, an event added with Settings never opened joins the feed — the mirror runs from the dashboard root', { skip: SKIP, timeout: 240000 }, async () => {
  // A NEW SESSION, so nothing Settings started earlier is still running: the only thing that can be watching
  // the calendar now is what the dashboard itself mounts.
  await reloadAndUnlock();
  await waitFor(`window.Steward.nameKeyReady && window.Steward.nameKeyReady()`, 60000, 'the church name key after the reload');
  await press('/^Calendar$/', 'the Calendar section');
  await press('/^New event$/', 'New event');
  await waitFor(`!!document.querySelector('input[aria-label="Title"]')`, 20000, 'the New event dialog');
  assert.equal(await evalIn(typeInto('input[aria-label="Title"]', 'Carol service')), 'ok');
  assert.equal(await evalIn(typeInto('input[aria-label="Date"]', NEXT_MONTH.slice(0, 8) + '20')), 'ok');
  await press('/^Add event$/', 'Add event');
  await waitFor(`!document.querySelector('input[aria-label="Title"]')`, 30000, 'the dialog to close after saving');
  const r = await pollFeed(x => x.status === 200 && x.text.includes('Carol service'));
  const titles = parseIcs(r.text).events.map(e => unescape(e.SUMMARY)).sort();
  assert.deepEqual(titles, [SUPPER, 'Carol service'].sort(),
    'the feed holds ' + JSON.stringify(titles) + ' — an event added while the switch is on must reach it without the steward touching Settings again');
  assert.equal(r.text.includes(HELD), false, 'THE HELD EVENT LEAKED');
});

test('a tick saved in the seconds after a reconnect keeps the switch on and every earlier opt-out — the audit\'s restart window', { skip: SKIP, timeout: 240000 }, async () => {
  // Audit of 7ffcfaf, findings 1 and 2. The dashboard restarts the website watch on every connection bump
  // (laptop wake, a dropped socket). The first engine started that restart from the defaults, so a tick saved
  // before the relay had answered rewrote share: as {calendar:false, optOut:[the new id]} — the switch went
  // off and the held event's opt-out was gone; the next "on" put "Safeguarding review" on the website. This
  // makes the exact call the dashboard makes and ticks in the same tick, through the shipped API.
  const before = JSON.parse(heldBy(churchPub, 'trinityone/share:')[0].content);
  assert.equal(before.calendar, true, 're-anchor: the switch is not on going into this row');
  assert.equal(before.optOut.length, 1, 're-anchor: the held event is not recorded going into this row');
  const r = await evalIn(`(async () => { window.Steward.subscribeWebsiteShare(() => {}, { restart: true }); const ok = await window.Steward.setWebsiteHeld('evtaudit1', true); return JSON.stringify({ ok }); })()`);
  const after = JSON.parse(heldBy(churchPub, 'trinityone/share:')[0].content);
  assert.equal(after.calendar, true, 'THE TICK SWITCHED THE CALENDAR OFF (setWebsiteHeld returned ' + r + ')');
  assert.ok(after.optOut.includes(before.optOut[0]), 'THE TICK DISCARDED THE EARLIER OPT-OUT (setWebsiteHeld returned ' + r + '): ' + JSON.stringify(after.optOut));
  const feed = await fetch(feedUrl());
  assert.equal(feed.status, 200, 'the feed went away after a tick in the restart window');
  assert.equal((await feed.text()).includes(HELD), false, 'THE HELD EVENT LEAKED after a tick in the restart window');
  // …and the Settings switch in the same window: off then on must keep the opt-out
  await press('/^Settings$/', 'the Settings section');
  await waitFor(`[...document.querySelectorAll('button.set-item')].some(b => /Your website/.test(b.textContent||''))`, 20000, 'the Your website row');
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('button.set-item')].find(b => /Your website/.test(b.textContent||'')); b.click(); return 'ok'; })()`), 'ok');
  await waitFor(`document.querySelector('button[aria-label="Share our calendar on our website"]') && !document.querySelector('button[aria-label="Share our calendar on our website"]').disabled`, 20000, 'the switch');
  await evalIn(`window.Steward.subscribeWebsiteShare(() => {}, { restart: true }); 'ok'`);
  assert.equal(await evalIn(clickSel('button[aria-label="Share our calendar on our website"]')), 'ok');
  await waitFor(`document.querySelector('button[aria-label="Share our calendar on our website"]').getAttribute('aria-checked') === 'false'`, 20000, 'the switch to read off');
  const off = JSON.parse(heldBy(churchPub, 'trinityone/share:')[0].content);
  assert.equal(off.calendar, false);
  assert.ok(off.optOut.includes(before.optOut[0]), 'SWITCHING OFF IN THE RESTART WINDOW DROPPED THE OPT-OUT: ' + JSON.stringify(off.optOut));
  assert.equal(await evalIn(clickSel('button[aria-label="Share our calendar on our website"]')), 'ok');
  await waitFor(`document.querySelector('button[aria-label="Share our calendar on our website"]').getAttribute('aria-checked') === 'true'`, 20000, 'the switch to read on');
  const back = await pollFeed(x => x.status === 200 && x.text.includes('SUMMARY'));
  assert.equal(back.text.includes(HELD), false, 'THE HELD EVENT LEAKED after off-then-on in the restart window');
});

test('the switch off: the feed is a 404 again and every public copy is tombstoned', { skip: SKIP, timeout: 240000 }, async () => {
  await press('/^Settings$/', 'the Settings section');
  await waitFor(`[...document.querySelectorAll('button.set-item')].some(b => /Your website/.test(b.textContent||''))`, 20000, 'the Your website row');
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('button.set-item')].find(b => /Your website/.test(b.textContent||'')); b.click(); return 'ok'; })()`), 'ok');
  await waitFor(`document.querySelector('button[aria-label="Share our calendar on our website"]') && document.querySelector('button[aria-label="Share our calendar on our website"]').getAttribute('aria-checked') === 'true'`, 20000, 'the switch, reading on');
  assert.equal(await evalIn(clickSel('button[aria-label="Share our calendar on our website"]')), 'ok');
  await waitFor(`document.querySelector('button[aria-label="Share our calendar on our website"]').getAttribute('aria-checked') === 'false'`, 20000, 'the switch to read off');
  const r = await pollFeed(x => x.status === 404);
  assert.equal(r.status, 404, 'THE SWITCH IS OFF AND THE FEED IS STILL SERVED');
  const t0 = Date.now(); let live = null;
  while (Date.now() - t0 < 30000) { live = heldBy(churchPub, 'trinityone/pubevent:').filter(c => !c.tombstone); if (!live.length) break; await sleep(400); }
  assert.deepEqual(live, [], 'plaintext public copies are still on the box after the switch went off');
  assert.equal(await evalIn(`!!document.querySelector('input[aria-label="Feed address"]')`), false, 'the feed address is still shown with sharing off');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});
