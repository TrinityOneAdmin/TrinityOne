// MEASURED IN A BROWSER, AT THE TWO SIZES OF THE PHONE THE OWNER RUNS THE CONSOLE ON.
//   Run: node --test scripts/the-error-banner-clears-a-dialog-on-the-phone.test.mjs
//
// scripts/the-error-banner-does-not-crop-an-open-dialog.test.mjs answers "what did the component decide".
// This answers the only question that actually mattered on 2026-09-17 — "where does the box LAND" — and it
// is a different question, because `position: fixed; bottom: 0` plus `max-height: min(30vh, 84px)` is a
// sentence about pixels that no style object resolves. The banner used to be in flow at the top with an
// opaque background, and at 360x730 that is exactly where a centred dialog's title is.
//
// WHAT IS REAL HERE AND WHAT IS NOT, said plainly so nobody over-reads it:
//   · REAL — the style objects. PublishErrorBanner and SkConfirm are COMPILED out of app/stew-dashboard.jsx
//     with the real esbuild, RENDERED, and the tree they produce is serialised to HTML with those exact
//     styles. `false && ` in front of the new branch changes what this measures (CLAUDE.md rule 3).
//   · REAL — the layout. Chromium, at 360x730 and at 730x328, getBoundingClientRect().
//   · NOT REAL — the surrounding console. There is no header, no tab strip and no relay here; the two boxes
//     are placed in an empty page. That is the point: it isolates the one interaction under test.
//
// 360x730 is the Oppo CPH2477 upright. 730x328 is the same handset in landscape, where the navigation bar
// takes 32px of the 360.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs, so CI without a browser is green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';
import { toHtml, page } from './console-banner-geometry.mjs';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9371;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LONG = 'The key was saved, and “Musicians” is now sealed on 1 of 4 relays. relay.example.org, '
  + 'other.example.net, third.example.com would not take it, so messages that go through them can still be '
  + 'read there. Trying again won’t change that if those relays don’t carry your church — see Settings → Relays.';

// ⚠ THE CONSOLE'S CHROME IS PART OF THE INSTRUMENT, and leaving it out made the first cut of this file
// USELESS — it passed just as happily with the whole fix deleted. In flow the banner sits BELOW the header
// and the tab strip; drop those and it lands at y=0, which is nowhere near a vertically-centred dialog, so
// the defect simply did not occur in the fixture. The 2026-09-15 UI audit measured that block at 309px of a
// 730px screen before that day's compressions and less after, so 230 is a conservative stand-in, and the
// `was` fixture below is the baseline row that proves this number is big enough to reproduce the defect.
const CHROME_H = 230;
function shell(bannerHtml) {
  return '<div style="position:absolute;inset:0;display:flex;flex-direction:column">'
    + '<div style="flex-shrink:0;height:' + CHROME_H + 'px;background:var(--surface);border-bottom:1px solid var(--line)"></div>'
    + bannerHtml
    + '<main style="flex:1;min-height:0;overflow-y:auto"></main>'
    + '</div>';
}

// ⚠ TWO DIALOGS, BECAUSE ONE OF THEM IS THE TALLEST CLASS AND THAT IS WHERE THIS BREAKS.
//
// SkConfirm is `maxHeight: 86vh`. app/stew-finance.jsx's modals are `92vh`, and the first cut of this fix
// claimed "it does not touch a control" on the strength of SkConfirm alone. An audit measured
// FinanceShareStatement instead: at 730x328 the strip ate the bottom 19px of a 44px "Post to members", and
// at 360x730 it clipped 3px off two buttons the commit said it could not reach at all. That dialog is the
// one the banner is raised above modals FOR — it publishes with its modal still open.
//
// `FinanceShareStatement` here is the real component out of app/stew-finance.jsx, given the real shipped
// ledger out of vendor/finance-ledger.js and an empty book.
const LEDGER = new Function(readFileSync(new URL('../vendor/finance-ledger.js', import.meta.url), 'utf8')
  + '\nreturn FinanceLedger;')();

