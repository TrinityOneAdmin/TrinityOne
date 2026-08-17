// A RENDER CRASH MUST NOT LEAVE A WHITE SCREEN.
// Run: node --test scripts/render-crash-boundary.test.mjs
//
// Neither app had an error boundary. React's rule is that an error thrown during render unmounts the WHOLE
// tree, so any one component throwing left `#root` with zero children: no message, no way back, nothing
// written down. This project's own notes call that its worst failure class, and it has shipped several — a
// duplicate top-level `const` blanking the APK, a regex cleanup crossing a method boundary, a swallowed
// ReferenceError inside a nostr-tools handler.
//
// Measured 2026-08-17: the steward console blanked itself twice in five minutes on the RELEASED build with a
// React `insertBefore` reconciliation error. ~30 attempts failed to reproduce it, so the race is NOT isolated
// and the boundary does not claim to fix it. It makes it survivable and diagnosable, which is the difference
// between a steward thinking the app is dead and a steward back at work in five seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const BOUNDARY = readFileSync(new URL('../app/error-boundary.jsx', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('../steward.html', import.meta.url), 'utf8');

test('a thrown error switches the boundary into its fallback', () => {
  const fn = new Function(fnBody(BOUNDARY, 'static getDerivedStateFromError(err)').replace(/^static /, 'function ') + '; return getDerivedStateFromError;')();
  const err = new Error('boom');
  assert.deepEqual(fn(err), { err }, 'the error must be kept, not swallowed into a boolean');
  assert.ok(fn(null).err, 'even a falsy throw must still show the fallback — React can hand us anything');
});

test('the crash is written down, bounded, and never sent anywhere', () => {
  const store = {};
  const localStorage = { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] || null };
  const logged = [];
  const fn = new Function('localStorage', 'location', 'console', 'Date',
    fnBody(BOUNDARY, 'componentDidCatch(err, info)').replace(/^componentDidCatch/, 'function componentDidCatch') + '; return componentDidCatch;')(
    localStorage, { pathname: '/steward.html' }, { error: (...a) => logged.push(a) }, Date);

  fn(new Error('insertBefore failed'), { componentStack: 'x'.repeat(9000) });
  const rec = JSON.parse(store['trinityone.lastcrash']);
  assert.match(rec.message, /insertBefore failed/, 'the next session should be able to read what happened');
  assert.equal(rec.where, '/steward.html', 'and which app it was');
  assert.ok(rec.components.length <= 2000, 'bounded — a crash loop must not fill a member’s storage');
  assert.ok(logged.length, 'and it should still reach the console for anyone watching live');

  // Only ONE record, overwritten — not a growing pile.
  fn(new Error('second'), { componentStack: '' });
  assert.match(JSON.parse(store['trinityone.lastcrash']).message, /second/);
  assert.equal(Object.keys(store).length, 1, 'one key, overwritten');
});

test('the fallback tells the member the true thing', () => {
  const render = stripComments(fnBody(BOUNDARY, 'render()'));
  assert.match(render, /Nothing has been lost/,
    'a render crash touches neither the key, the notes, nor the relay — saying so is what stops someone ' +
    'doing something irreversible out of panic');
  assert.match(render, /location\.reload\(\)/, 'and there must be a way back');
  assert.doesNotMatch(render, /<Icon|useStewDialog|ctx\./,
    'the fallback renders when the app is already broken — it must not depend on anything that could be what threw');
});

test('both apps are actually wrapped, and both shells load it', () => {
  for (const [name, src, comp] of [['app.jsx', APP, 'App'], ['steward-root.jsx', STEWARD, 'StewardRoot']]) {
    const t = stripComments(src);
    assert.match(t, new RegExp('<TrinityErrorBoundary><' + comp + ' /></TrinityErrorBoundary>'),
      name + ' mounts its root unprotected — one throw anywhere and the whole app is a white screen');
  }
  for (const [name, html] of [['index.html', INDEX], ['steward.html', SHELL]]) {
    const at = html.indexOf('app/error-boundary.jsx');
    assert.notEqual(at, -1, name + ' does not load the boundary at all');
    assert.ok(at < html.indexOf(name === 'index.html' ? 'app/app.jsx' : 'app/steward-root.jsx'),
      name + ' loads the boundary AFTER the root that uses it — these are classic scripts, so order is real');
  }
});
