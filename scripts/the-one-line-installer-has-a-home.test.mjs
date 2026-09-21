// THE ONE-LINE INSTALLER HAS A HOME — AND THE CONSOLE POINTS AT IT INSTEAD OF PRINTING THE COMMAND.
// Run: node --test scripts/the-one-line-installer-has-a-home.test.mjs
//
// THE FINDING (reference/BACKLOG.md "Also for next session — the one-liner has no home yet", and the owner's
// Linux notes of 2026-09-19). At 3a8c980, `relay-app/install.sh` appeared in no help document (checked:
// app/help-data.jsx, app/screens-help.jsx, help.html — grep finds it only in app/stew-dashboard.jsx). The one
// place a steward met it was the console's "Run your own relay box" card, which printed
//
//     curl -fsSL app.trinityone.church/relay-app/install.sh | sudo bash
//
// with no explanation: an unread script piped into root, from a source that 404'd, beside a Linux button
// that fetched the AppImage — the package the owner found has to be marked executable before it runs, while
// the .deb, on Ubuntu 24.04, does nothing on double-click and needs `sudo apt install ./file.deb`.
//
// Now there is a guide, "Running your own relay" (help-data.jsx, id console-relay), carrying the two-step
// form — download, READ, run — with `-L`, the Linux package notes and the apt command; the console lists it;
// the relay card links it and no longer prints a command; the website's help page renders it too.
//
// Rules 1 and 3: the real console files are compiled and DRAWN (the house pattern from steward-help.test.mjs),
// the real settings page is opened, the real link pressed, and the guide's own words are read out of HelpData
// at run time rather than copied into this file. The website half is Chromium reading help.html's DOM from a
// gateway this test spawns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import * as H from './relay-network-harness.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));

// The order steward.html loads them in.
const FILES = ['app/help-illustrations.jsx', 'app/help-data.jsx', 'app/screens-help.jsx', 'app/stew-modal.jsx', 'app/stew-help.jsx', 'app/stew-dashboard.jsx'];
const JS = FILES.map(compileScreen).join('\n;\n');