// Render the real components and glue their trees into one page. `modalOpen` is what the real registry
// (app/stew-modal.jsx) answers while a dialog is up; `withDialog` is false, 'confirm' (86vh) or 'tall' (92vh).
function fixture(modalOpen, withDialog = 'confirm') {
  const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  // ⚠ THE ICON IS A REAL BOX HERE, and it has to be. A stub that renders NOTHING gives every icon zero
  // width, and the one box in this file whose size is the thing under test — the dismiss button, which is
  // an icon plus padding — then measures as padding alone. Before this, that button measured 20x20 in the
  // clamped state where a phone actually has 36x36: the instrument was reporting a defect twice as bad as
  // the real one, which is no better than reporting none. `size` is the prop every call site passes.
  const Icon = ({ size }) => ({ type: 'span', props: { style: { display: 'block', width: size || 16, height: size || 16, flexShrink: 0 } }, kids: [] });
  const listeners = {};
  const win = {
    Steward: { actingChurch: '' },
    stewModalOpen: () => modalOpen,
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };
  const b = miniReact();
  const mod = loadScreen('app/stew-dashboard.jsx', ['PublishErrorBanner', 'SkConfirm', 'NameEditModal'], {
    React: b.React, window: win, Icon,
    useStewDialog: () => ({ current: null }), useStewModalOpen: () => {},
    noteRelayRejection: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    console, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, Promise, RegExp,
  });
  let tree = b.draw(mod.PublishErrorBanner, {});
  (listeners['steward-write-blocked'] || []).forEach(fn => fn({ detail: { what: 'group key', message: LONG } }));
  tree = b.draw(mod.PublishErrorBanner, {});
  assert.equal(find(tree, n => n.props && n.props.role === 'alert').length, 1,
    're-anchor: the banner did not render exactly one message');
  // ⚠ A COMPONENT MUST BE DRAWN BY THE miniReact WHOSE `React` COMPILED IT. The console's two dialogs came
  // out of `mod` (built with `b.React`), so they are drawn with `b`; only the finance module below is loaded
  // against `d`. Drawing one instance's component through another's `draw` gives "Cannot read properties of
  // null (reading 'si')" — the hook store is never entered — and it takes the whole file down at once.
  const d = miniReact();
  let dlg = null;
  if (withDialog === 'confirm') {
    dlg = b.draw(mod.SkConfirm, {
      icon: 'lock', title: 'Seal “Musicians”?', confirmLabel: 'Seal it',
      body: 'From now on its messages are encrypted end-to-end — not even the relay can read them. Messages '
        + 'already posted stay as they are.',
      onConfirm() {}, onCancel() {},
    });
  } else if (withDialog === 'spill') {
    // A panel that declares NO overflow of its own — 19 of the console's 35 do not. `max-height` alone
    // neither clips nor scrolls such a panel; its content spills out of the card and the card's border,
    // background and shadow end part-way up its own text. NameEditModal measured 263/236 at 730x328.
    dlg = b.draw(mod.NameEditModal, { open: true, current: 'St Aidan', isNetwork: false, onSave() {}, onClose() {} });
  } else if (withDialog === 'tall') {
    const fin = loadScreen('app/stew-finance.jsx', ['FinanceShareStatement'], {
      React: d.React, window: win, Icon, SkPill: Stub('SkPill'), SkBadge: Stub('SkBadge'),
      Panel: ({ children }) => children, DismissibleNote: ({ children }) => children,
      useStewDialog: () => ({ current: null }), useStewModalOpen: () => {},
      setTimeout: () => 1, clearTimeout: () => {}, console, todayISO: () => '2026-09-17',
      Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, Promise, RegExp,
    });
    dlg = d.draw(fin.FinanceShareStatement, {
      F: LEDGER, book: { journal: [], accounts: [], funds: [], name: 'St Aidan' },
      churchName: 'St Aidan', accent: 'var(--clay)', logo: '', canPost: true,
      onPostToMembers() {}, onClose() {},
    });
  }
  // Modals come FIRST in the console shell, exactly as they do here; what decides the stacking is z-index.
  // The second argument is what the banner's own effect puts on <html>, and the rules it triggers are read
  // out of steward.html rather than retyped — they are the whole of what keeps the strip off the dialog.
  return page((dlg ? toHtml(dlg) : '') + shell(toHtml(tree)), modalOpen && withDialog ? 'clamped' : '');
}

