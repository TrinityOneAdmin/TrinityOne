// A VERSE NUMBER SITS WITH ITS VERSE, AFTER THE HEADING — NOT ALONE ABOVE IT.
// Run: node --test scripts/a-verse-number-follows-its-heading.test.mjs
//
// Device round 2026-10-01 (Oppo, BSB): in John 1 and Psalm 3 the verse number "1" sat on a line of its own ABOVE
// the section heading, with the words of the verse below the heading. The engine's USFM parser hangs a heading
// (its parallel reference, a Psalm's title) on the END of the verse before it; at the start of a chapter there is
// none, so it goes at the START of verse 1's html — and VerseRow (app/screens-read.jsx) printed the number before
// that html. It now draws a heading the verse opens with first, then the number, then the verse — all still in
// verse 1's own row (the heading does not move to another verse, so selecting and highlighting are unchanged).
//
// The point of use: the real member app in headless Chromium against a throwaway gateway, reading the SHIPPED
// BSB, and the assertions are GEOMETRY read off the rendered page — where the number is drawn relative to the
// headings and to the verse's first word — which is what the member saw. Nothing matches source text (rule 3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const PORT = 8964, CDP = 9378;   // unique across scripts/*.test.mjs and scripts/*.probe.mjs
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let relay, dataDir, chr, ws, prof, send;
const errors = [];

