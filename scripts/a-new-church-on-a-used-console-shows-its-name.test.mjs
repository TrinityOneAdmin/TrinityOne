// A NEW CHURCH MADE ON A CONSOLE THAT WAS USED BEFORE SHOWS ITS OWN NAME — with no reload.
// Run: node --test scripts/a-new-church-on-a-used-console-shows-its-name.test.mjs
//
// Round-2 finding (2026-11-17): "a new church's console shows 'Your Church' / 0 groups until a reload". Plan
// reference/PLAN-reader-version-and-new-church-console-2026-11-18.md (B), audit E11-E13.
//
// THE MECHANISM, MEASURED (Step 0, 2026-11-18, at ab1ec8a5). The console's re-subscribe ticker (app/steward-root.jsx)
// re-opens every stream when a relay enters relays() that the streams were not opened over. It compares against a
// snapshot, `_connSeen`, and since b8aae006 (2026-11-06) that snapshot was taken by the FIRST hook to call
// useStewardConn() — useStewardStewardedChurches, mounted in StewardRoot on the WELCOME screen, before any church
// exists. On a console that has been used on this box before, the welcome screen's relays() already holds the box
// (a cached same-origin proof), so the snapshot is {box}. Then:
//   · Start a new church → the box's /config honestly says it does not host this seconds-old church → boxhosts '0' →
//     relays() = [] (the shipped hosts are black-holed here) → the dashboard's streams open over NOTHING;
//   · the wizard's name step registers the church on the box → boxhosts '1' → relays() = [box] → the ticker is kicked,
//     compares with {box}, sees nothing new, and re-opens nothing.
// Measured readings: at the name step `_connSeen` = [box], relays() = [], boxhosts '0'; on the dashboard relays() =
// [box], boxhosts '1', `_connSeen` still [box]; the Overview read "Your Church" at 5, 15, 30 and 45 s. A cold profile
// (the shape of a-new-church-gets-its-keys-in-its-first-session) shows the name at once: its welcome-screen snapshot
// is empty, so the box's arrival counts as new.
//
// THE OWNER'S SEQUENCE IS THE SETUP (audit E12): church #1 made through the real wizard; Settings → Master key → Hand
// over the church → "Remove this church from this device" → "Remove & reload"; then, on the welcome screen and BEFORE
// Start, the precondition is ASSERTED (the snapshot holds the box, and the box's proof is live) — a row whose
// precondition fails would be a cold profile in disguise.
//
// THE BOX ACCEPTS A SECOND CHURCH (RELAY_OPEN=1, "offer to host other churches"). Without it the box refuses church #2
// at registration ("this relay is already set up for its church") and the new church has no relay at all — a
// different situation that a reload does not cure either; measured, and not the subject here.
//
// Rule 3: everything asserted is page text or engine state, never .jsx source.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.RELAY_OPEN = '1';   // read by the gateway this harness spawns (scripts/relay-network-harness.mjs passes process.env)
const { CHROME, openNewChurch, sleep, typePh, typeInto, PIN } = await import('./new-church-session.mjs');

let s; const R = {};
const norm = (u) => String(u || '').replace(/\/+$/, '').toLowerCase();
const readings = async () => JSON.parse(await s.ev(`(() => { let seen = null; try { seen = _connSeen ? [..._connSeen] : null; } catch (e) { seen = 'unreadable'; }
  const pub = (window.Steward && window.Steward.churchPub) || '';
  let ver = {}; try { ver = JSON.parse(localStorage.getItem('trinityone.relays.verified') || '{}'); } catch (e) {}
  return JSON.stringify({ seen, relays: window.Steward.relayList(), boxhosts: localStorage.getItem('trinityone.steward.boxhosts.' + pub), ver, now: Math.floor(Date.now() / 1000) }); })()`));
