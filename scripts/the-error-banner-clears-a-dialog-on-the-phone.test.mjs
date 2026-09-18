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
// `expand` presses the banner's own "Show the whole message" pill before serialising, which is the ONLY way
// to reach the expanded state — `openWide` is component state with no prop and no global behind it. The tree
// is re-drawn afterwards because miniReact keeps hook state per instance across draws, exactly as React does.
function fixture(modalOpen, withDialog = 'confirm', expand = false) {
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
  if (expand) {
    const show = find(tree, n => n.props && n.props['aria-label'] === 'Show the whole message');
    assert.equal(show.length, 1, 're-anchor: the docked banner has no Show control to press, so this fixture cannot reach the expanded state');
    show[0].props.onClick();
    tree = b.draw(mod.PublishErrorBanner, {});
    assert.equal(find(tree, n => n.props && n.props['aria-label'] === 'Show the whole message').length, 0,
      're-anchor: pressing Show did not expand the banner — the fixture is still measuring the DOCKED state ' +
      'under the expanded state\'s name, which is worse than not measuring it');
  }
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
  return page((dlg ? toHtml(dlg) : '') + shell(toHtml(tree)), modalOpen && withDialog ? (expand ? 'open' : 'clamped') : '');
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
  // ⚠ THE FIFTH STATE, AND THE ONE THAT WAS MISSING. `open` above is the banner DOCKED to one line; press its
  // Show pill and the same banner becomes `data-stew-banner="open"` — a taller card, still fixed to the foot,
  // still over the dialog. None of the four fixtures above is that state, which is why 20/20 said nothing
  // about it while the audit of 2026-09-18 measured 44 px2 of the dismiss button landing on the dialog's
  // SCRIM there. It is PRE-EXISTING, not a regression — see the note above the rows at the foot of this file.
  HTML.expanded = fixture(true, 'confirm', true);
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
    // ⚠ THE WHOLE RECT, ON A 1px GRID, WITH elementFromPoint — because getBoundingClientRect CANNOT SEE A
    // CLIP. dismiss above reported a 44x44 button and was right about the box and wrong about the target:
    // the wrapper is overflowY: 'auto' with the card flush against its top, so 3 rows of that box lived
    // OUTSIDE the scroll container and were clipped away, and what answered there was the dialog's SCRIM —
    // whose onClick is onCancel. A centre-point check is exactly what let that through, twice: once here and
    // once on the sibling control, where the same negative margin reached 4px across Show's right edge and
    // won the hit test because it paints later.
    //
    // For each of the banner's two controls: how many of its own pixels actually reach it, how many distinct
    // rows and columns of it are live, how many live pixels fall OUTSIDE the painted card (a steward pressing
    // visibly-dim pixels), and — for every pixel that is NOT its own — what is there instead.
    grid: (() => {
      const alertEl = document.querySelector('[role="alert"]');
      if (!alertEl) return null;
      const cardR = alertEl.getBoundingClientRect();
      const name = (el) => el ? (el.getAttribute('aria-label') || (el.textContent || '').trim()).slice(0, 30) : null;
      const owner = (x, y) => {
        const e = document.elementFromPoint(x, y);
        if (!e) return 'none';
        const b2 = e.closest('button');
        if (b2) return 'BUTTON:' + name(b2);
        if (e.closest('[role="alert"]')) return 'banner';
        if (e.closest('[role="dialog"]')) return 'dialog';
        // A full-viewport overlay that is NOT the panel is the scrim, and every one of them carries
        // onClick={onCancel} / onClick={onClose}. Naming it is the difference between "a few pixels miss"
        // and "a few pixels throw away the dialog the steward was working in".
        const cs2 = getComputedStyle(e);
        if (cs2.position === 'fixed' && e.getBoundingClientRect().width >= innerWidth - 1) return 'SCRIM';
        return 'other';
      };
      const scan = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const x0 = Math.ceil(r.left), x1 = Math.floor(r.right) - 1;
        const y0 = Math.ceil(r.top), y1 = Math.floor(r.bottom) - 1;
        const rows = new Set(), cols = new Set(), notMine = {};
        let hit = 0, total = 0, outsideCard = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          total++;
          const e = document.elementFromPoint(x, y);
          if (e && e.closest('button') === el) {
            hit++; rows.add(y); cols.add(x);
            if (x < cardR.left || x >= cardR.right || y < cardR.top || y >= cardR.bottom) outsideCard++;
          } else {
            const w2 = owner(x, y);
            notMine[w2] = (notMine[w2] || 0) + 1;
          }
        }
        return { w: Math.round(r.width), h: Math.round(r.height),
                 left: Math.round(r.left), right: Math.round(r.right),
                 top: Math.round(r.top), bottom: Math.round(r.bottom),
                 total, hit, rows: rows.size, cols: cols.size, outsideCard, notMine };
      };
      const dEl = document.querySelector('[role="alert"] button[aria-label^="Dismiss"]');
      const sEl = document.querySelector('[role="alert"] button[aria-label^="Show"]');
      // And the other direction over the NEIGHBOUR: of Show's own pixels, how many does Dismiss own? Pressing
      // one of those does not miss — it throws the message away, and dismissing is the only route by which
      // the full text becomes unreachable.
      let showStolen = null;
      if (sEl) {
        const r = sEl.getBoundingClientRect();
        let stolen = 0;
        for (let y = Math.ceil(r.top); y <= Math.floor(r.bottom) - 1; y++)
          for (let x = Math.ceil(r.left); x <= Math.floor(r.right) - 1; x++) {
            const e = document.elementFromPoint(x, y);
            if (e && e.closest('button') === dEl) stolen++;
          }
        showStolen = stolen;
      }
      // THE INSTRUMENT'S OWN GUARD. The dismiss button is an icon plus padding; a stub that renders nothing
      // gives it a zero-width child and every number above is then about a box this component never draws.
      const ic = dEl ? dEl.firstElementChild : null;
      const icr = ic ? ic.getBoundingClientRect() : null;
      return {
        card: { w: Math.round(cardR.width), h: Math.round(cardR.height),
                left: Math.round(cardR.left), right: Math.round(cardR.right),
                top: Math.round(cardR.top), bottom: Math.round(cardR.bottom) },
        dismiss: scan(dEl), show: scan(sEl), showStolenByDismiss: showStolen,
        icon: icr ? { w: Math.round(icr.width), h: Math.round(icr.height) } : null,
      };
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

// ── THE DISMISS CONTROL IS A REAL TARGET, IN BOTH STATES — MEASURED PIXEL BY PIXEL ─────────────────────────
//
// THE RECTANGLE IS NOT THE TARGET. The rows here used to ask `getBoundingClientRect()` for a width and a
// height and call that the hit area, and it passed a 44x44 box of which:
//   · 3 rows were CLIPPED AWAY by the wrapper's `overflowY: 'auto'` (the card is flush against its top, so a
//     negative top margin puts the button outside the scroll container), and what answered in the lost band
//     was the DIALOG'S SCRIM — `onClick={onCancel}`. Driven on the Oppo CPH2477 with the seal dialog open:
//     the top corners of the little x CLOSED THE DIALOG and left the error standing. That is the exact shape
//     this banner was already bitten by, where a strip painted as the banner and actuated what was behind it.
//   · 243 of the 1760 pixels that did reach it were OUTSIDE THE PAINTED CARD, over the dim to its right and
//     below — a steward pressing visibly-dim pixels and dismissing an error.
//   · 100 pixels of the neighbouring `Show` pill belonged to it, because growing the border box from 36 to 44
//     moved its left edge 4px across Show's right edge and this button paints later. That is not a miss: the
//     rightmost column of "Show the whole message" THREW THE MESSAGE AWAY, and dismissing is the only route
//     by which the full text becomes unreachable.
// Those three numbers are what the rows below print when the c58970a shape is put back, at both sizes.
// A centre-point check sees none of that. These rows scan the WHOLE rect on a 1px grid with elementFromPoint,
// and scan the neighbour too.
//
// WHY 37 AND NOT 44 WHILE DOCKED. The docked strip IS 37px tall — that is what clears a 92vh dialog at 328px
// of screen, and steward.html shortens every dialog by exactly that reservation — so 44 vertical pixels
// inside the painted card do not exist. The choice is a 44x37 target wholly inside the card, or a 44x44 box
// that hangs 7px out over the dialog's scrim. It is the first. The 44 that a cheap Android phone needs is
// kept in the dimension that has room (width), and the un-docked state below is still 44x44.
for (const [label, W, H] of [['360x730 upright', 360, 730], ['730x328 landscape', 730, 328]]) {
  test(`${label}: every pixel of the docked dismiss target actually reaches the dismiss button`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    const m = await measure('open', W, H);
    assert.ok(m.grid && m.grid.dismiss, 're-anchor: the docked banner rendered no dismiss button');
    const g = m.grid.dismiss;
    assert.equal(g.hit, g.total,
      `${g.total - g.hit} of the dismiss button's ${g.total} px2 DO NOT REACH IT at ${label} — ` +
      `${JSON.stringify(g.notMine)}. A rectangle is not a target: an ancestor clip is invisible to ` +
      'getBoundingClientRect, and SCRIM there means the steward cancels the dialog they were working in.');
    assert.equal(g.rows, g.h, `only ${g.rows} of the target's ${g.h} rows are live at ${label}`);
    assert.equal(g.cols, g.w, `only ${g.cols} of the target's ${g.w} columns are live at ${label}`);
    assert.ok(g.w >= 44,
      `THE DISMISS TARGET IS ${g.w}px WIDE at ${label}, under the 44 a cheap Android phone needs on the one ` +
      'control a steward presses to clear an error they have just been told about.');
  });

  test(`${label}: …and none of it lies outside the painted banner card, which is still one line`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    const m = await measure('open', W, H);
    const g = m.grid.dismiss, c = m.grid.card;
    assert.equal(g.outsideCard, 0,
      `${g.outsideCard} px2 of the dismiss target are OUTSIDE THE PAINTED CARD at ${label} (card ` +
      `${JSON.stringify(c)}, target ${JSON.stringify({ left: g.left, right: g.right, top: g.top, bottom: g.bottom })}) — ` +
      'they read to a steward as the dialog\'s dim, and pressing them throws an error message away.');
    // The target is the card's own right-hand end: exactly as tall as the card it sits in, and no wider than
    // the room the card has. Derived from the card, so a change to the card's padding cannot leave it stale.
    assert.deepEqual({ top: g.top, bottom: g.bottom }, { top: c.top, bottom: c.bottom },
      `the docked target no longer spans the card's height at ${label} — every row it loses is a row a ` +
      'finger has to be more accurate than the card looks');
    const barH = m.alert.bottom - m.alert.top;
    assert.ok(barH <= 40,
      `THE DOCKED BANNER IS ${barH}px TALL at ${label}. It was measured at 37 on the Oppo on 2026-09-17 and ` +
      'is meant to be one line — every pixel here comes off a dialog that is already 92vh.');
  });

  test(`${label}: …and it takes not one pixel of the Show button beside it`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    // THE NEIGHBOUR, because the fix for the target is what broke this. Dismiss paints after Show, so any
    // overlap is silently won by Dismiss — and the two controls are opposites: one opens the whole message,
    // the other is the only way to make it unreachable.
    const m = await measure('open', W, H);
    const s = m.grid.show;
    assert.ok(s, 're-anchor: the docked banner rendered no Show button');
    assert.equal(m.grid.showStolenByDismiss, 0,
      `DISMISS OWNS ${m.grid.showStolenByDismiss} px2 OF THE SHOW BUTTON at ${label}. The rightmost pixels of ` +
      'the pill labelled "Show the whole message" throw the message away instead of showing it.');
    assert.equal(s.notMine['BUTTON:Dismiss this message'] || 0, 0,
      `Show's own rectangle hit-tests as Dismiss in ${s.notMine['BUTTON:Dismiss this message']} places at ${label}`);
    assert.ok(s.rows === s.h,
      `only ${s.rows} of Show's ${s.h} rows are live at ${label} — something is sitting on it`);
  });
}