let chr, ws, prof, send, evalIn, frameId;
const HTML = {};
before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'the-error-banner-clears-a-dialog-on-the-phone.test.mjs (Chrome debug port)');
  // ⚠ NOT A FILE, AND NOT BECAUSE A FILE WOULD BE UNTIDY. Chromium here is a SNAP, so it runs with its own
  // private /tmp and cannot see anything this process writes there — a file:// fixture loads as a blank page
  // and every measurement below then says the banner "rendered nothing", which looks exactly like the bug.
  // Page.setDocumentContent hands the markup straight to the frame and needs no filesystem either side.
  HTML.open = fixture(true);                    // a dialog is up, and the banner knows it
  HTML.shut = fixture(false, false);            // no dialog at all — the everyday console
  HTML.was = fixture(false, 'confirm');         // THE BASELINE: a dialog is up and the banner does not know
  HTML.tall = fixture(true, 'tall');            // the 92vh case an audit found this fix breaking
  HTML.spill = fixture(true, 'spill');          // a panel with no overflow of its own, which max-height spills
  prof = join(tmpdir(), 'trin-banner-chr-' + process.pid);
  // NEVER LET A TEST REACH PRODUCTION, and NAME THE HOSTS. The trailing `MAP *` catch-all is what this file
  // has always had and it is kept — this fixture loads no URL at all, so nothing here needs to resolve. What
  // it did NOT have is the production hosts by name, which is what scripts/no-browser-reaches-production.test.mjs
  // requires of every launcher in this directory: a bare wildcard reads as "this one happens not to need the
  // network today", and the next edit that gives it a page to load would drop it without anyone noticing.
  // Round 8 is why the guard exists — a console dialling the canonical relays from a local origin wrote a
  // church's books to the LIVE relay, and the ledger then sat split across two relays showing a balance
  // neither supported. Nothing reached production from this file; the guard caught it first.
  // 127.0.0.1:9 is the discard port: nothing listens, so a connection fails instantly rather than hanging.
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9, MAP * 127.0.0.1:9';
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const t = targets.find(x => x.type === 'page') || targets[0];
  ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  frameId = (await send('Page.getFrameTree')).result.frameTree.frame.id;
  evalIn = async (expr) => {
    const rr = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (rr?.result?.exceptionDetails) throw new Error('in-page: ' + JSON.stringify(rr.result.exceptionDetails).slice(0, 300));
    return rr?.result?.result?.value;
  };
});
after(async () => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { prof && rmSync(prof, { recursive: true, force: true }); } catch {}
});

const MEASURE = `(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
  const dialog = document.querySelector('[role="dialog"]');
  const alert = document.querySelector('[role="alert"]');
  const title = dialog && dialog.querySelector('div > div:last-child');
  const buttons = dialog ? [...dialog.querySelectorAll('button')] : [];
  // What is actually painted at the dialog's title, and at its buttons? elementFromPoint answers the
  // question the rectangles only imply.
  const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.closest('[role="alert"]') ? 'banner' : (e.closest('[role="dialog"]') ? 'dialog' : 'other')) : 'none'; };
  const t = box(title), a = box(alert);
  // EVERY CONTROL IN THE DIALOG, AT THREE POINTS. The centre alone is not enough: the strip sits at the foot,
  // so what it takes first is the BOTTOM EDGE of the lowest row of buttons.
  const intercepted = buttons.map(b => {
    const r = box(b);
    const pts = [r.top + 3, (r.top + r.bottom) / 2, r.bottom - 3].map(y => at((r.left + r.right) / 2, y));
    return pts.includes('banner') ? { text: (b.textContent || '').trim().slice(0, 32), box: r, pts } : null;
  }).filter(Boolean);
  return JSON.stringify({
    vw: innerWidth, vh: innerHeight,
    dialog: box(dialog), title: t, alert: a, main: box(document.querySelector('main')),
    buttons: buttons.map(b => box(b)), intercepted,
    // The banner's OWN dismiss control. While the strip is clamped the card lets taps through, so the card's
    // middle no longer answers "is the banner on top" — its control does, and it answers both halves at once:
    // painted above the overlay, and reachable.
    // ⚠ AND THE OTHER DIRECTION, which is the one that nearly shipped. A pointer-transparent card is opaque
    // to the eye and invisible to the finger: every point down the middle of the banner's own rectangle must
    // belong to the BANNER, never to a control behind it.
    insideBanner: (() => {
      if (!a) return [];
      const bad = [];
      for (let y = a.top + 1; y < a.bottom; y += 2) {
        const e = document.elementFromPoint((a.left + a.right) / 2, y);
        if (!e || e.closest('[role="alert"]')) continue;
        const btn = e.closest('button');
        bad.push({ y, what: btn ? ('BUTTON:' + (btn.textContent || '').trim().slice(0, 28)) : (e.closest('[role="dialog"]') ? 'dialog' : 'other') });
      }
      return bad.filter(x => /^BUTTON/.test(x.what));
    })(),
    // Does the panel CONTAIN its own content, or has a max-height pushed it out through the card's edge?
    panel: dialog ? { overflowY: getComputedStyle(dialog).overflowY,
                      scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight } : null,
    atDismiss: (() => {
      const d2 = document.querySelector('[role="alert"] button[aria-label^="Dismiss"]');
      if (!d2) return 'none';
      const r = box(d2);
      return at((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    })(),
    // THE SIZE OF THE THING A FINGER HAS TO LAND ON, and separately the room it costs the bar. They are not
    // the same number and they are not meant to be: a negative margin lets the target be bigger than its
    // footprint. w/h are the border box, which is what the browser hit-tests; footW/footH are the margin
    // box, which is what the flex line actually reserves.
    dismiss: (() => {
      const d2 = document.querySelector('[role="alert"] button[aria-label^="Dismiss"]');
      if (!d2) return null;
      const r = d2.getBoundingClientRect(), cs = getComputedStyle(d2);
      const mx = parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
      const my = parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      return { w: Math.round(r.width), h: Math.round(r.height),
               footW: Math.round(r.width + mx), footH: Math.round(r.height + my) };
    })(),
    atTitle: t ? at((t.left + t.right) / 2, t.top + 4) : null,
    atLastButton: buttons.length ? (() => { const r = box(buttons[buttons.length - 1]); return at((r.left + r.right) / 2, (r.top + r.bottom) / 2); })() : null,
  });
})()`;

