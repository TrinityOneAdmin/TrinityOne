// THE "SHARE AS IMAGE" CARD IS A REAL PNG, DRAWN IN THE CARD'S OWN COLOURS.
// Run: node --test scripts/the-verse-card-is-a-real-png.test.mjs
//
// scripts/sharing-the-app-and-a-bible-are-separate.test.mjs (section C) proves the card's buttons share ONE .png
// plus the words and no link — but with a FAKE canvas. This proves the other half: that the real canvas code in
// app/share-app.jsx (shareCardPng), run in a real browser (headless Chromium), makes a decodable PNG of the fixed
// size, in each of the four styles, with the verse actually painted on it, and that a church's own accent (a
// --clay set on an element, as App sets it on the app's root, not on <html>) is the colour drawn.
// The whole of app/share-app.jsx is compiled (esbuild --jsx=transform, as scripts/sync-web.sh does) and loaded
// into the page as a classic script; nothing in it is re-typed here.
// NOT PROVED HERE: the Newsreader/Sora web fonts (this page has no font files, so the canvas uses the fallback
// serif/sans — the font wait is exercised, not the font), and how WhatsApp/Signal show the picture (device test).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { compileScreen } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9623;   // unique across scripts/*.test.mjs
const sleep = ms => new Promise(r => setTimeout(r, ms));
let chr = null, ws = null, dir = null;
after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

test('shareCardPng makes a real 1080x1350 PNG in every style, with the verse painted on it and the church accent used',
  { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const js = compileScreen('app/share-app.jsx');
    const style = [...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    await requireFreePort(CDP, 'the-verse-card-is-a-real-png.test.mjs (Chrome debug port)');
    dir = mkdtempSync(join(tmpdir(), 'trin-versepng-'));
    chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
      `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
    let targets = null;
    for (let i = 0; i < 50 && !(targets && targets.length); i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const pg = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(pg.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable'); await send('Runtime.enable');
    const { result: { frameTree } } = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: `<meta charset="utf-8"><style>${style}</style><div id="church" style="--clay:#1E5AA8;--clay-deep:#0E2A50"></div>` });
    const load = await send('Runtime.evaluate', { expression: js + '\n;"loaded"' });
    assert.ok(!load.result.exceptionDetails, 'app/share-app.jsx did not load in the page: ' + JSON.stringify(load.result.exceptionDetails || {}).slice(0, 400));

    const probe = `(async () => {
      const verse = { ref: 'John 3:16', version: 'WEB', text: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.' };
      const long = { ref: 'Psalm 119:1-24', version: 'WEB', text: ('Blessed are those whose ways are blameless, who walk according to the law of the LORD. ').repeat(40) };
      const read = async (bytes) => {
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
        const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data.slice(0, 3));
        // how many distinct colours along a row through the text block: a blank card has 1-2 (a gradient: a few)
        let ink = 0; const d = x.getImageData(0, 0, c.width, c.height).data; const bg = px(6, c.height / 2);
        for (let i = 0; i < d.length; i += 4 * 7) { if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 150) ink++; }
        return { w: bmp.width, h: bmp.height, sig: Array.from(bytes.slice(0, 8)), corner: px(1, 1), ink };
      };
      const out = {};
      for (const st of CARD_STYLES) out[st.id] = await read(await shareCardPng(verse, st, null));
      out.church = await read(await shareCardPng(verse, CARD_STYLES[0], document.getElementById('church')));
      out.long = await read(await shareCardPng(long, CARD_STYLES[0], null));
      // the same card with no words: what the reference, the marks and the TRINITYONE line alone paint
      out.empty = await read(await shareCardPng({ ...verse, text: '' }, CARD_STYLES[0], null));
      return JSON.stringify(out);
    })()`;
    const r = await send('Runtime.evaluate', { expression: probe, returnByValue: true, awaitPromise: true });
    assert.ok(!r.result.exceptionDetails, 'shareCardPng threw: ' + JSON.stringify(r.result.exceptionDetails || {}).slice(0, 400));
    const out = JSON.parse(r.result.result.value);
    const near = (a, b, tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
    for (const id of ['clay', 'sage', 'paper', 'night', 'church', 'long']) {
      const o = out[id];
      assert.deepEqual(o.sig, [137, 80, 78, 71, 13, 10, 26, 10], `${id}: not a PNG`);
      assert.equal(o.w, 1080, `${id}: width ${o.w}`);
      assert.equal(o.h, 1350, `${id}: height ${o.h}`);
      assert.ok(o.ink > 300, `${id}: almost nothing is painted on the card (${o.ink} ink samples) — the verse is not drawn`);
    }
    // the words themselves are painted: far more ink than the same card with no words (measured 6549 vs 1142, ~5.7x)
    assert.ok(out.clay.ink > out.empty.ink * 2, `the verse adds almost no ink (${out.clay.ink} vs ${out.empty.ink} with no words) — the words are not drawn`);
    assert.ok(out.long.ink > out.clay.ink, `a long passage paints no more than a short verse (${out.long.ink} vs ${out.clay.ink})`);
    // the card's own colours at its top-left corner (where the 155deg gradient starts), with :root's theme
    assert.ok(near(out.clay.corner, [0xC2, 0x5A, 0x38]), `clay corner ${out.clay.corner}`);
    assert.ok(near(out.sage.corner, [0x6B, 0xA1, 0x7C]), `sage corner ${out.sage.corner}`);
    assert.ok(near(out.night.corner, [0x2A, 0x22, 0x18]), `night corner ${out.night.corner}`);
    assert.ok(near(out.paper.corner, [0xFF, 0xFD, 0xF8], 40), `paper corner ${out.paper.corner}`);
    // a church accent set on an element (not :root) is what the card is drawn in
    assert.ok(near(out.church.corner, [0x1E, 0x5A, 0xA8]), `church-accent corner ${out.church.corner} — the church's own --clay was not used`);
  });