test('360x730: the dismiss button is a full 44x44 with NO dialog open, every pixel of it', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  // The control. This state was never broken — asserting it keeps a "fix" that trades one state for the
  // other from reading as a pass, and the in-flow card is 171px tall so 44x44 genuinely fits inside it.
  const m = await measure('shut', 360, 730);
  assert.ok(m.dismiss && m.grid && m.grid.dismiss, 're-anchor: the in-flow banner rendered no dismiss button');
  assert.ok(m.dismiss.w >= 44 && m.dismiss.h >= 44,
    `the in-flow banner's dismiss button is ${m.dismiss.w}x${m.dismiss.h}, under 44x44`);
  assert.ok(m.dismiss.footW <= 16 && m.dismiss.footH <= 16,
    `the in-flow dismiss button reserves ${m.dismiss.footW}x${m.dismiss.footH}, not the 16x16 it has always ` +
    'reserved — the card is now a different size than it was before this button was touched');
  const g = m.grid.dismiss;
  assert.equal(g.hit, g.total,
    `${g.total - g.hit} px2 of the in-flow dismiss target do not reach it — ${JSON.stringify(g.notMine)}`);
  assert.equal(g.rows, g.h, `only ${g.rows} of ${g.h} rows are live with no dialog open`);
  assert.equal(g.cols, g.w, `only ${g.cols} of ${g.w} columns are live with no dialog open`);
});

