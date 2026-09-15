// THE STEWARD CONSOLE, MEASURED AT THE SIZE OF THE PHONE IT IS RUN ON.
//   Run: node --test scripts/the-console-fits-a-360px-phone.test.mjs
//
// The owner, on the built steward APK, 2026-09-15: *"a UI focused audit… as much of this could be compressed
// and laid out better, so as to fit without awkward scrolling"*. A screenshot audit of versionCode 214 on the
// Oppo CPH2477 (360 x 730 CSS px, dpr 2) is written up in TrinityOne-internal/UI-AUDIT-console-2026-09-15.md.
//
// ── WHY THIS BOOTS A BROWSER RATHER THAN RENDERING A COMPONENT ───────────────────────────────────────────
// Every other layout test in this repo asserts on the STYLE OBJECT a component evaluated. That is the right
// instrument for "is this backdrop `fixed`" and the wrong one for every question here, because none of these
// defects is visible in a style object:
//
//   · the Overview cards were cut off by GRID TRACK SIZING — `1fr` is `minmax(auto, 1fr)`, and CSS resolved
//     the two tracks to 205.09px and 146.64px inside a 336px box. Nothing in the JSX says 205.
//   · how much of the screen the chrome eats is the SUM of four laid-out blocks, one of which wraps onto a
//     number of rows that depends on how many nav pills a church's modules produce.
//
// So this loads the real steward.html off the real gateway in Chromium at exactly 360x730, walks the real
// "Start a new church" path to a real dashboard, and reads getBoundingClientRect(). CLAUDE.md rule 3 is
// satisfied the strongest way available: nothing here matches text in app/*.jsx, and `false && ` in front of
// any of these fixes changes what the browser measures.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs, so CI without a browser is green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8862, CDP = 9362;
const ROOT = new URL('..', import.meta.url).pathname;
const VW = 360, VH = 730;   // the Oppo CPH2477's viewport, the phone the owner runs the console on
const sleep = ms => new Promise(r => setTimeout(r, ms));

let relay, chr, ws, dataDir, prof, evalIn, booted = '';
const errors = [];

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(200); }
  throw new Error('relay not ready');
}

before(async () => {
  if (!CHROME) return;
  await requireFreePort(PORT, 'the-console-fits-a-360px-phone.test.mjs');
  await requireFreePort(CDP, 'the-console-fits-a-360px-phone.test.mjs (Chrome debug port)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-fits-'));
  // a THROWAWAY church, never a real npub, and chromium is pointed at a black hole for the production hosts:
  // the console dials CANONICAL_RELAYS regardless of who served the page (see app-boots.test.mjs).
  const cp = getPublicKey(generateSecretKey());
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
  });
  await waitReady();

  prof = join(tmpdir(), 'trin-fits-chr-' + process.pid);
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, `--window-size=${VW},${VH}`,
    `http://127.0.0.1:${PORT}/steward.html`], { stdio: 'ignore' });

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
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  // --window-size gets the OUTER window; this pins the layout viewport to the handset's exact CSS pixels.
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
  evalIn = async (expression) => {
    const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails.exception || rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };

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

  // ⚠ THE FIRST-RUN WIZARD IS STILL ON SCREEN AT THIS POINT, DELIBERATELY, AND THAT IS A TRAP TO KNOW ABOUT.
  // It is a full-screen flow with a blurred backdrop of its own, rendered AFTER every header modal in the
  // console shell, so it is the LAST blurred overlay in the DOM. A probe that grabs "the topmost blurred
  // overlay" therefore measures the WIZARD: while this file was being written, one did exactly that and
  // reported three different modals as identically sized (177..553, one "Continue" button — the wizard's).
  //
  // It cannot cheaply be got rid of, and each way fails differently:
  //   · setting trinityone.steward.wizard.done BEFORE creating the church does nothing — the create path
  //     deletes it (app/steward-root.jsx), deliberately, so a second church on one device still gets setup;
  //   · setting it 1.2s after the PIN loses a race against the dashboard, which reads the flag once in an
  //     effect at mount — measured here: flag set, wizard up anyway;
  //   · Escape does not close it. Step 0 has NO EXIT on purpose ("NO EXIT BEFORE THE TWELVE WORDS"), because
  //     one tap there used to leave a steward holding a church and no written-down key.
  //
  // So this file does not fight it. It measures the overlay that CONTAINS a role=dialog panel — the wizard's
  // does not have one — and every modal test below asserts WHICH dialog it just measured by name. Proving the
  // identity of what was measured is strictly stronger than proving the absence of one thing that could have
  // been measured instead.
  await sleep(1500);
});