async function measure(which, w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send('Page.setDocumentContent', { frameId, html: HTML[which] });
  await sleep(350);
  return JSON.parse(await evalIn(MEASURE));
}
const overlap = (a, b) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

for (const [label, W, H] of [['360x730 upright', 360, 730], ['730x328 landscape', 730, 328]]) {
  test(`${label}: with a dialog open, nothing of the banner is over its title`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    const m = await measure('open', W, H);
    assert.deepEqual({ vw: m.vw, vh: m.vh }, { vw: W, vh: H }, 'the viewport is not the size this test claims to measure');
    assert.ok(m.dialog && m.alert, 're-anchor: the fixture did not render both boxes');
    assert.equal(overlap(m.alert, m.title), 0,
      `THE BANNER IS BACK OVER THE DIALOG'S TITLE at ${label}. banner ${JSON.stringify(m.alert)} title ` +
      `${JSON.stringify(m.title)} — this is the owner's "oddly cropped", measured.`);
    assert.equal(m.atTitle, 'dialog',
      `the pixel at the top of the dialog's title belongs to the ${m.atTitle}, not the dialog`);
  });

  test(`${label}: …and the dialog's buttons are still reachable`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    // The mirror risk of moving the banner to the foot: at the bottom it could cover Cancel and Seal it,
    // which is worse than covering a title. This is the row that would catch it.
    const m = await measure('open', W, H);
    assert.ok(m.buttons.length >= 2, 're-anchor: the confirm dialog no longer has its two buttons');
    assert.equal(m.atLastButton, 'dialog',
      `THE BANNER COVERS THE DIALOG'S CONFIRM BUTTON at ${label}. banner ${JSON.stringify(m.alert)} ` +
      `buttons ${JSON.stringify(m.buttons)}.`);
    assert.deepEqual(m.insideBanner, [],
      `A TAP ON THE BANNER PRESSES A BUTTON BEHIND IT at ${label}: ` + JSON.stringify(m.insideBanner));
  });

  test(`${label}: …and the banner is still ON TOP, not behind the overlay`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    // AUDIT-9's defect, which must not come back: painted under the modal it is greyed and untappable.
    const m = await measure('open', W, H);
    assert.equal(m.atDismiss, 'banner',
      `the banner's own dismiss control is painted by something else at ${label} — the banner is behind the ` +
      `overlay again (AUDIT-9), where it is greyed and cannot be tapped. banner ${JSON.stringify(m.alert)}`);
  });
}

