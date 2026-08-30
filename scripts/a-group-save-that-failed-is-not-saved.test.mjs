// "THE CHANGE IS SAVED" MUST NOT APPEAR OVER A CHANGE THAT WAS NOT SAVED.
// Run: node --test scripts/a-group-save-that-failed-is-not-saved.test.mjs
//
// AUDIT 2026-08-30. `GroupLeadersModal.save` in app/stew-dashboard.jsx awaited `window.Steward.publishGroup`
// and threw the result away. That result is the ONLY thing that knows whether anything saved, and it is null
// three ways:
//
//   · no signing key — `publishGroup` returns Promise.resolve(null) on its first line;
//   · every relay refused the write;
//   · a PARTIAL write. `_publishToRelays` returns `accepted === targets.length ? evt : false`, deliberately:
//     a group rule that reached one relay of three is enforced on one of three, and the member app fans its
//     messages to all of them.
//
// With no signing key `sendDM` returns null on the same condition, so both fail together and the modal
// rendered, verbatim: "The change is saved, but we couldn’t message Ronald…". It was not saved. And when the
// publish failed while the DMs went through, the modal simply CLOSED, with no error anywhere — the steward
// watched the leaders they had just promoted be congratulated on a job the relay never gave them.
//
// This lives in the commit whose subject was "a control that failed no longer says it worked".
//
// A second defect in the same handler: `before` was read from the stale `group` PROP, which never changes,
// while the modal deliberately stays open after a partial success. So a second Save recomputed "newly added"
// from the leaders the group had when the modal opened and messaged everybody a second time.
//
// CLAUDE.md rule 3: app/*.jsx ships UNBUNDLED, so a text match on the source would survive `false && ` in
// front of any of this. The modal is COMPILED AND RENDERED and every assertion reads the resulting tree or
// the calls the modal made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

// Compile ONE component out of the console with the real esbuild, the same binary scripts/sync-web.sh uses.
async function loadComponent(name, anchor, globals) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'grpsave-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__grpsave_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}

const RONALD = { pubkey: 'ronaldpk', name: 'Ronald', npub: 'npub1ronald' };
const MAUD = { pubkey: 'maudpk', name: 'Maud', npub: 'npub1maud' };

// `publish` decides what publishGroup returns for each press; `dm` the same for sendDM.
async function modal({ publish, dm }) {
  const { React, draw } = miniReact();
  const closed = [], published = [], dms = [];
  let press = 0;
  const Comp = await loadComponent('GroupLeadersModal', 'function GroupLeadersModal({ group, onClose }) {', {
    React,
    window: {
      useStewardMembers: () => [RONALD, MAUD],
      Steward: {
        publishGroup: async (g) => { published.push(g); return typeof publish === 'function' ? publish(press) : publish; },
        sendDM: async (pk, body) => { dms.push({ pk, body, press }); return typeof dm === 'function' ? dm(press) : dm; },
      },
    },
    Icon: () => null,
    SkBadge: () => null,
    useStewDialog: () => ({ current: null }),
  });
  const props = { group: { id: 'g1', name: 'Youth', leaders: [] }, onClose: () => closed.push(1) };
  const render = () => draw(Comp, props);
  render();
  const tickAll = async () => { for (let i = 0; i < 6; i++) await tick(); };
  return {
    draw: render,
    closed, published, dms,
    tick: (pk) => {
      const row = find(render(), n => n.type === 'button' && texts(n).join(' ').includes(pk.name));
      assert.equal(row.length, 1, `the member row for ${pk.name} is gone from the leaders modal — re-anchor this test`);
      row[0].props.onClick();
    },
    save: async () => {
      const btn = find(render(), n => n.type === 'button' && String(n.props.className || '').includes('sk-btn--clay'));
      assert.equal(btn.length, 1, 'the Save button is gone — re-anchor this test');
      await btn[0].props.onClick();
      press++;
      await tickAll();
      return render();
    },
  };
}

// every notice the modal is showing, read out of the tree
const alerts = (tree) => find(tree, n => n.props && n.props.role === 'alert').map(n => texts(n).join(' '));

const OK_GROUP = { id: 'g1', name: 'Youth' };
const SENT = { id: 'dm1' };

test('CONTROL: promoting a leader publishes the group, messages them, and closes', async () => {
  // If this fails, every assertion below is meaningless.
  const m = await modal({ publish: OK_GROUP, dm: SENT });
  m.tick(RONALD);
  await m.save();
  assert.equal(m.published.length, 1, 'the leadership change no longer publishes at all');
  assert.deepEqual(m.published[0].leaders, [RONALD.pubkey]);
  assert.deepEqual(m.dms.map(d => d.pk), [RONALD.pubkey]);
  assert.equal(m.closed.length, 1, 'a fully successful save no longer closes the modal');
});

