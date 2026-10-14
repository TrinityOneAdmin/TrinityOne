// THE STEWARD GROUPS LIST IS ONE COMPACT LINE ON THE APK — NO MISLEADING CHAT ICON, A SETTINGS GEAR INSTEAD.
// Run: node --test scripts/the-steward-group-row-is-one-line-on-the-apk.test.mjs
//
// Owner 2026-10-14: on the steward APK the "Groups, teams & rooms" rows were a tall two-line card whose kind
// icon (a green chat bubble) read as a tappable "open chat" button but was only a type indicator — chat is
// reached from the group's settings dialog. The APK row is now ONE line: the chat-looking kind icon is gone,
// a settings gear sits by the NAME (away from the delete button), and the second controls strip is dropped.
// The WEB console is unchanged (it has ~8 inline controls and no settings dialog to fold them into).
//
// Point of use (rule 1), not a text match of the source (rule 3): the REAL ListPanel is sliced from
// app/stew-dashboard.jsx, compiled with the packaged --jsx=transform, and RENDERED. compact=true is what the
// native branch passes; compact=false is the web branch. Each assertion fails if its half of the change is
// reverted: restoring the kind icon in compact makes ICON:chat reappear; deleting the renderInline slot drops
// the gear; un-gating the controls strip makes WEBCHIP appear in compact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

async function loadListPanel(globals) {
  const src = fnBody(STEW, 'function ListPanel(', 'ListPanel') + '\nexport { ListPanel };\n';
  const tmp = join(tmpdir(), 'lp-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__lp_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

async function render(compact) {
  const { React, draw } = miniReact();
  const Icon = (p) => React.createElement('span', {}, 'ICON:' + (p.name || ''));   // surfaces the icon name as text
  const Panel = (p) => React.createElement('div', {}, p.children);                  // pass-through so the rows draw
  const mod = await loadListPanel({ React, Panel, Icon });
  const props = {
    title: 'Groups, teams & rooms', addLabel: 'New group', onAdd() {},
    items: [{ id: 'g1', name: 'Main chat', sub: '1 member', ic: 'chat', fg: 'var(--sage)' }],
    compact,
    renderInline: compact ? () => React.createElement('button', { onClick() {} }, 'GEAR') : undefined,
    renderAside: () => React.createElement('button', {}, 'TRASH'),
    renderRight: () => React.createElement('span', {}, 'WEBCHIP'),
  };
  return texts(draw(mod.ListPanel, props)).join(' ');
}

test('APK (compact): the gear shows, the chat-looking kind icon is gone, the controls strip is hidden', async () => {
  const t = await render(true);
  assert.match(t, /GEAR/, 'the settings gear is not on the compact row — renderInline was dropped');
  assert.doesNotMatch(t, /ICON:chat/, 'the chat-looking kind icon is still drawn on the compact row — it must be removed');
  assert.doesNotMatch(t, /WEBCHIP/, 'the web controls strip is still rendered in compact mode — it must be dropped on the APK');
  assert.match(t, /Main chat/, 're-anchor: the row did not render its name, so the checks above are vacuous');
  assert.match(t, /1 member/, 'the member count must still show on the compact row');
});

test('web (not compact): the kind icon stays, there is no inline gear, the controls strip shows', async () => {
  const t = await render(false);
  assert.match(t, /ICON:chat/, 'the kind icon must still draw on the web row — the web path must be untouched');
  assert.doesNotMatch(t, /GEAR/, 'web passes no renderInline, so no inline gear should appear');
  assert.match(t, /WEBCHIP/, 'the web controls strip must still render');
});
