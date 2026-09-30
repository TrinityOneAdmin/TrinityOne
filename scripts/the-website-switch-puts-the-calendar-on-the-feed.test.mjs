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
import { unfoldIcs } from './public-calendar.mjs';   // the inverse of the builder's own fold — see the byte-scan below

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PIN = 'cedar-harbour-lamp-42';
const SUPPER = 'Harvest supper, all welcome', HELD = 'Safeguarding review', YOUTH = 'Leaders’ planning evening';
const NEXT_MONTH = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(3); return d.toISOString().slice(0, 10); })();
const NEXT_MONTH_5 = NEXT_MONTH.slice(0, 8) + '05';

let relay, chr, ws, prof, evalIn, cdpSend, reloadAndUnlock, churchPub = '', npub = '';
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
  cdpSend = send;                 // the viewport rows below drive Emulation.setDeviceMetricsOverride
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


// WHERE THE TICK SITS ON A REAL SCREEN (owner, 2026-09-22). Driven at 1280x1000 the New event dialog put the
// website tick below the cover-image picker and the note box, off the bottom: a steward had to scroll past
// two optional fields to reach the control that decides whether the event becomes public. This reads the
// GEOMETRY of the rendered dialog — getBoundingClientRect, not the order of anything in app/*.jsx.
const aboveIn = (tick, other) => `(() => {
  const t = document.querySelector('input[aria-label=${JSON.stringify(tick)}]');
  const o = (${other});
  if (!t) return 'no-tick'; if (!o) return 'no-other';
  return t.getBoundingClientRect().top < o.getBoundingClientRect().top ? 'above' : 'below';
})()`;
const COVER = `[...document.querySelectorAll('label')].find(l => /Add a photo/.test(l.textContent || ''))`;
const NOTE = `document.querySelector('textarea[aria-label="Note (optional)"]')`;
const DETAILS = `document.querySelector('textarea[aria-label="Details"]')`;

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
    assert.equal(await evalIn(aboveIn('Not on the website', COVER)), 'above',
      'THE WEBSITE TICK IS BELOW THE COVER IMAGE PICKER on a real screen — a steward has to scroll past the photo and the note to reach the control that decides whether the event is public');
    assert.equal(await evalIn(aboveIn('Not on the website', NOTE)), 'above', 'THE WEBSITE TICK IS BELOW THE NOTE BOX on a real screen');
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
  // unfolded, for the reason the sibling file's scan gives (audit F6): a fold hides a long string from includes()
  const flat = unfoldIcs(r.text);
  assert.equal(/\b(https?|wss?):\/\//.test(flat), false, 'the feed carries a URL: ' + (flat.match(/\b(https?|wss?):\/\/\S+/) || [])[0]);
  assert.equal(flat.includes(churchPub), false, 'the feed carries the church\'s key in hex');
  assert.equal(flat.includes(HELD), false, 'THE HELD EVENT LEAKED');
  // and the box holds exactly one public copy — the supper's, in the clear, with the noticeboard fields only
  const copies = heldBy(churchPub, 'trinityone/pubevent:').filter(c => !c.tombstone);
  assert.equal(copies.length, 1, 'the box holds ' + copies.length + ' live public copies, not 1');
  const body = JSON.parse(copies[0].content);
  // `nth` joined the noticeboard fields with dcc11dc (S-7, the owner's "monthly can pick the week"): which week of
  // the month a monthly meeting falls on, so the website can say "3rd Saturday". Same class as `day` and `recur` —
  // when, never who. This list went stale on that commit and the test failed over correct output (found 2026-09-30).
  assert.deepEqual(Object.keys(body).sort(), ['blurb', 'date', 'day', 'nth', 'recur', 'time', 'title', 'where'], 'the public copy carries fields beyond the noticeboard ones: ' + Object.keys(body));
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

test('a GROUP\'s event stays OFF the feed until "On the website" is ticked for it — adults-only rooms are withheld from the church\'s own children, so they never reach the website by default', { skip: SKIP, timeout: 240000 }, async () => {
  // Audit of 02b6cf3, F2; owner decision 2026-09-22. The relay's read gate withholds an adults-only group's
  // event from the church's minors; the first mirror put every event on the public feed regardless. Now an
  // event scoped to a group is mirrored only when the steward ticks it on, per item, in the event's dialog.
  await press('/^Groups$/', 'the Groups section');
  await press('/^New group$/', 'New group');
  await waitFor(`!!document.querySelector('input[aria-label="Name"]')`, 20000, 'the New group dialog');
  assert.equal(await evalIn(typeInto('input[aria-label="Name"]', 'Youth leaders')), 'ok');
  await press('/^Create group$/', 'Create group');
  { const t0 = Date.now(); let n = 0; while (Date.now() - t0 < 20000) { n = heldBy(churchPub, 'trinityone/group:').length; if (n >= 2) break; await sleep(400); } assert.equal(n, 2, 'the second group never reached the box'); }
  await press('/^Calendar$/', 'the Calendar section');
  await press('/^New event$/', 'New event');
  await waitFor(`!!document.querySelector('input[aria-label="Title"]')`, 20000, 'the New event dialog');
  assert.equal(await evalIn(typeInto('input[aria-label="Title"]', YOUTH)), 'ok');
  assert.equal(await evalIn(typeInto('input[aria-label="Date"]', NEXT_MONTH.slice(0, 8) + '12')), 'ok');
  assert.equal(await evalIn(typeInto('input[aria-label="Where"]', 'The vicarage')), 'ok');
  // scope it to the group — the chip carries the group's name
  await press('/^Youth leaders$/', 'the Youth leaders chip');
  assert.equal(await evalIn(`!!document.querySelector('input[aria-label="Not on the website"]')`), false, 'a GROUP event still offers "Not on the website" — the default for a group event is off, so the tick must be the inverse');
  assert.equal(await evalIn(`!!document.querySelector('input[aria-label="On the website"]')`), true, 'THE "ON THE WEBSITE" TICK IS NOT IN THE NEW EVENT DIALOG for a group event');
  assert.equal(await evalIn(`document.querySelector('input[aria-label="On the website"]').checked`), false, 'the tick is on by default');
  assert.equal(await evalIn(aboveIn('On the website', COVER)), 'above',
    'A GROUP EVENT\'S TICK IS BELOW THE COVER IMAGE PICKER on a real screen — the two ticks are the same control in two states and must sit in the same place');
  assert.equal(await evalIn(aboveIn('On the website', NOTE)), 'above', 'a group event\'s tick is below the note box on a real screen');
  await press('/^Add event$/', 'Add event');
  await waitFor(`!document.querySelector('input[aria-label="Title"]')`, 30000, 'the dialog to close after saving');
  // the event reached the box, sealed and group-tagged; then give the mirror its window and read the feed
  { const t0 = Date.now(); let ev = []; while (Date.now() - t0 < 20000) { ev = heldBy(churchPub, 'trinityone/event:'); if (ev.length >= 4) break; await sleep(400); } assert.equal(ev.length, 4, 'the box holds ' + ev.length + ' event documents, not 4'); }
  await sleep(4000);
  const off = await fetch(feedUrl());
  assert.equal(off.status, 200, 're-anchor: the feed is not on going into this row');
  assert.equal((await off.text()).includes(YOUTH), false, 'A GROUP\'S EVENT WAS PUT ON THE PUBLIC FEED WITHOUT ANYONE TICKING IT ON');
  assert.equal(heldBy(churchPub, 'trinityone/pubevent:').filter(c => !c.tombstone && c.content.includes(YOUTH)).length, 0, 'the box holds a public copy of the group event');
  // now the steward puts it on, from the event's own Edit dialog
  assert.equal(await evalIn(clickSel('button[title="Next month"]')), 'ok', 'no month-forward control on the calendar');
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('button[title="See what’s on this day"]')].find(x=>(x.textContent||'').includes(${JSON.stringify(YOUTH)})); if(b){b.click();return 'ok';} return 'miss'; })()`), 'ok', 'the day holding the group event is not on the calendar');
  await sleep(500);
  assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('[role="button"]')].find(x=>(x.textContent||'').includes(${JSON.stringify(YOUTH)})); if(b){b.click();return 'ok';} return 'miss'; })()`), 'ok', 'the event card did not open');
  await press('/^Edit$/', 'Edit');
  await waitFor(`!!document.querySelector('input[aria-label="On the website"]')`, 20000, 'the "On the website" tick in the Edit dialog');
  assert.equal(await evalIn(`document.querySelector('input[aria-label="On the website"]').checked`), false, 'Edit opened with the tick on');
  assert.equal(await evalIn(aboveIn('On the website', DETAILS)), 'above',
    'THE WEBSITE TICK IS BELOW THE DETAILS BOX IN THE EDIT DIALOG on a real screen');
  assert.equal(await evalIn(clickSel('input[aria-label="On the website"]')), 'ok');
  assert.equal(await evalIn(`document.querySelector('input[aria-label="On the website"]').checked`), true, 'the tick did not take');
  await press('/^Save changes$/', 'Save changes');
  const on = await pollFeed(x => x.status === 200 && x.text.includes(YOUTH));
  assert.equal(on.text.includes(YOUTH), true, 'THE STEWARD TICKED THE GROUP EVENT ON AND IT IS STILL NOT ON THE FEED');
  const share = JSON.parse(heldBy(churchPub, 'trinityone/share:')[0].content);
  assert.equal(share.calendar, true, 'the tick switched the calendar off');
  assert.equal(share.optOut.length, 1, 'the tick disturbed the earlier opt-out: ' + JSON.stringify(share.optOut));
  assert.equal(on.text.includes(HELD), false, 'THE HELD EVENT LEAKED');
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
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