function consoleWith(React) {
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    usePendingStewards: () => [],
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      isSelfHosted: () => false,   // a church NOT on a Suite box — the card that carries the download buttons and the link
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'p', qrSVG: () => '', joinUrl: () => 'https://app.example/join#x',
      inviteCode: () => 'ABC123', joinCode: () => 'ABC123', ownRelay: () => 'wss://relay.grace.example/relay',
      backupState: async () => ({ boxes: 1, online: 1, syncOn: false }), addRelay: () => '', removeRelay: () => {},
      rememberRelayName: () => {}, selfRegister: async () => ({}),
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    innerWidth: 1200, localStorage,
  };
  const globals = {
    React, window: win, location: { host: 'relay.grace.example', hostname: 'relay.grace.example' }, navigator: { userAgent: '' },
    document: { addEventListener() {}, removeEventListener() {}, activeElement: null },
    localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { pushState() {}, back() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: function Icon() { return null; }, Halo: function Halo() { return null; },
    SkBadge: function SkBadge() { return null; }, SkKey: function SkKey() { return null; }, SkQR: function SkQR() { return null; }, SkPill: function SkPill() { return null; },
    SK_TINT: { clay: { bg: '', fg: '' }, sage: { bg: '', fg: '' }, gold: { bg: '', fg: '' }, ink: { bg: '', fg: '' } },
    DashMealsPanel: function DashMealsPanel() { return null; }, DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; }, NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    DismissibleNote: function DismissibleNote(p) { return p.children; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    WizMeetings: function WizMeetings() { return null; }, _wizMeetingId: () => 'evt1',
    useStewNarrow: () => false, churchHandle: () => 'grace', stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  const want = ['DashSettings', 'StewDashboard', 'StewardHelp', 'StewHelpLink'];
  const mod = new Function(...names, JS + '\nreturn { ' + want.join(', ') + ' };')(...names.map((k) => globals[k]));
  for (const n of want) assert.equal(typeof mod[n], 'function', `${n} is not a function any more — re-anchor this test`);
  return { mod, win };
}
const fresh = () => { const { React, draw } = miniReact(); return { ...consoleWith(React), draw }; };
const dialogs = (tree) => find(tree, (n) => n.props && n.props.role === 'dialog' && n.props['aria-label'] === 'Help');
const articleButtons = (tree) => find(tree, (n) => n.type === 'button' && (n.props || {})['data-help-id']);
const helpButtons = (tree) => find(tree, (n) => n.type === 'button' && (n.props || {})['aria-label'] === 'Help');
const reachHelp = (tree, draw, Comp) => {
  const burger = find(tree, (n) => n.type === 'button' && (n.props || {})['aria-label'] === 'Sections');
  if (!burger.length) return tree;
  burger[0].props.onClick();
  return draw(Comp, {});
};
const article = (win) => win.HelpData.articles.find((a) => a.id === 'console-relay');
const said = (tree) => texts(tree).join(' ');

// ── §1 · the guide exists and says the right things, read from the data ──────────────────────────────────

test('the guide carries the two-step form: download with -L, read, then run — never curl | sudo bash', () => {
  const { win } = fresh();
  const a = article(win);
  assert.ok(a && Array.isArray(a.blocks) && a.blocks.length >= 5, 'there is no "console-relay" guide with a body in help-data.jsx — the one-liner has no home again');
  const steps = a.blocks.filter((b) => b.type === 'steps').flatMap((b) => b.items);
  assert.ok(steps.length >= 3, 'the guide has no numbered steps');
  const dl = steps.findIndex((s) => /curl -fsSL -o install\.sh https:\/\/app\.trinityone\.church\/relay-app\/install\.sh/.test(s));
  const rd = steps.findIndex((s) => /less install\.sh/.test(s));
  const run = steps.findIndex((s) => /sudo bash install\.sh/.test(s));
  assert.ok(dl > -1, 'no step downloads the installer to a file with -L (curl -fsSL -o install.sh …)');
  assert.ok(rd > -1, 'no step tells the reader to READ the script before running it');
  assert.ok(run > -1, 'no step runs the downloaded file with sudo bash install.sh');
  assert.ok(dl < rd && rd < run, 'the steps are not in the order download → read → run');
  for (const s of steps) assert.doesNotMatch(s, /\|\s*sudo bash/, 'a step still pipes the installer into sudo: ' + s);
  const all = a.blocks.flatMap((b) => [b.text, ...(b.items || []).map((it) => (typeof it === 'string' ? it : it.lead + ' ' + it.text))]).filter(Boolean).join('\n');
  assert.match(all, /sudo apt install \.\/TrinityOne-Suite-linux-x86_64\.deb/, 'the .deb install command for Ubuntu 24.04 is missing');
  assert.match(all, /24\.04/, 'the guide does not say what happens on Ubuntu 24.04 (double-clicking the .deb does nothing)');
  assert.match(all, /executable/, 'the guide does not say the AppImage must be marked executable');
  assert.doesNotMatch(all, /<[a-z]+>/, 'the guide carries an HTML tag — the console renders these strings as text, so it would show literally');
});

// ── §2 · the console lists it, and opening it puts the steps on screen ───────────────────────────────────

test('a steward can open the guide from the console’s Help, and the steps reach the dialog', () => {
  const { mod, draw, win } = fresh();
  let tree = draw(mod.StewDashboard, {});
  tree = reachHelp(tree, draw, mod.StewDashboard);
  const hb = helpButtons(tree);
  assert.ok(hb.length, 'the console has no Help control');
  hb[0].props.onClick();
  tree = draw(mod.StewDashboard, {});
  const btn = articleButtons(dialogs(tree)[0]).find((b) => b.props['data-help-id'] === 'console-relay');
  assert.ok(btn, 'the console does not list "console-relay" — a steward cannot reach the guide the relay card links');
  btn.props.onClick();
  tree = draw(mod.StewDashboard, {});
  const s = said(dialogs(tree)[0]);
  const a = article(win);
  for (const b of a.blocks) {
    if (b.type === 'steps') for (const it of b.items) assert.ok(s.includes(it), `step "${it.slice(0, 50)}…" did not reach the dialog`);
    if (b.type === 'callout') assert.ok(s.includes(b.text), 'the Linux package callout did not reach the dialog');
  }
});

// ── §3 · the relay card links the guide and prints no command ────────────────────────────────────────────

function ownboxPage() {
  const { mod, draw, win } = fresh();
  const render = () => draw(mod.DashSettings, { initialSection: 'ownbox', onSectionConsumed() {} });
  render();
  return { mod, draw, win, render, tree: render() };
}
const panelTitled = (tree, title) => find(tree, (n) => typeof n.type === 'function' && n.type.name === 'Panel' && String(n.props.title) === title);

test('the relay card carries a link to the guide and no longer prints a curl command', () => {
  const { tree } = ownboxPage();
  const card = panelTitled(tree, 'Run your own relay box');
  assert.equal(card.length, 1, 'the "Run your own relay box" card is not on the ownbox settings page — re-anchor this test');
  const s = said(card[0]);
  assert.doesNotMatch(s, /curl/, 'the card still prints a curl command — the console is instructing stewards to pipe an unread script into root');
  assert.doesNotMatch(s, /sudo bash/, 'the card still prints sudo bash');
  const links = find(card[0], (n) => n.type === 'button' && /^Open the guide:/.test(String((n.props || {}).title || '')));
  assert.equal(links.length, 1, 'the card has no link to a guide');
  assert.match(String(links[0].props.title), /Running your own relay/, 'the link is not to the relay guide');
});

test('pressing the link opens the relay guide itself, not the list of guides', () => {
  const { tree, render } = ownboxPage();
  const card = panelTitled(tree, 'Run your own relay box')[0];
  const link = find(card, (n) => n.type === 'button' && /^Open the guide:/.test(String((n.props || {}).title || '')))[0];
  link.props.onClick();
  const after = render();
  const dlg = dialogs(after);
  assert.equal(dlg.length, 1, 'pressing the link opened no Help dialog');
  const s = said(dlg[0]);
  assert.match(s, /Running your own relay/, 'the dialog that opened is not the relay guide');
  assert.match(s, /sudo bash install\.sh/, 'the guide that opened does not carry the run step — the link opened something else');
});

test('the Linux download on the card is the .deb, which the guide’s apt command installs', () => {
  const { tree } = ownboxPage();
  const card = panelTitled(tree, 'Run your own relay box')[0];
  const linux = find(card, (n) => n.type === 'a' && /\/releases\/latest\/download\//.test(String((n.props || {}).href || '')) && texts(n).join(' ').includes('Linux'));
  assert.equal(linux.length, 1, 'the card has no Linux download');
  assert.match(String(linux[0].props.href), /TrinityOne-Suite-linux-x86_64\.deb$/,
    'the Linux button still fetches the AppImage, which has to be marked executable before it runs; the guide tells people to install the .deb');
});

// ── §4 · the website’s help page renders it too ─────────────────────────────────────────────────────────

test('help.html on the website renders the guide with the run step', { skip: CHROME ? false : 'no chromium', timeout: 120000 }, async () => {
  const port = await H.freePort('help-page'), cdp = await H.freePort('chromium debug port');
  const dir = mkdtempSync(join(tmpdir(), 'trin-help-'));
  const gw = spawn(process.execPath, ['scripts/gateway.mjs', String(port)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dir, RELAY_SYNC: '0' } });
  const prof = join(tmpdir(), 'trin-help-chr-' + process.pid);
  let chr = null;
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { await sleep(200); try { up = (await fetch(`http://127.0.0.1:${port}/status`)).ok; } catch {} }
    assert.ok(up, 'the gateway never came up');
    chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
      '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
      `--user-data-dir=${prof}`, '--window-size=1280,1200', `http://127.0.0.1:${port}/help.html`], { stdio: 'ignore' });
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find((t) => t.type === 'page') || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await sleep(4000);
    const rr = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({
      present: !!document.getElementById('console-relay'),
      text: (document.getElementById('console-relay') || {}).innerText || '',
      inToc: !!document.querySelector('#toc a[href="#console-relay"]'),
    })` });
    ws.close();
    const v = JSON.parse(rr.result.result.value);
    assert.equal(v.present, true, 'help.html does not render an article with id console-relay — the website link help.html#console-relay lands nowhere');
    assert.equal(v.inToc, true, 'the guide is not in the help page’s table of contents');
    assert.match(v.text, /sudo bash install\.sh/, 'the rendered guide does not carry the run step');
    assert.match(v.text, /sudo apt install \.\/TrinityOne-Suite-linux-x86_64\.deb/, 'the rendered guide does not carry the .deb command');
  } finally {
    try { chr && chr.kill('SIGKILL'); } catch {}
    try { gw.kill('SIGKILL'); } catch {}
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('the website’s download section points at the guide, and README no longer pipes the installer into sudo', () => {
  // Two static pages, read as files: these are not behaviour claims about jsx (rule 3), they are the two
  // remaining places the one-liner was written down.
  const welcome = readFileSync(join(ROOT, 'welcome.html'), 'utf8');
  assert.match(welcome, /href="help\.html#console-relay"/, 'welcome.html has no quiet line under the download cards linking the guide');
  const readme = readFileSync(join(ROOT, 'relay-app', 'README.md'), 'utf8').split('\n').filter((l) => !/^\s*(#|<!--)/.test(l)).join('\n');
  assert.doesNotMatch(readme, /install\.sh \| sudo bash/, 'relay-app/README.md still tells people to pipe install.sh into sudo bash');
  assert.match(readme, /curl -fsSL -o install\.sh/, 'relay-app/README.md does not carry the download-to-a-file step');
});
