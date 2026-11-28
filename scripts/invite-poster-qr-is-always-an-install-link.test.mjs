// THE INVITE POSTER'S PRIMARY QR IS ALWAYS AN INSTALL LINK — never the join link.
// Run: node --test scripts/invite-poster-qr-is-always-an-install-link.test.mjs
//
// A church with no relay-specific install page used to get `url={install.url || url}`: the poster fell back to the
// JOIN link, which opens nothing for a person who has not got the app. Now it falls back to the public install page.
// Drives the real JoinCard (what the steward sees) and the real InvitePosterModal (PDF + share), CLAUDE.md §1/§3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnBody } from './test-slice.mjs';
import { miniReact, button, find } from './render-jsx-screen.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DASH = readFileSync(process.env.POSTER_TEST_SRC_FILE || join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const JOIN = 'https://app.trinityone.church/?follow=npub1grace&relay=' + encodeURIComponent('wss://grace.example/relay');
const PUBLIC = 'https://app.trinityone.church/install';

function lift(anchors, name, globals) {
  const body = anchors.map(([a, n]) => fnBody(DASH, a, n)).join('\n\n');
  const tmp = join(tmpdir(), 'poster-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try { writeFileSync(tmp, body); js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8' }); }
  finally { rmSync(tmp, { force: true }); }
  const names = Object.keys(globals);
  return new Function(...names, js + '\nreturn { ' + name + ' };')(...names.map((k) => globals[k]))[name];
}

// Open the poster from the real JoinCard with the given installPageUrl() answer; return what the modal was handed.
function openPoster(installAnswer) {
  const { React, draw } = miniReact();
  const stub = () => null;
  const church = { npub: 'npub1grace', name: 'Grace Chapel', nip05: '' };
  const JoinCard = lift(
    [['function installerConcern(', 'installerConcern'], ['const INSTALLER_OLD_DAYS', 'INSTALLER_OLD_DAYS'],
     ['async function readInstallerConcern(', 'readInstallerConcern'],
     ['const PUBLIC_INSTALL_URL', 'PUBLIC_INSTALL_URL'], ['function posterInstallLink(', 'posterInstallLink'],
     ['function JoinCard(', 'JoinCard']],
    'JoinCard', {
      React, AbortSignal, fetch: async () => { throw new Error('x'); },
      window: { useStewardChurch: () => church, Steward: { npub: church.npub, joinUrl: () => JOIN, joinLinkIsPrivate: () => false, qrSVG: (t) => '<svg data-for="' + t + '"/>' }, TrinityTemplates: { printInstallSheet() {} } },
      navigator: {}, document: { createElement: () => ({ style: {}, getContext: () => ({}) }) },
      installPageUrl: () => installAnswer, useGoPublicGate: () => ({ blocking: false }),
      GoPublicPanel: stub, GoPublicNote: stub, SkQR: stub, Icon: stub, InvitePosterModal: 'POSTER',
      copyText: () => true, churchHandle: () => '', shortNpub: (s) => s,
    });
  let tree = draw(JoinCard, {});
  button(tree, 'Invite')[0].props.onClick();   // the poster button
  tree = draw(JoinCard, {});
  const m = find(tree, (n) => n.type === 'POSTER');
  assert.equal(m.length, 1, 'pressing the invite-poster button did not open the poster');
  return m[0].props;
}

test('(a) a church with its own install page: the poster QR encodes THAT', () => {
  const p = openPoster({ url: 'https://grace.example/install', lan: false, why: '' });
  assert.equal(p.url, 'https://grace.example/install');
  assert.equal(p.svg, '<svg data-for="https://grace.example/install"/>');
});

for (const [label, ans] of [['no relay at all', { url: '', lan: false, why: 'none' }], ['loopback relay', { url: '', lan: false, why: 'local' }]]) {
  test('(b,c) ' + label + ': the poster QR encodes the PUBLIC install page, never the join link', () => {
    const p = openPoster(ans);
    assert.equal(p.url, PUBLIC);
    assert.equal(p.svg, '<svg data-for="' + PUBLIC + '"/>', 'the QR drawn on the poster does not encode the public install page');
    assert.notEqual(p.url, p.joinUrl);
    assert.ok(!p.svg.includes('follow='), 'the poster QR carries the join link');
    assert.match(p.joinUrl, /follow=npub1grace/, 'the join link must still be handed along for person-to-person sharing');
  });
}

test('(b,d) the real modal: the PDF is built from the install link, and Share link still sends the JOIN link', async () => {
  const props = openPoster({ url: '', lan: false, why: 'none' });
  const { React, draw } = miniReact();
  const pdf = [], shared = [];
  const Modal = lift([['function InvitePosterModal(', 'InvitePosterModal']], 'InvitePosterModal', {
    React, history: { pushState() {} }, document: { createElement: () => ({}), head: { appendChild() {}, removeChild() {} } },
    window: { addEventListener() {}, removeEventListener() {}, print() {}, Capacitor: { isNativePlatform: () => true, Plugins: { Share: { share: async (a) => { shared.push(a); } } } } },
    churchMarkDataUrl: async () => 'logo', buildInvitePdf: async (a) => { pdf.push(a); return null; },
    copyText: () => true, Icon: () => null, SkQR: () => null, useStewDialog: () => {},
  });
  let tree = draw(Modal, props);
  await button(tree, 'Share link')[0].props.onClick();
  assert.equal(shared.length, 1);
  assert.match(props.joinUrl, /follow=npub1grace/);
  assert.equal(shared[0].url, props.joinUrl, 'shareInvite must stay the join link');
  const save = find(tree, (n) => n.type === 'button' && n.props.onClick && /pdf/i.test(JSON.stringify(n.kids || n.props.children || '')));
  assert.ok(save.length >= 1, 'no save-PDF control');
  await save[0].props.onClick();
  assert.equal(pdf.length, 1, 'saving the PDF did not build one');
  assert.equal(pdf[0].url, PUBLIC);
  assert.equal(pdf[0].svg, props.svg);
});