test('THE INSTRUMENT: the icon inside the dismiss button is a real 16px box, not nothing', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  // ⚠ NOTHING ELSE IN THIS FILE NOTICES IF THIS STUB GOES BACK TO RENDERING NOTHING. `minWidth: 44` pins the
  // border box either way, so all the rows above stayed green with a zero-size icon — which is how this file
  // once reported 20x20 where the phone had 36x36. The docked shape derives its height from the card rather
  // than from the icon, so it survives a zero icon; the numbers it reports would still be a fiction.
  for (const [which, w, h] of [['open', 360, 730], ['shut', 360, 730]]) {
    const m = await measure(which, w, h);
    assert.deepEqual(m.grid.icon, { w: 16, h: 16 },
      `the dismiss button's icon measures ${JSON.stringify(m.grid.icon)} in the "${which}" fixture. A stub ` +
      'that renders nothing makes every measurement in this file a measurement of padding.');
  }
});

// ── AND THE SAME QUESTION IN THE EXPANDED STATE, WHICH NOTHING HERE USED TO ASK ─────────────────────────────
//
// THE HOLE, NAMED (audit 2026-09-18). Every row above that measures the banner over a dialog uses the `open`
// fixture, and `open` is the DOCKED one-line strip. Press the Show pill on that same card and the banner
// becomes a taller card at `data-stew-banner="open"` — still fixed to the foot, still above the dialog, still
// inside a wrapper whose `overflowY: 'auto'` clips anything above its padding box. The dismiss button in that
// state takes the OTHER arm of the ternary (`padding: 14, margin: -14`), and -14 against 12px of card padding
// plus a 1px border puts its top row 1px ABOVE the card — outside the clip, where what answers is the
// dialog's scrim, and `SkConfirm`'s scrim is `<div onClick={onCancel}>`.
//
// Measured at 360x730 before the fix: card top 553, button top 552, 1892/1936 px2 reaching the button,
// notMine {"SCRIM": 44} — the whole top row. One CSS pixel, so a steward has to be unlucky; but it is the
// same class of defect as the two commits before this, and the consequence is identical: the press reads as
// "clear this error" and performs "throw away the dialog I was working in".
//
// PRE-EXISTING, NOT INTRODUCED, and provable without checking out the old commit: this arm of the ternary is
// the IN-FLOW shape, untouched by either of the two commits that fixed the docked state. Put `margin: -14`
// back in place of the `-12px -14px` beside it and both rows below go red at both sizes with the numbers
// above — which is the same measurement the 2026-09-18 audit took against the branch point.
for (const [label, W, H] of [['360x730 upright', 360, 730], ['730x328 landscape', 730, 328]]) {
  test(`${label}: the EXPANDED banner's dismiss target is whole, and none of it is the dialog's scrim`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    const m = await measure('expanded', W, H);
    assert.ok(m.dialog && m.alert, 're-anchor: the expanded fixture did not render both boxes');
    assert.ok(m.grid && m.grid.dismiss, 're-anchor: the expanded banner rendered no dismiss button');
    // THE FIXTURE MUST REALLY BE EXPANDED. Without this the row is vacuous: a fixture that silently stayed
    // docked would measure the strip a second time and pass on the docked shape's merits.
    assert.equal(m.grid.show, null,
      're-anchor: the expanded banner still renders a Show pill, so this fixture is measuring the DOCKED state');
    assert.ok(m.alert.bottom - m.alert.top > 40,
      `the "expanded" card is ${m.alert.bottom - m.alert.top}px tall — that is the one-line strip, not the ` +
      'expanded state, and every assertion in this row is then about the wrong thing');
    const g = m.grid.dismiss, c = m.grid.card;
    assert.equal(g.hit, g.total,
      `${g.total - g.hit} of the expanded dismiss button's ${g.total} px2 DO NOT REACH IT at ${label} — ` +
      `${JSON.stringify(g.notMine)}. SCRIM there means the steward aiming at "clear this message" cancels ` +
      'the dialog they were working in, because SkConfirm\'s scrim is onClick={onCancel}.');
    // NOT `rows === h` / `cols === w`, which the docked rows above can assert and this one cannot: the
    // expanded card lands on a half pixel, so the integer grid covers 43 of a 44px-high box and an equality
    // there would fail on the instrument rather than on the code. `hit === total` already says every pixel
    // the grid does reach belongs to the button — there is no hole — and the guard below says the scan was
    // not vacuous, which is the failure mode an inequality would otherwise hide.
    assert.ok(g.total >= 1800, `the expanded dismiss grid scanned only ${g.total} px2 at ${label} — a target ` +
      'that small is not the 44x44 this row believes it is measuring');
    assert.equal(g.outsideCard, 0,
      `${g.outsideCard} px2 of the expanded dismiss target are OUTSIDE THE PAINTED CARD at ${label} ` +
      `(card ${JSON.stringify(c)}, target ${JSON.stringify({ left: g.left, right: g.right, top: g.top, bottom: g.bottom })})`);
    // …and it is still the target a cheap Android phone needs. The expanded card has the room the docked one
    // does not, so this state keeps the full 44x44 and does not trade one defect for a smaller control.
    assert.ok(g.w >= 44 && g.h >= 44,
      `THE EXPANDED DISMISS TARGET IS ${g.w}x${g.h} at ${label}, under 44x44 — the docked state gives up ` +
      'vertical room because it has none; this one has room and must not.');
  });

  test(`${label}: …and the expanded banner still covers no control of the dialog`, { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
    // The mirror risk of making room above the card: whatever the fix does, the expanded banner must not
    // start intercepting the dialog's own buttons, and must not be see-through over them either.
    const m = await measure('expanded', W, H);
    // ⚠ `intercepted` IS DELIBERATELY NOT ASSERTED HERE, and the reason is a finding in its own right.
    // At 730x328 the `open` reservation shortens SkConfirm to 169px against 235px of content, so its Cancel
    // and "Seal it" are SCROLLED OUT OF the panel's own viewport — clipped by the dialog, not covered by the
    // banner. getBoundingClientRect still reports them at their unscrolled place, so `at()` samples a point
    // the dialog is not painting and reads back "banner". The instrument cannot tell "covered" from
    // "scrolled away"; asserting on it here would pin a false claim. What IS true, and is recorded for the
    // owner rather than fixed on this branch: expanding the banner on a landscape phone can put a dialog's
    // buttons below its own fold, and there is no control that collapses the banner again — `openWide`
    // clears only when the dialog closes.
    assert.deepEqual(m.insideBanner, [],
      `A TAP ON THE EXPANDED BANNER PRESSES A BUTTON BEHIND IT at ${label}: ` + JSON.stringify(m.insideBanner));
    assert.equal(m.atDismiss, 'banner',
      `the expanded banner's dismiss control is painted by something else at ${label} — it is behind the ` +
      'overlay (AUDIT-9), where it is greyed and cannot be tapped');
  });
}

