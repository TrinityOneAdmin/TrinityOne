// AN ICON-ONLY BUTTON MUST ANNOUNCE ITSELF. A 40x40 SQUARE WITH A PICTURE IN IT IS NOT A NAME.
// Run: node --test scripts/every-icon-button-has-a-name.test.mjs
//
// Finding 7 of the 2026-09-05 re-verification audit. `IconBtn` (app/ui.jsx) derives its accessible name
// from `title || ICON_LABELS[name]`, and five icons in daily use had neither — bookmark, compare,
// headphones, shield, sliders. `aria-label={undefined}` renders no attribute at all, so TalkBack announced
// each of them as "button": the bookmark in the book reader, Listen and Compare and Reading settings in the
// Bible reader, and the shield that explains who can see a chat room.
//
// This is not a lint. It RENDERS the real IconBtn for every name the app actually passes it, because
// app/*.jsx ships UNBUNDLED — a `false && ` in front of a branch leaves every word of a label in the file
// and any text-matching assertion still passes (CLAUDE.md rule 3). Only running it answers the question.
//
// It also fails when a SIXTH unlabelled icon appears, which is the point: the five were fixed by hand, and
// hand-fixing does not survive the next screen somebody writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { transformSync } from 'esbuild';

const dir = new URL('../app/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const files = readdirSync(dir).filter(f => f.endsWith('.jsx'));

// Every icon name the app hands to IconBtn, across every screen.
const used = new Set();
for (const f of files) {
  for (const m of read(f).matchAll(/<IconBtn[^>]*?name="([a-zA-Z]+)"/g)) used.add(m[1]);
}
assert.ok(used.size >= 10, `only found ${used.size} IconBtn uses — the scan has drifted, re-anchor it`);

// Render the REAL component.
const JS = transformSync(read('ui.jsx'), { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });
const scope = {
  h, Frag: 'Frag',
  React: { useState: (v) => [v, () => {}], useEffect() {}, useRef: () => ({ current: null }), createElement: h },
  Icon: () => null,   // the glyph is not the name; stubbing it cannot answer what this test asks
  // ui.jsx ends by hanging its components on `window`, as every app/*.jsx does (they are classic scripts
  // sharing globals, not modules). A bare object is enough — nothing here reads back from it.
  window: {},
  document: { addEventListener() {}, removeEventListener() {} },
};
const names = Object.keys(scope);
const { IconBtn } = new Function(...names, JS + '\nreturn { IconBtn };')(...names.map(n => scope[n]));

test('every icon-only button the app renders has an accessible name', () => {
  const unnamed = [];
  for (const name of [...used].sort()) {
    const el = IconBtn({ name, onClick() {} });
    const label = el.props['aria-label'];
    if (typeof label !== 'string' || !label.trim()) unnamed.push(name);
  }
  assert.deepEqual(unnamed, [],
    `these icon buttons render with no accessible name: ${unnamed.join(', ')}. IconBtn takes it from ` +
    "`title` or ICON_LABELS in app/ui.jsx — add an entry there, or pass a title at the call site. A screen " +
    'reader announces an unnamed one as "button", which in a 40x40 row of them is unusable.');
});

test('a name passed at the call site still wins over the map', () => {
  // The escape hatch has to keep working, or the fix above pushes people to widen ICON_LABELS with
  // context-specific labels that are wrong everywhere else.
  const el = IconBtn({ name: 'x', title: 'Dismiss this reminder', onClick() {} });
  assert.equal(el.props['aria-label'], 'Dismiss this reminder');
});

test('an icon with no entry anywhere is caught, not silently unnamed', () => {
  // The guard proving the guard: IconBtn must not invent a name, so a genuinely unknown icon stays
  // detectable by the first test rather than passing with a plausible-looking fallback.
  const el = IconBtn({ name: 'definitelyNotAnIcon', onClick() {} });
  assert.ok(!el.props['aria-label'], 'IconBtn invented a name for an unknown icon, which would hide finding 7');
});