// ── TWO QR CODES (owner requirement 2026-11-28): the poster shows an INSTALL code AND a JOIN code ──
function twoQrModal(props, pdf) {
  const { React, draw } = miniReact();
  const Modal = lift([['function InvitePosterModal(', 'InvitePosterModal']], 'InvitePosterModal', {
    React, history: { pushState() {} }, document: { createElement: () => ({}), head: { appendChild() {}, removeChild() {} } },
    window: { addEventListener() {}, removeEventListener() {}, print() {}, Capacitor: { isNativePlatform: () => true, Plugins: {} } },
    churchMarkDataUrl: async () => 'logo', buildInvitePdf: async (a) => { pdf.push(a); return null; },
    copyText: () => true, Icon: () => null, SkQR: () => null, useStewDialog: () => {},
  });
  return draw(Modal, props);
}
const qrBoxes = (tree) => find(tree, (n) => n.props && n.props['data-poster-qr']);
const svgsIn = (node) => find(node, (n) => n.props && n.props.dangerouslySetInnerHTML).map((n) => n.props.dangerouslySetInnerHTML.__html);

test('(e) JoinCard hands the poster BOTH codes: install svg for the install URL, join svg for the join URL', () => {
  const p = openPoster({ url: 'https://grace.example/install', lan: false, why: '' });
  assert.equal(p.svg, '<svg data-for="https://grace.example/install"/>');
  assert.match(p.joinUrl, /follow=npub1grace/);
  assert.equal(p.joinSvg, '<svg data-for="' + p.joinUrl + '"/>', 'the join QR must encode the join link');
});

test('(e) the real modal draws TWO QRs — install then join — each with its own URL printed under it', () => {
  const props = openPoster({ url: '', lan: false, why: 'none' });
  const tree = twoQrModal(props, []);
  const boxes = qrBoxes(tree);
  assert.equal(boxes.length, 2, 'the poster must show two QR codes');
  assert.deepEqual(boxes.map((b) => b.props['data-poster-qr']), ['install', 'join']);
  assert.deepEqual(svgsIn(boxes[0]), ['<svg data-for="' + PUBLIC + '"/>']);
  assert.deepEqual(svgsIn(boxes[1]), ['<svg data-for="' + props.joinUrl + '"/>']);
  const text = JSON.stringify(tree);
  assert.ok(text.includes(PUBLIC) && text.includes(props.joinUrl), 'both URLs must be printed on the poster');
  assert.match(text, /Download the app/); assert.match(text, /Join Grace Chapel/);
});

test('(e) Save PDF hands the PDF builder BOTH codes and both URLs', async () => {
  const props = openPoster({ url: '', lan: false, why: 'none' });
  const pdf = [];
  const tree = twoQrModal(props, pdf);
  const save = find(tree, (n) => n.type === 'button' && n.props.onClick && /pdf/i.test(JSON.stringify(n.kids || n.props.children || '')));
  await save[0].props.onClick();
  assert.equal(pdf.length, 1);
  assert.equal(pdf[0].url, PUBLIC); assert.equal(pdf[0].svg, props.svg);
  assert.equal(pdf[0].joinUrl, props.joinUrl); assert.equal(pdf[0].joinSvg, props.joinSvg);
  assert.ok(pdf[0].joinSvg.includes('follow='));
});


test('(e) the real PDF builder draws BOTH codes (two images) and prints both URLs', async () => {
  const images = [], texts = [];
  class FakeDoc {
    constructor() { this.internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } }; }
    setFont() {} setFontSize() {} setTextColor() {} setDrawColor() {} setFillColor() {} roundedRect() {} line() {}
    splitTextToSize(t) { return [String(t)]; }
    text(t) { texts.push(JSON.stringify(t)); }
    addImage(d) { images.push(d); }
  }
  const build = lift([['async function buildInvitePdf(', 'buildInvitePdf']], 'buildInvitePdf', { window: { jspdf: { jsPDF: FakeDoc } }, svgToPng: async (s) => 'png:' + s });
  const J = 'https://app.trinityone.church/?follow=npub1grace';
  await build({ name: 'Grace Chapel', url: PUBLIC, svg: '<svg a/>', joinUrl: J, joinSvg: '<svg b/>', accent: '#b4462f', logo: null });
  assert.deepEqual(images, ['png:<svg a/>', 'png:<svg b/>']);
  const all = texts.join('\n');
  assert.ok(all.includes(PUBLIC) && all.includes(J), 'both URLs must be printed in the PDF');
  // no join link (church key not ready): install code only
  images.length = 0;
  await build({ name: 'Grace Chapel', url: PUBLIC, svg: '<svg a/>', joinUrl: '', joinSvg: '', accent: '', logo: null });
  assert.deepEqual(images, ['png:<svg a/>']);
});