// ── THE TRADE THE DOCKED SHAPE MADE, MEASURED SO IT CANNOT DRIFT FURTHER ────────────────────────────────────
//
// 9719cf0 dropped the dismiss button's horizontal negative margin, which is what stops it reaching across
// into the Show pill. The cost, which that commit did not state: the flex line now reserves the button's
// whole 44px instead of the icon's 16, so the one-line message loses 28px of room before it ellipsises.
// Measured here, by putting the old shape back: 192 -> 164 at 360x730, 424 -> 396 at 730x328. On a 360px
// phone that is about 15% of the line — four or five characters — and it is accepted, because the message is
// a summary either way and `Show` opens the whole sentence.
//
// This row is a FLOOR, not an equality: it exists so the next widening of a control in this strip cannot
// quietly take another slice of the message without somebody choosing to. The exact numbers above are the
// record; the thresholds below are where "a summary" stops being one.
test('the docked message keeps a readable amount of room beside its two controls', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
  for (const [label, W, H, floor] of [['360x730 upright', 360, 730, 150], ['730x328 landscape', 730, 328, 380]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
    await send('Page.setDocumentContent', { frameId, html: HTML.open });
    await sleep(350);
    const w = await evalIn(`(() => {
      const a = document.querySelector('[role="alert"]');
      // the message is the flex:1 child between the icon and the two buttons
      const el = [...a.children].find(e => e.tagName === 'DIV');
      return el ? Math.round(el.getBoundingClientRect().width) : -1;
    })()`);
    assert.ok(w > 0, `re-anchor: the docked banner has no message element at ${label}`);
    assert.ok(w >= floor,
      `THE DOCKED MESSAGE IS DOWN TO ${w}px AT ${label}, past the ${floor} floor. It was 192/424 before ` +
      '9719cf0 and 164/396 after; something has taken another slice of the one line a steward reads before ' +
      'deciding whether to open the whole thing.');
  }
});