after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
  try { dataDir && rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// Open one of the console's sections by pressing its real nav pill, and prove we got there.
async function openTab(label) {
  const r = await evalIn(`(() => { const b=[...document.querySelectorAll('nav[aria-label="Console sections"] button')].find(x=>(x.textContent||'').trim().startsWith(${JSON.stringify(label)})); if(!b) return 'miss'; b.click(); return 'ok'; })()`);
  assert.equal(r, 'ok', `no "${label}" pill in the console's nav — re-anchor this test`);
  await sleep(2600);
}

// Everything laid out inside <main> whose right edge is past the right edge of the phone. <main> scrolls
// vertically and NOT horizontally, so anything in this list is content a steward simply cannot see.
const OFF_SCREEN_RIGHT = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > innerWidth + 0.5) {
      out.push({ right: Math.round(r.right), w: Math.round(r.width), text: (el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,48) });
    }
  }
  return JSON.stringify(out.slice(0, 12));
})()`;

test('the console reached its dashboard at 360x730 — without which nothing below proves anything',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    assert.equal(booted, 'ok', 'the "Start a new church" button was never found');
    const v = JSON.parse(await evalIn('JSON.stringify({ w: innerWidth, h: innerHeight })'));
    assert.deepEqual(v, { w: VW, h: VH }, 'the viewport is not the phone we claim to be measuring');
    const nav = await evalIn(`(() => { const n = document.querySelector('nav[aria-label="Console sections"]'); return n ? n.querySelectorAll('button').length : 0; })()`);
    assert.ok(nav >= 6, `the console's nav has ${nav} sections — it did not reach the dashboard, so every measurement below is of the wrong screen`);
    assert.deepEqual(errors, [], 'the console threw while reaching its dashboard:\n  ' + errors.join('\n  '));
  });

test('nothing on Overview is cut off by the right edge of the phone',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    // Measured before the fix, on this exact screen: the stat grid's tracks resolved to 205.09px + 146.64px
    // inside a 336px box, so the Groups card and the Your relay card both ended at x=374 — 14px off a 360px
    // screen, with no sideways scroll to reach them. Their text wrapped to "chat rooms ·/signed" and
    // "Your/relay" in the owner's screenshot for the same reason.
    await openTab('Overview');
    const off = JSON.parse(await evalIn(OFF_SCREEN_RIGHT));
    assert.deepEqual(off, [],
      'these are laid out past the right edge of a ' + VW + 'px screen, and <main> does not scroll sideways, ' +
      'so a steward cannot see them: ' + JSON.stringify(off));

    // …and the cards must not have bought that by hiding their own labels. An ellipsised label passes the
    // assertion above while still failing the steward.
    const cut = JSON.parse(await evalIn(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('main span')) {
        const t = (el.textContent || '').trim();
        if (!/^(Members|Groups|Announcements|Your relay)$/.test(t)) continue;
        if (el.scrollWidth > el.clientWidth + 1) out.push({ label: t, needs: el.scrollWidth, has: el.clientWidth });
      }
      return JSON.stringify(out);
    })()`));
    assert.deepEqual(cut, [], 'an Overview card label is truncated rather than laid out: ' + JSON.stringify(cut));
  });

// ── FINDING 4: THE 24 POP-UPS THAT WERE CHANGED BUT NEVER LOOKED AT ──────────────────────────────────────
// 32d101d changed 30 modal backdrops after measuring exactly TWO of them on the phone (New group, New event)
// and PREDICTED the other 24 would behave the same. A prediction is not a measurement. This opens four of
// those 24 in the real console at 360x730 and reads their boxes, with New group as the control — the one
// figure that exists from the handset, 83..647, which this harness must reproduce if its numbers are to mean
// anything about a phone.
//
// It asserts the three things that were WRONG before 32d101d, each of which was visible to the owner:
//   1. the backdrop covers the SCREEN (it covered only the content pane, so the nav stayed bright above it
//      and the blur ended in a hard grey edge down each side);
//   2. the dialog's top is not clipped (a flex container centring a child taller than itself puts the top at
//      a negative offset that cannot be scrolled to, because the scroll origin is already past it);
//   3. the dialog's bottom is REACHABLE — either on screen, or brought there by scrolling the backdrop. The
//      clipped part held Cancel and the save button, so on a phone the steward could not finish the job.
const OPEN = {
  'Invite code': `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('title')||'').startsWith('Show your church’s joining code')); if(!b) return 'miss'; b.click(); return 'ok'; })()`,
  'New post': `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('title')||'')==='Write a new post for your church'); if(!b) return 'miss'; b.click(); return 'ok'; })()`,
  'New team': `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('title')||'')==='Create a new serving team'); if(!b) return 'miss'; b.click(); return 'ok'; })()`,
  'Group categories': `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Categories'); if(!b) return 'miss'; b.click(); return 'ok'; })()`,
  'New group': `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='New group'); if(!b) return 'miss'; b.click(); return 'ok'; })()`,
};
const TAB_FOR = { 'New team': 'Rota', 'Group categories': 'Groups', 'New group': 'Groups' };
// What the dialog must say it is. This is the guard against measuring the wrong overlay — see the note in
// before() about the first-run wizard, which sits on top of all of these and is not one of them.
const TITLE_OF = { 'Invite code': 'Invite your church', 'New post': 'New post', 'New team': 'New team',
                   'Group categories': 'Group categories', 'New group': 'New group' };