test('THE LIE: with no signing key the modal must not say the change is saved', async () => {
  // publishGroup and sendDM both return null on this one condition — `if (!sk) return Promise.resolve(null)`
  // — which is precisely the state the auditor's probe was in when the modal rendered "The change is saved,
  // but we couldn’t message Ronald…".
  const m = await modal({ publish: null, dm: null });
  m.tick(RONALD);
  const after = await m.save();
  const shown = alerts(after).join(' | ');
  assert.match(shown, /\S/, 'nothing at all is on the screen after a save that saved nothing');
  assert.doesNotMatch(shown, /is saved/,
    'the modal told the steward the leadership change was saved. publishGroup returned null — no signing ' +
    'key, every relay refusing, or a partial write — so it is saved nowhere: ' + JSON.stringify(shown));
  assert.equal(m.closed.length, 0, 'the modal closed over a change that did not save');
});

test('THE SILENCE: a failed publish with working DMs must not close without a word', async () => {
  const m = await modal({ publish: null, dm: SENT });
  m.tick(RONALD);
  const after = await m.save();
  assert.equal(m.closed.length, 0,
    'the publish failed and the DMs succeeded, so the modal closed with no error of any kind — the steward ' +
    'believes the leaders are set, and the leaders have been told they are');
  assert.match(alerts(after).join(' | '), /\S/, 'no notice was rendered on this screen at all');
});

test('…and nobody is congratulated on a job the relay never gave them', async () => {
  const m = await modal({ publish: null, dm: SENT });
  m.tick(RONALD);
  await m.save();
  assert.deepEqual(m.dms, [],
    'the leadership change did not save, and the new leader was messaged anyway — they will go and post an ' +
    'event the relay refuses, with nothing to tell them why');
});

test('a partial write across relays is a failure, not a success', async () => {
  // _publishToRelays returns `accepted === targets.length ? evt : false`, and publishGroup maps a falsy
  // result to null. A rule that reached one relay of three is enforced on one of three while every member's
  // app fans its messages to all of them.
  const m = await modal({ publish: null, dm: SENT });
  m.tick(RONALD);
  const after = await m.save();
  assert.doesNotMatch(alerts(after).join(' | '), /is saved/);
  assert.equal(m.closed.length, 0);
});

test('the "we couldn’t message them" banner still works when the change DID save', async () => {
  // The honest half of the previous commit, which must survive this one.
  const m = await modal({ publish: OK_GROUP, dm: null });
  m.tick(RONALD);
  const after = await m.save();
  const shown = alerts(after).join(' | ');
  assert.match(shown, /is saved/, 'a saved change is now reported as a failure');
  assert.match(shown, /Ronald/, 'the leader who was not told is no longer named');
  assert.equal(m.closed.length, 0, 'the modal closed over a leader who was never told');
});

test('a second Save does not congratulate the same leader twice', async () => {
  // The modal deliberately stays open after "we couldn’t message them", and `before` came from the `group`
  // prop, which never moves. Ronald was told on press 1; Maud is added on press 2.
  const m = await modal({ publish: OK_GROUP, dm: (p) => (p === 0 ? null : SENT) });
  m.tick(RONALD);
  await m.save();                       // saves; Ronald could not be messaged
  m.tick(MAUD);
  await m.save();                       // saves again; this time the DMs work
  const second = m.dms.filter(d => d.press === 1).map(d => d.pk);
  assert.ok(second.includes(MAUD.pubkey), 'the newly added leader was never told at all');
  assert.deepEqual(second, [MAUD.pubkey],
    'the second Save re-messaged a leader who was already promoted on the first: ' + JSON.stringify(second));
});

test('…and a leader who was successfully told is never told again', async () => {
  const m = await modal({ publish: OK_GROUP, dm: (p) => (p === 0 ? SENT : null) });
  m.tick(RONALD);
  m.tick(MAUD);
  await m.save();                       // both told, modal closes
  assert.equal(m.dms.length, 2);
  // the steward reopens the same modal object and presses Save again with no change
  await m.save();
  assert.deepEqual(m.dms.filter(d => d.press === 1), [],
    'pressing Save with nothing changed messaged the existing leaders all over again');
});

test('a save that failed can be retried, and the retry saves', async () => {
  const m = await modal({ publish: (p) => (p === 0 ? null : OK_GROUP), dm: SENT });
  m.tick(RONALD);
  const first = await m.save();
  assert.match(alerts(first).join(' | '), /\S/);
  const second = await m.save();
  assert.equal(m.published.length, 2, 'the retry never reached the relay');
  assert.deepEqual(m.dms.map(d => d.pk), [RONALD.pubkey], 'the retry did not tell the new leader');
  assert.deepEqual(alerts(second), [], 'the failure notice is still on screen after a save that worked');
  assert.equal(m.closed.length, 1, 'a successful retry never closes the modal');
});
