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