before(async () => {
  await requireFreePort(PORT, 'a-verse-number-follows-its-heading.test.mjs');
  await requireFreePort(CDP, 'a-verse-number-follows-its-heading.test.mjs (Chrome debug port)');
  if (!CHROME) return;
  dataDir = mkdtempSync(join(tmpdir(), 'trin-vnum-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(getPublicKey(generateSecretKey())), RELAY_MAX_EVENTS: '2000' },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(200); }
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  prof = mkdtempSync(join(tmpdir(), 'trin-vnum-chr-'));
  // a phone-width window: the device was 360 CSS px wide
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=380,900', `http://127.0.0.1:${PORT}/?tab=read`],
    { stdio: 'ignore', cwd: prof });
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push((e.exception?.description || e.text || '').split('\n')[0]); }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await settle();
});
after(() => {
  try { ws && ws.close(); } catch {}
  try { chr && chr.kill('SIGKILL'); } catch {}
  try { relay && relay.kill('SIGKILL'); } catch {}
  try { rmSync(prof, { recursive: true, force: true }); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

async function evalIn(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  const d = r && r.result;
  if (d && d.exceptionDetails) throw new Error('page threw: ' + (d.exceptionDetails.exception?.description || d.exceptionDetails.text));
  return d && d.result ? d.result.value : undefined;
}
async function evalSoft(expr) { try { return await evalIn(expr); } catch { return undefined; } }
async function settle() {
  for (let i = 0; i < 160; i++) { if (await evalSoft('!!(window.Bible && window.Bible.loaded === true && window.Bible.loading === false)')) break; await sleep(250); }
  for (let i = 0; i < 60; i++) { if (await evalSoft('!!document.getElementById("rv-2")')) break; await sleep(250); }
  await sleep(1200);   // fonts and layout settle before anything is measured
}
// Open a chapter by the reader's own remembered place (trinityone.readLoc.<translation>) and a real reload.
async function openChapter(book, chap) {
  await evalIn(`localStorage.setItem('trinityone.readLoc.' + window.Bible.activeVersion, JSON.stringify({ book: ${book}, chap: ${chap} })); window.__marker = 1; true`);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?tab=read` });
  for (let i = 0; i < 160; i++) { if (await evalSoft('typeof window.__marker === "undefined"') === true) break; await sleep(250); }
  await settle();
}
// Where verse N's NUMBER is drawn, relative to the headings in its row and to the first word after the number.
const measure = (n) => evalIn(`(() => {
  const row = document.getElementById('rv-${n}');
  if (!row) return { err: 'no verse ${n} on screen' };
  const sup = [...row.querySelectorAll('sup')].find(s => !s.classList.contains('st') && s.textContent.trim() === '${n}');
  if (!sup) return { err: 'verse ${n} has no number' };
  const sr = sup.getBoundingClientRect();
  const heads = [...row.querySelectorAll('.sec, .parref')].map(h => { const r = h.getBoundingClientRect(); return { text: h.textContent.trim().slice(0, 50), top: r.top, bottom: r.bottom }; });
  const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let after = false, first = null;
  while (w.nextNode()) { const t = w.currentNode; if (t.parentNode === sup) { after = true; continue; } if (after && t.textContent.trim()) { first = t; break; } }
  if (!first) return { err: 'no words after verse ${n}’s number', heads };
  const at = first.textContent.search(/\\S/);
  const rg = document.createRange(); rg.setStart(first, at); rg.setEnd(first, at + 1);
  const fr = rg.getBoundingClientRect();
  return { heads, sup: { top: sr.top, bottom: sr.bottom }, first: { text: first.textContent.trim().slice(0, 40), top: fr.top, bottom: fr.bottom } };
})()`);
function assertNumberAfterHeadings(m, where, firstWords) {
  assert.ok(!m.err, where + ': ' + m.err);
  assert.ok(m.heads.length >= 1, where + ' shows no heading in its row: either the screen dropped it, or the shipped BSB no longer opens the verse with one (then this row tests nothing)');
  for (const h of m.heads) {
    assert.ok(h.bottom <= m.sup.top + 1,
      `THE FINDING: ${where}'s number is drawn ABOVE (or beside) its heading "${h.text}" — number top ${Math.round(m.sup.top)}, heading bottom ${Math.round(h.bottom)}`);
  }
  assert.ok(m.first.text.startsWith(firstWords), `${where}: the first words after the number are not the verse — "${m.first.text}"`);
  assert.ok(m.sup.bottom > m.first.top && m.sup.top < m.first.bottom,
    `${where}: the number is not on the same line as the verse's first word (number ${Math.round(m.sup.top)}–${Math.round(m.sup.bottom)}, word ${Math.round(m.first.top)}–${Math.round(m.first.bottom)})`);
}

test('John 1:1 and Psalm 3:1 (shipped BSB): the headings first, then the number on the line of the verse’s first words', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  assert.match(String(await evalIn('window.Bible.activeVersion')), /BSB/i, 'CONTROL: the reader is not on the shipped BSB');
  await openChapter(43, 1);
  assertNumberAfterHeadings(await measure(1), 'John 1:1', 'In the beginning');
  // CONTROL: a verse with no heading is drawn as it always was — number, then its words, on one line
  const v2 = await measure(2);
  assert.ok(!v2.err && v2.heads.length === 0, 'CONTROL: John 1:2 has a heading or no number: ' + JSON.stringify(v2));
  assert.ok(v2.sup.bottom > v2.first.top && v2.sup.top < v2.first.bottom, 'CONTROL: John 1:2’s number is not on the line of its words');

  await openChapter(19, 3);
  const p = await measure(1);
  assertNumberAfterHeadings(p, 'Psalm 3:1', 'O LORD');
  // the heading, its parallel reference and the Psalm title are all still in verse 1's row (nothing moved verses)
  const texts = p.heads.map(h => h.text).join(' | ');
  assert.match(texts, /Deliver Me/i, 'Psalm 3’s heading is no longer in verse 1’s row: ' + texts);
  assert.match(texts, /A Psalms? of David/i, 'Psalm 3’s title is no longer in verse 1’s row: ' + texts);
  assert.deepEqual(errors, [], `the app threw:\n  ${errors.join('\n  ')}`);
});

// ── the split itself, lifted from app/screens-read.jsx and RUN (rule 3: the file ships unbundled, so it is never
// text-matched) — the shapes the browser rows above do not reach ────────────────────────────────────────────────
test('splitVerseLead: only a heading run AT THE START is split off; nested spans kept whole; anything odd left alone', () => {
  const SRC = readFileSync(ROOT + 'app/screens-read.jsx', 'utf8');
  // sliced to the closing brace at column 0 (fnBody's quote-aware walk trips on the `"` inside its regexes)
  const at = SRC.indexOf('\nfunction splitVerseLead(');
  assert.notEqual(at, -1, 'splitVerseLead is gone from app/screens-read.jsx — re-anchor this test');
  const split = new Function(SRC.slice(at, SRC.indexOf('\n}\n', at) + 2) + '; return splitVerseLead;')();
  // the shipped BSB's Psalm 3:1, as the engine writes it: heading, parallel reference, Psalm title, then the words
  const ps3 = '<br><span class="sec">Deliver Me, O LORD!</span><br><span class="parref">(2 Samuel 15:13–29)</span><br><span class="sec d">A Psalms of David, when he fled from his son Absalom.</span> <br><br>O LORD, how my foes have increased! <br>&emsp;How many rise up against me!';
  const [lead, body] = split(ps3);
  assert.ok(lead.endsWith('Absalom.</span> <br><br>'), 'the heading run (and the breaks after it) did not come off whole: ' + JSON.stringify(lead));
  assert.ok(body.startsWith('O LORD, how my foes'), 'the verse did not start with its own words: ' + JSON.stringify(body));
  assert.equal(lead + body, ps3, 'the split lost or added something');
  const cases = [
    ['In the beginning was the Word.', '', 'no heading: nothing split off'],
    ['<span class="red">Jesus said</span> to them', '', 'a non-heading span first (words of Jesus) is the verse, not a heading'],
    ['<span class="secret">x</span>y', '', '"sec" must be a whole class, not a prefix'],
    ['Words first<span class="sec">Heading</span>', '', 'a heading AFTER the words stays where it is'],
    ['<span class="sec">The <span class="nd">Lord</span> Reigns</span><br>Words', '<span class="sec">The <span class="nd">Lord</span> Reigns</span><br>', 'a nested span inside the heading is kept whole'],
    ['<span class="sec">Head <span class="nd">oops</span>Words', '', 'an unbalanced heading leaves everything in the body, as before'],
    ['<br><span class="sec qa">ALEPH</span><br>Blessed', '<br><span class="sec qa">ALEPH</span><br>', 'a two-class heading (an acrostic letter) counts'],
  ];
  for (const [html, wantLead, why] of cases) {
    const [l, b] = split(html);
    assert.equal(l, wantLead, why + ' — lead was ' + JSON.stringify(l));
    assert.equal(l + b, html, why + ' — the split lost or added something');
  }
});
