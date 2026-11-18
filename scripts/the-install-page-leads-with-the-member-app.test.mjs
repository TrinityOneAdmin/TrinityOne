// THE INSTALL PAGE LEADS WITH THE MEMBER APP — THE STEWARD BUILD IS BEHIND A CLOSED DISCLOSURE.
// Run: node --test scripts/the-install-page-leads-with-the-member-app.test.mjs
//
// WHY. Stewards hand out their box's /install link. Members opened it and found two equal cards with two
// identical "Download and install" buttons — TrinityOne and TrinityOne Steward — and some installed the wrong
// one. The page now shows the member app as the one download and tucks the steward build into a <details>
// that starts closed.
//
// Point of use (CLAUDE.md rule 1): every assertion here is on the HTML a REAL gateway serves at /install,
// from APK files really sitting in its apks/ folder. The structure is parsed (which <details> encloses which
// link), not substring-matched, so a page that merely mentions the right words cannot pass.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from './relay-network-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = [];

// A box with exactly these files in apks/, and no update origin (so it fetches nothing on its own).
async function boxHolding(names) {
  const dir = mkdtempSync(join(tmpdir(), 'trin-install-lead-'));
  mkdirSync(join(dir, 'apks'), { recursive: true });
  for (const n of names) writeFileSync(join(dir, 'apks', n), Buffer.alloc(200_000, 0x61));
  const port = await H.freePort('install-lead-box');
  const proc = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_SYNC: '0' },
  });
  running.push({ proc, dir });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { await sleep(200); try { if ((await fetch(base + '/status')).ok) break; } catch {} }
  const r = await fetch(base + '/install');
  assert.equal(r.status, 200, 'precondition: /install did not answer');
  return r.text();
}
after(() => {
  for (const { proc, dir } of running) { try { proc.kill('SIGKILL'); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  H.stopAll();
});

// For each <a href="…">, the stack of <details> elements enclosing it (outermost first), each with whether
// it carries `open`. A tiny tag walker is enough: the page is generated, well-formed, and has no comments.
function linkContainers(html) {
  const out = [];
  const stack = [];
  const re = /<(\/?)(details|a)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [, close, tag, attrs] = m;
    if (tag.toLowerCase() === 'details') {
      if (close) stack.pop();
      else stack.push({ open: /(^|\s)open(\s|=|$)/i.test(attrs), cls: (attrs.match(/class="([^"]*)"/) || [])[1] || '' });
      continue;
    }
    if (close) continue;
    const href = (attrs.match(/href="([^"]*)"/) || [])[1];
    if (href) out.push({ href, details: stack.map((d) => ({ ...d })) });
  }
  assert.equal(stack.length, 0, 'the page left a <details> unclosed, so the structure cannot be trusted');
  return out;
}
const linkTo = (links, href) => {
  const hits = links.filter((l) => l.href === href);
  assert.equal(hits.length, 1, 'expected exactly one link to ' + href + ', found ' + hits.length);
  return hits[0];
};

test('with both apps held, the member app is the one download in plain view', async () => {
  const links = linkContainers(await boxHolding(['trinityone.apk', 'trinityone-steward.apk']));
  const member = linkTo(links, '/trinityone.apk');
  assert.equal(member.details.length, 0,
    'the member app download sits inside a <details>, so a member has to open something to find the app meant for them');
});

test('with both apps held, the steward download is behind a disclosure that starts closed', async () => {
  const html = await boxHolding(['trinityone.apk', 'trinityone-steward.apk']);
  const steward = linkTo(linkContainers(html), '/trinityone-steward.apk');
  assert.ok(steward.details.length >= 1,
    'the steward download is in plain view beside the member app — the two-equal-buttons confusion is back');
  assert.ok(steward.details.every((d) => !d.open),
    'the steward download is inside a <details> that is already open, so it is not hidden at all');
  // It comes after the numbered steps, so the steps' "Download and install above" still points at the member app.
  assert.ok(html.indexOf('href="/trinityone-steward.apk"') > html.indexOf('</ol>'),
    'the steward disclosure was placed above the install steps');
});

test('a box holding only the steward app does not hide the only thing it can offer', async () => {
  const links = linkContainers(await boxHolding(['trinityone-steward.apk']));
  const steward = linkTo(links, '/trinityone-steward.apk');
  assert.equal(steward.details.length, 0,
    'with no member app on the box, the steward download was tucked away and the page showed nothing to download');
  assert.equal(links.filter((l) => l.href === '/trinityone.apk').length, 0, 'precondition: no member app on this box');
});