async function toDashboard() {
  for (let i = 0; i < 70; i++) {
    if (await s.ev(`[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Settings') && !document.querySelector('[data-stew-modal-panel]') && !/Skip setup|Go to dashboard/.test(document.body.innerText)`)) return;
    await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^(I’ll do this later|Go to dashboard|Skip for now and finish setup)$/.test((x.textContent||'').trim())); if (b) { b.click(); return 1; } return 0; })()`);
    await sleep(1500);
  }
  throw new Error('the dashboard never came: ' + (await s.text()).slice(0, 300));
}
// the wizard's rooms step → "Create 3 & continue", "Add 2 & continue", then past the team and done steps
async function roomsThenDashboard() {
  await s.waitFor(`/Create a few spaces/.test(document.body.innerText)`, 60000, 'the rooms step');
  await s.press(/^Create \d/);
  await s.waitFor(`/Your regular meetings/.test(document.body.innerText)`, 60000, 'the meetings step');
  await s.press(/^Add \d/);   // the meetings are not the subject: if their save stalls, the step's own "Skip for now" escape is used below
  await toDashboard();
}
const nameShownWithin = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await s.ev(`${re}.test(document.body.innerText)`)) return Date.now() - t0; await sleep(300); } return -1; };

before(async () => {
  if (!CHROME) return;
  // ── church #1, cold profile ──
  s = await openNewChurch({ wizard: 'rooms', name: 'usedconsole' });
  await roomsThenDashboard();
  R.coldName = await nameShownWithin('/First Session Church/', 15000);
  // ── Settings → Master key → Hand over the church → Remove this church from this device → Remove & reload ──
  await s.press(/^Settings$/); await sleep(1200);
  for (const lab of ['Master key', 'Hand over the church']) {
    await s.ev(`(() => { const b=[...document.querySelectorAll('button, div')].reverse().find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(lab)}) && (x.textContent||'').length < 90); if (b) { b.click(); return 1; } return 0; })()`);
    await sleep(1200);
  }
  await s.press(/Remove this church from this device/, 'Settings → Hand over the church → Remove this church from this device');
  await s.press(/Remove & reload/);
  await s.waitFor(`[...document.querySelectorAll('button')].some(x => /Start a new church/i.test((x.textContent||'').trim()))`, 90000, 'the welcome screen after the removal');
  await sleep(3000);
  R.pre = await readings();
  R.box = s.relay.wsUrl;
  // ── church #2, same browser ──
  await s.press(/Start a new church/i);
  await s.waitFor(`[...document.querySelectorAll('input')].some(x => (x.placeholder||'').includes('At least 8'))`, 60000, 'the PIN box');
  await s.ev(typePh('At least 8', PIN)); await s.ev(typePh('Type it again', PIN));
  await s.press(/Set PIN/i);
  await s.waitFor(`!!document.querySelector('input[aria-label="Church name"]')`, 90000, 'the wizard name step');
  R.atName = await readings();
  const words = (await s.ev(`window.Steward.exportMnemonic()`)).split(' ');
  await s.ev(typeInto('input[aria-label="Church name"]', 'Second Warm Church'));
  await s.press(/^Continue$/);
  await s.waitFor(`/12 words are your church/.test(document.body.innerText)`, 60000, 'the recovery step');
  await s.ev(`(() => { const i=document.querySelector('input[type=checkbox]'); if(!i.checked) i.click(); return 1; })()`);
  await sleep(500); await s.press(/^Continue$/);
  await s.waitFor(`/Quick check/.test(document.body.innerText)`, 30000, 'the quick check');
  await s.ev(`(() => { const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; const words=${JSON.stringify(words)}; const nums=[...document.body.innerText.matchAll(/WORD #(\\d+)/g)].map(m=>Number(m[1])); const ins=[...document.querySelectorAll('input')].filter(i=>i.type==='text').slice(0,3); ins.forEach((i,k)=>{set.call(i,words[nums[k]-1]); i.dispatchEvent(new Event('input',{bubbles:true}));}); return ins.length; })()`);
  await sleep(500); await s.press(/^Continue$/);
  await roomsThenDashboard();
  R.atDash = await readings();
  R.warmName = await nameShownWithin('/Second Warm Church/', 20000);
  R.after = await readings();
  console.log('READINGS ' + JSON.stringify({ coldName: R.coldName, warmName: R.warmName,
    pre: { seen: R.pre.seen, relays: R.pre.relays }, atName: { seen: R.atName.seen, relays: R.atName.relays, boxhosts: R.atName.boxhosts },
    atDash: { seen: R.atDash.seen, relays: R.atDash.relays, boxhosts: R.atDash.boxhosts }, after: { seen: R.after.seen, relays: R.after.relays } }));
});
after(() => { try { s && s.close(); } catch {} });
const SKIP = !CHROME ? 'no chromium' : false;

test('PRECONDITION (E12): on the welcome screen of the used console, the snapshot holds the box and its proof is live', { skip: SKIP, timeout: 400000 }, () => {
  assert.ok(Array.isArray(R.pre.seen) ? R.pre.seen.some(u => norm(u) === norm(R.box)) : R.pre.seen === null, 'the welcome-screen snapshot neither holds the box nor is untaken: ' + JSON.stringify(R.pre.seen));
  // Before the fix the welcome screen's root hook took the snapshot, so it must hold the box there; after the fix
  // nothing takes it until the first real stream opens (null). Either way the PROOF must be live, or this is a cold
  // profile in disguise.
  const k = Object.keys(R.pre.ver).find(x => norm(R.box).endsWith(norm(x)));
  assert.ok(k, 'the box has no cached proof on the welcome screen: ' + JSON.stringify(Object.keys(R.pre.ver)));
  assert.ok(R.pre.ver[k].until > R.pre.now, 'the box\'s proof has expired');
  assert.ok(R.pre.relays.some(u => norm(u) === norm(R.box)), 'the welcome screen\'s relays() does not hold the box: ' + JSON.stringify(R.pre.relays));
  // and the new church really did open its streams without the box (the state the finding needs)
  assert.deepEqual(JSON.parse(JSON.stringify(R.atName.relays)), [], 'at the name step relays() was not empty, so this run did not reach the finding\'s state');
  assert.equal(R.atName.boxhosts, '0');
});

test('control: church #1 on a cold profile showed its name on the Overview', { skip: SKIP, timeout: 400000 }, () => {
  assert.ok(R.coldName >= 0, 'the cold control did not show its name');
});

test('the second church, made on the used console, shows its own name on the Overview with no reload', { skip: SKIP, timeout: 400000 }, () => {
  assert.ok(R.atDash.relays.some(u => norm(u) === norm(R.box)), 'the box never entered relays() after registration: ' + JSON.stringify(R.atDash));
  assert.ok(R.warmName >= 0, 'THE FINDING: the Overview still read "Your Church" 20 s after the dashboard came — its streams were opened over no relay and never re-opened. Readings: ' + JSON.stringify({ atName: R.atName.seen, atDash: R.atDash.seen, relays: R.atDash.relays }));
});

test('the second church\'s Groups page lists the rooms the wizard made, with no reload', { skip: SKIP, timeout: 400000 }, async () => {
  await s.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Groups$/.test((x.textContent||'').trim())); if (b) { b.click(); return 1; } return 0; })()`);
  await s.waitFor(`/Whole Church/.test(document.body.innerText) && /Prayer/.test(document.body.innerText)`, 15000, 'the Groups page to list Whole Church and Prayer');
});
