// A TICK IS A CLAIM, AND IT WAS DRAWN OVER FAILURES.
// Run: node --test scripts/a-tick-means-success.test.mjs
//
// AUDIT 2026-09-02 #12. Every toast in the member app drew a green check — so "Couldn't send your answer",
// "Couldn't copy — write the words down instead" and "you're still a member there" all arrived under a
// SUCCESS mark. The icon is the first thing read, and it was contradicting the sentence beside it. Worse,
// a 20-30 word explanation of what went wrong then vanished in 1.9 seconds.
//
// `msg` still takes a plain string — that is what every existing caller passes, and they keep the tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody, stripComments } from './test-slice.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

function render(msg) {
  const { React, draw } = miniReact();
  const g = { React, Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
              window: { addEventListener() {}, removeEventListener() {} },
              document: { addEventListener() {}, removeEventListener() {} } };
  const { Toast } = loadScreen('app/ui.jsx', ['Toast'], g);
  const tree = draw(Toast, { msg });
  return {
    icons: find(tree, n => n.type === 'i' && n.props['data-icon']).map(n => n.props['data-icon']),
    words: texts(tree).join(' '),
    role: (find(tree, n => n.props && n.props.role)[0] || { props: {} }).props.role,
  };
}

test('CONTROL: an ordinary string toast still shows a tick', () => {
  const r = render('Saved');
  assert.ok(r.icons.includes('check'), 'the ordinary success toast lost its tick — every caller passes a string');
  assert.match(r.words, /Saved/);
});

test('A FAILURE IS NOT DRAWN WITH A TICK', () => {
  const r = render({ text: 'Couldn’t send your answer — you’re still shown as not having replied.', kind: 'error' });
  assert.equal(r.icons.includes('check'), false,
    'a failure toast still draws a success tick. The icon is read before the sentence, and it says the ' +
    'opposite of it');
  assert.ok(r.icons.length, 'the failure has no icon at all — it should be marked, not stripped');
  assert.match(r.words, /Couldn’t send/);
  assert.equal(r.role, 'alert', 'a failure is announced as a status, so a screen reader gives it no priority');
});

test('a failure stays on screen long enough to read', () => {
  const body = stripComments(fnBody(APP, 'const toast = (msg, opts) => {', 'toast'));
  assert.match(body, /kind: 'error'/, 'app.jsx\'s toast() cannot mark a failure at all');
  const times = [...body.matchAll(/(\d{3,5})/g)].map(m => Number(m[1]));
  assert.ok(times.some(t => t >= 4000),
    'a failure toast still disappears in under 4 seconds. These sentences run to 20-30 words — "you\'re ' +
    'still a member there", "write the words down instead" — and nobody reads that in 1.9s');
  assert.ok(times.includes(1900), 'the ordinary success dwell time changed; only failures needed longer');
});

test('the failure toasts this branch added are all marked as failures', () => {
  // The plan's own audit question. Every "Couldn't …" toast introduced by batches 7, 14 and 15 must carry
  // the flag, or it arrives under a tick like the ones this batch exists to fix.
  const files = ['app/app.jsx', 'app/identity.jsx', 'app/identity-extras.jsx', 'app/screens-today.jsx'];
  const unmarked = [];
  for (const f of files) {
    const src = stripComments(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
    // Look at a WINDOW after the call rather than trying to balance parentheses: a toast whose text is a
    // concatenation ("'Couldn't load: ' + e.message") has a ")" in the middle, so a lazy [^)]* match stops
    // before the options object and reports a marked call as unmarked. Cost one false failure to find.
    for (const m of src.matchAll(/toast\(\s*'(Couldn’t[^']*)'/g)) {
      const window = src.slice(m.index, m.index + 220);
      const end = window.indexOf(';');
      if (!/error:\s*true/.test(end > 0 ? window.slice(0, end) : window)) unmarked.push(f + ': ' + m[1].slice(0, 46));
    }
  }
  assert.deepEqual(unmarked, [],
    'these failure toasts are still drawn with a success tick:\n  ' + unmarked.join('\n  '));
});