// Measure the overlay that HOLDS A DIALOG — never simply the topmost one. See the wizard note above.
const MEASURE_DIALOG = `(() => {
  const ovs = [...document.querySelectorAll('div')].filter(el => {
    const cs = getComputedStyle(el);
    return /blur\\(/.test(cs.backdropFilter || cs.webkitBackdropFilter || '');
  });
  const withDlg = ovs.filter(o => o.querySelector('[role="dialog"]'));
  if (!withDlg.length) return JSON.stringify({ found: false, overlays: ovs.length });
  const ov = withDlg[withDlg.length - 1];
  const dlg = ov.querySelector('[role="dialog"]');
  const r = ov.getBoundingClientRect(), dr = dlg.getBoundingClientRect(), cs = getComputedStyle(ov);
  const maxScroll = ov.scrollHeight - ov.clientHeight;
  return JSON.stringify({
    found: true,
    title: (dlg.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
    coversViewport: r.left <= 0.5 && r.top <= 0.5 && r.width >= innerWidth - 0.5 && r.height >= innerHeight - 0.5,
    overlay: { position: cs.position, w: Math.round(r.width), h: Math.round(r.height) },
    dialog: { top: Math.round(dr.top), bottom: Math.round(dr.bottom) },
    topClipped: dr.top < -0.5,
    bottomUnreachable: dr.bottom > innerHeight + 0.5 && maxScroll < dr.bottom - innerHeight - 0.5,
  });
})()`;

const CLOSE_TOP = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const b = [...document.querySelectorAll('button')].find(x => /^(Cancel|Close|Done)$/i.test((x.textContent||'').trim()));
  if (b) b.click(); return 'ok'; })()`;

test('the pop-ups 32d101d changed without photographing them do fit the phone',
  { skip: !CHROME ? 'no chromium' : false, timeout: 240000 }, async () => {
    const seen = {};
    for (const [name, opener] of Object.entries(OPEN)) {
      if (TAB_FOR[name]) await openTab(TAB_FOR[name]);
      const opened = await evalIn(opener);
      assert.equal(opened, 'ok', `could not find the control that opens "${name}" — re-anchor this test`);
      await sleep(1600);
      const m = JSON.parse(await evalIn(MEASURE_DIALOG));
      assert.ok(m.found, `"${name}" opened no blurred backdrop holding a role=dialog (${m.overlays} backdrops on screen)`);
      assert.ok(m.title.startsWith(TITLE_OF[name]),
        `opening "${name}" was measured as a dialog reading ${JSON.stringify(m.title)} — that is not the ` +
        'dialog under test, so this measurement is of the wrong box. (The first-run wizard sits on top of ' +
        'every one of these; see the note in before().)');
      seen[name] = m;
      await evalIn(CLOSE_TOP);
      await sleep(900);
    }

    for (const [name, m] of Object.entries(seen)) {
      assert.equal(m.overlay.position, 'fixed',
        `${name}'s backdrop is position:${m.overlay.position}, so it is sized to the content pane and the ` +
        'page above it is never dimmed. Measured: ' + JSON.stringify(m));
      assert.equal(m.coversViewport, true,
        `${name}'s backdrop does not cover the ${VW}x${VH} screen — it measured ${m.overlay.w}x${m.overlay.h}. ` +
        'That is the grey band down each side the owner photographed.');
      assert.equal(m.topClipped, false,
        `${name}'s dialog starts at y=${m.dialog.top}, above the top of the screen, and a centred flex child ` +
        'cannot be scrolled back to — the scroll origin is already past it.');
      assert.equal(m.bottomUnreachable, false,
        `${name}'s dialog ends at y=${m.dialog.bottom} on a ${VH}px screen and the backdrop cannot scroll far ` +
        'enough to reach it. That is where Cancel and the save button live.');
    }

    // THE CONTROL, and the reason any of these numbers may be believed about a phone. New group was measured
    // on the Oppo after 32d101d and recorded there as 83..647. If this harness cannot reproduce that, its
    // agreement with the other four proves only that it agrees with itself.
    const ng = seen['New group'];
    assert.ok(Math.abs(ng.dialog.top - 83) <= 12 && Math.abs(ng.dialog.bottom - 647) <= 12,
      'New group measured ' + ng.dialog.top + '..' + ng.dialog.bottom + ' here, against 83..647 recorded on ' +
      'the Oppo in 32d101d. The harness and the handset no longer agree, so treat every figure in this file ' +
      'as unverified until someone re-measures on a device.');
  });