for (const [label, W, H] of [['360x730 upright', 360, 730], ['730x328 landscape', 730, 328]]) {
  test(`${label}: a 92vh dialog keeps every one of its controls operable`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    // THE ROW AN AUDIT HAD TO ADD. At 328px of height there is no strip short enough to clear a 92vh dialog,
    // so the strip stops INTERCEPTING instead: pointer-transparent except its own two controls. This asserts
    // the consequence rather than the mechanism — no control of the dialog is painted by the banner at its
    // top edge, its middle, or its bottom edge.
    const m = await measure('tall', W, H);
    assert.ok(m.dialog && m.alert, 're-anchor: the tall fixture did not render both boxes');
    assert.ok(m.buttons.length >= 4, `re-anchor: FinanceShareStatement rendered ${m.buttons.length} buttons`);
    assert.deepEqual(m.intercepted, [],
      `THE BANNER INTERCEPTS A CONTROL OF A 92vh DIALOG at ${label} — and that dialog is the one this banner ` +
      `is raised above modals for, because it publishes with its modal still open. ` +
      JSON.stringify(m.intercepted) + ' banner ' + JSON.stringify(m.alert));
    // …AND NOT BY BEING SEE-THROUGH. That was tried for one commit and was the worst state this branch
    // reached: an opaque 11px band that painted as the error banner and actuated "Post to members".
    assert.deepEqual(m.insideBanner, [],
      `A TAP ON THE BANNER PRESSES A BUTTON BEHIND IT at ${label}. The card is opaque, so what the steward ` +
      `sees is a banner and what they press is the dialog's primary action: ` + JSON.stringify(m.insideBanner));
  });
}

for (const [label, W, H] of [['360x730 upright', 360, 730], ['730x328 landscape', 730, 328]]) {
  test(`${label}: shortening a dialog does not push its content out through the card`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    // Audit of 4a6dd5a. `max-height: … !important` on a panel whose own overflow is `visible` neither clips
    // nor scrolls: the content spills out and the card's border, background and shadow end part-way up its
    // own text — the "oddly cropped" complaint that started this branch, arriving from the other side.
    // 19 of the console's 35 panels declare no overflow of their own, so this is a class and not a case.
    for (const which of ['spill', 'tall']) {
      const m = await measure(which, W, H);
      assert.ok(m.panel, `re-anchor: the ${which} fixture rendered no panel`);
      // THE INVARIANT IS "CONTAINED OR SCROLLABLE", never "short". A capped panel whose content is taller
      // than its box is perfectly fine WHEN IT SCROLLS — that is the whole point of the cap. What is not
      // fine is `overflow-y: visible` with a cap, where the content is painted outside the card entirely.
      const contained = m.panel.scrollHeight <= m.panel.clientHeight + 1;
      assert.ok(contained || m.panel.overflowY === 'auto' || m.panel.overflowY === 'scroll',
        `the ${which} panel is capped, its content is ${m.panel.scrollHeight - m.panel.clientHeight}px ` +
        `taller than the box that paints it, and it does not scroll — so that content is OUTSIDE the card, ` +
        `over the dim, with the card's border and shadow ending part-way up its own text. ` +
        `At ${label}: ${JSON.stringify(m.panel)}`);
    }
  });
}

test('BASELINE 360x730: the shape this replaces really does cover the dialog’s title', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  // ⚠ WITHOUT THIS ROW THE THREE ABOVE PROVE NOTHING. The first cut of this file had no console chrome in
  // its fixture, so the in-flow banner landed at y=0 — nowhere near a centred dialog — and the whole file
  // stayed green with the fix deleted. This is the same banner, told there is no dialog open, which is
  // exactly what it believed before 2026-09-17: in flow, below the chrome, opaque, at z-index 240.
  const m = await measure('was', 360, 730);
  assert.ok(m.dialog && m.alert && m.title, 're-anchor: the baseline fixture did not render both boxes');
  assert.ok(overlap(m.alert, m.title) > 0,
    'the baseline does NOT reproduce the defect, so this file cannot see it either. banner ' +
    JSON.stringify(m.alert) + ' title ' + JSON.stringify(m.title) + ' — is CHROME_H still realistic?');
  assert.equal(m.atTitle, 'banner',
    'the baseline’s title is not actually painted over by the banner, so the rows above are vacuous');
});