// ── F2: THE TICK IS ON SCREEN WITHOUT SCROLLING, WHICH ORDER ALONE NEVER SAID ────────────────────────────
// AUDIT-feeds-round5-2026-09-22 F2. The `aboveIn` rows above pin the tick's ORDER and nothing else, and
// `clickSel` clicks an off-screen element happily — so all of them passed while the Edit dialog's tick sat
// 185px BELOW THE FOLD of its own scroll box at 1280x1000 AND at 1100x657, with document.elementFromPoint at
// its centre returning a DIV. Measured here, at this tip, before the fix:
//
//   EDIT  whole-church  1280x1000  tick 786..804  scroller DIV 381..619 clientH=238 scrollH=659  scrollNeeded 185  hit DIV
//   EDIT  group         1100x657   tick 615..633  scroller DIV 209..448 clientH=238 scrollH=659  scrollNeeded 185  hit DIV
//
// The cause was not where the tick sits in the form. SchEventDetail rendered SchEventEdit INSIDE its own
// card, and that card carries `animation: lumenScale … both`, whose identity transform makes it the
// containing block for a `position: fixed` descendant — so the Edit dialog's backdrop was 267px tall instead
// of the viewport, and its scroll box 238px for 659px of content. Everything past about 240px of that form
// was off it, "Save changes" included. SchEventDetail now RETURNS the Edit dialog instead of nesting it.
//
// These rows read real geometry at TWO viewports. `scrollNeeded` is `tick.bottom − scroller.bottom` (<= 0
// means no scrolling is needed to reach it) and `hitIsTheTick` is document.elementFromPoint at its centre.
const TICK_GEOM = (label) => `(() => {
  const t = document.querySelector('input[aria-label="LABEL"]');
  if (!t) return { err: 'no tick called LABEL' };
  const r = t.getBoundingClientRect();
  let n = t.parentElement, sc = null;
  while (n) { const st = getComputedStyle(n); if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 1) { sc = n; break; } n = n.parentElement; }
  const sr = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
  const mid = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return { viewport: innerWidth + 'x' + innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom),
           clientH: sc ? sc.clientHeight : innerHeight, scrollH: sc ? sc.scrollHeight : innerHeight,
           scrollNeeded: Math.round(r.bottom - sr.bottom), hitIsTheTick: mid === t, hit: mid ? mid.tagName : 'none' };
})()`.split('LABEL').join(label);
const viewport = async (w, h) => { await cdpSend('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(700); };
// A CONSOLE WINDOW, and a SHORT one. 1280x1000 is the size the owner's placement request was measured at;
// 1100x657 is a laptop window with browser chrome, and is the size that made the New dialog's shortfall show.
const CONSOLE_SIZES = [[1280, 1000], [1100, 657]];

test('F2: the website tick is ON SCREEN without scrolling in the EDIT dialog, at two console sizes', { skip: SKIP, timeout: 300000 }, async () => {
  const openEditOn = async (title) => {
    await press('/^Calendar$/', 'the Calendar section');
    await sleep(700);
    let hit = 'miss';
    for (let i = 0; i < 4 && hit !== 'ok'; i++) {
      hit = await evalIn(`(() => { const b=[...document.querySelectorAll('button[title="See what’s on this day"]')].find(x=>(x.textContent||'').includes(${JSON.stringify(title)})); if(b){b.click();return 'ok';} return 'miss'; })()`);
      if (hit !== 'ok') { assert.equal(await evalIn(clickSel('button[title="Next month"]')), 'ok', 'no month-forward control on the calendar'); await sleep(700); }
    }
    assert.equal(hit, 'ok', 'the day holding ' + title + ' is not on the calendar');
    await sleep(600);
    assert.equal(await evalIn(`(() => { const b=[...document.querySelectorAll('[role="button"]')].find(x=>(x.textContent||'').includes(${JSON.stringify(title)})); if(b){b.click();return 'ok';} return 'miss'; })()`), 'ok', 'the event card did not open');
    await sleep(600);
    await press('/^Edit$/', 'Edit');
    await sleep(900);
  };
  const closeAll = async () => {
    await evalIn(`(() => { for (const b of [...document.querySelectorAll('button')]) if ((b.textContent||'').trim() === 'Cancel') { b.click(); break; } return 'ok'; })()`);
    await sleep(600);
    await evalIn(`(() => { for (const b of document.querySelectorAll('button[title="Close"]')) b.click(); return 'ok'; })()`);
    await sleep(600);
  };
  try {
    for (const [title, label] of [[SUPPER, 'Not on the website'], [YOUTH, 'On the website']]) {
      await viewport(1280, 1000);
      await openEditOn(title);
      for (const [w, h] of CONSOLE_SIZES) {
        await viewport(w, h);
        const g = await evalIn(TICK_GEOM(label));
        assert.ok(!g.err, `the Edit dialog draws no "${label}" tick at ${w}x${h}: ${JSON.stringify(g)}`);
        assert.ok(g.scrollNeeded <= 0,
          `THE WEBSITE TICK IS ${g.scrollNeeded}px BELOW THE FOLD of the Edit dialog's scroll box at ${w}x${h} — a steward must scroll to reach the control that decides whether the event is public, and every order assertion in this file passes anyway: ${JSON.stringify(g)}`);
        assert.equal(g.hitIsTheTick, true,
          `THE TICK IS NOT WHAT IS AT ITS OWN CENTRE at ${w}x${h} (elementFromPoint returned ${g.hit}) — it is covered or clipped: ${JSON.stringify(g)}`);
      }
      await viewport(1280, 1000);
      await closeAll();
    }
  } finally { await cdpSend('Emulation.clearDeviceMetricsOverride', {}); await sleep(500); }
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
});

test('F2: …and in the NEW event dialog at a console size, with the short-window shortfall stated rather than claimed away', { skip: SKIP, timeout: 300000 }, async () => {
  // HONEST ABOUT WHAT IS NOT REACHED. The New event dialog carries "Belongs to" and its group chips, so its
  // form is 878px where Edit's is 659px, and the owner's placement (2026-09-22) puts the tick INSIDE the
  // Belongs-to block — the answer there decides which of the two ticks is drawn at all, so it cannot move
  // above it. At 1280x1000 the tick is comfortably on screen. At 1100x657 — a short laptop window — it is
  // about 40px under, and this row asserts that SMALL number rather than pretending it is zero: the
  // regression it exists to catch is the original one, where the tick sat below the cover-image picker and
  // the note box, 300px further down.
  try {
    await press('/^Calendar$/', 'the Calendar section');
    await press('/^New event$/', 'New event');
    await waitFor(`!!document.querySelector('input[aria-label="Title"]')`, 20000, 'the New event dialog');
    await viewport(1280, 1000);
    const big = await evalIn(TICK_GEOM('Not on the website'));
    assert.ok(!big.err, 'the New event dialog draws no tick at 1280x1000: ' + JSON.stringify(big));
    assert.ok(big.scrollNeeded <= 0,
      `THE NEW EVENT DIALOG'S TICK IS ${big.scrollNeeded}px BELOW THE FOLD at 1280x1000 — the size the owner's request was measured at: ` + JSON.stringify(big));
    assert.equal(big.hitIsTheTick, true, 'the New dialog tick is not what is at its own centre at 1280x1000: ' + JSON.stringify(big));
    await viewport(1100, 657);
    const small = await evalIn(TICK_GEOM('Not on the website'));
    assert.ok(small.scrollNeeded < 120,
      `THE NEW EVENT DIALOG'S TICK IS ${small.scrollNeeded}px BELOW THE FOLD at 1100x657 — it has gone back below the optional fields (the original complaint was ~300px): ` + JSON.stringify(small));
  } finally { await cdpSend('Emulation.clearDeviceMetricsOverride', {}); await sleep(500); }
  await evalIn(`(() => { for (const b of [...document.querySelectorAll('button')]) if ((b.textContent||'').trim() === 'Cancel') { b.click(); break; } return 'ok'; })()`);
  await sleep(600);
  assert.deepEqual(errors, [], 'the console threw:\n  ' + errors.join('\n  '));
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