test('360x730: with NO dialog open the banner is back in flow, under the chrome, pushing the page down', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  // The control, and the other half of AUDIT-8/AUDIT-9. Without it a banner that had simply stopped
  // rendering, or one left pinned to the viewport for ever, would pass every row above.
  const m = await measure('shut', 360, 730);
  assert.ok(m.alert, 'the banner rendered nothing at all');
  assert.ok(m.alert.top >= CHROME_H && m.alert.top < CHROME_H + 40,
    `the in-flow banner is not immediately under the header and tab strip (chrome ends at ${CHROME_H}, ` +
    `banner top ${m.alert.top}) — it is meant to push the content down, not float somewhere`);
  assert.ok(m.main && m.main.top >= m.alert.bottom,
    `THE BANNER IS PAINTED OVER THE CONTENT instead of pushing it down: banner ${JSON.stringify(m.alert)} ` +
    `main ${JSON.stringify(m.main)}. AUDIT-8.`);
  // AUDIT-9's cap, measured rather than read off the style: a long message must never cost more than
  // min(40vh, 220px). At 730 tall that is the 220 literal. Uncapped, the message in this fixture is four
  // lines; the real one that produced the finding left the content region 38px tall and below the fold.
  assert.ok(m.alert.bottom - m.alert.top <= 221,
    `the banner is ${m.alert.bottom - m.alert.top}px tall, past its min(40vh, 220px) cap — uncapped it eats ` +
    'the fold, which is AUDIT-9');
  assert.ok(m.main.bottom - m.main.top >= 730 - CHROME_H - 221,
    `the scrolling content region is down to ${m.main.bottom - m.main.top}px: the banner is taking more ` +
    'than its cap, so a volunteer sees the header, the tabs and a wall of pink text and no church content');
});

// ── THE DISMISS CONTROL IS A REAL TARGET, IN BOTH STATES ───────────────────────────────────────────────────
//
// The clamping added on 2026-09-17 shrank this button's padding from 14 to 10 while it was docked, which took
// the target from 44x44 to 36x36 — measured here, in Chromium, at both sizes of the owner's handset. 36 is
// over WCAG 2.5.8's 24 and under the 44 this codebase has held itself to since audit #27, on the one control
// a steward presses to clear an error they have just been told about.
//
// ⚠ AND THE OBVIOUS FIX IS THE WRONG ONE, which is why the second row exists. Simply restoring `padding: 14`
// without the matching negative margin would put a 44px box inside a bar that is meant to be one line, and
// the strip that has to clear a 92vh dialog at 328px of screen height would grow by 8px. The target and the
// footprint are separated by the negative margin instead: the button hit-tests at 44x44 and reserves 16x16,
// exactly as it already did with no dialog open.
for (const [label, W, H] of [['360x730 upright', 360, 730], ['730x328 landscape', 730, 328]]) {
  test(`${label}: the banner's dismiss button is at least 44x44 with a dialog open`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    const m = await measure('open', W, H);
    assert.ok(m.dismiss, 're-anchor: the docked banner rendered no dismiss button');
    assert.ok(m.dismiss.w >= 44 && m.dismiss.h >= 44,
      `THE DISMISS BUTTON IS ${m.dismiss.w}x${m.dismiss.h} WHILE THE BANNER IS DOCKED at ${label}, under the ` +
      '44x44 a cheap Android phone needs — and this is the control that clears an error message, so a miss ' +
      'either does nothing or presses whatever the dialog has behind it.');
  });

  test(`${label}: …and the target costs the docked strip no height`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    // The whole point of the shape: hit area 44, footprint 16, bar unchanged at one line. If a future edit
    // grows the target by growing the box, this is the row that says so.
    const m = await measure('open', W, H);
    assert.ok(m.dismiss.footH <= 16,
      `the dismiss button reserves ${m.dismiss.footH}px of the docked strip's height (it may reserve 16): ` +
      'the bar is no longer one line, and it is the bar that has to clear a 92vh dialog at 328px of screen.');
    const barH = m.alert.bottom - m.alert.top;
    assert.ok(barH <= 40,
      `THE DOCKED BANNER IS ${barH}px TALL at ${label}. It was measured at 37 on the Oppo on 2026-09-17 and ` +
      'is meant to be one line — every pixel here comes off a dialog that is already 92vh.');
  });
}

test('360x730: the dismiss button is at least 44x44 with NO dialog open too', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  // The control. This state was never broken — asserting it keeps a "fix" that trades one state for the
  // other from reading as a pass.
  const m = await measure('shut', 360, 730);
  assert.ok(m.dismiss, 're-anchor: the in-flow banner rendered no dismiss button');
  assert.ok(m.dismiss.w >= 44 && m.dismiss.h >= 44,
    `the in-flow banner's dismiss button is ${m.dismiss.w}x${m.dismiss.h}, under 44x44`);
  assert.ok(m.dismiss.footW <= 16 && m.dismiss.footH <= 16,
    `the in-flow dismiss button reserves ${m.dismiss.footW}x${m.dismiss.footH}, not the 16x16 it has always ` +
    'reserved — the card is now a different size than it was before this button was touched');
});
