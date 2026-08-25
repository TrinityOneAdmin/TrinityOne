// A PASTED ORDER OF SERVICE MUST STILL LOOK LIKE ONE. Miriam had a service sheet and nowhere to put it — no
// composer in the app accepts a document — so she pasted it into a notice. Every line break was stripped and
// the congregation received one run-on paragraph: hymn numbers, readings and prayers welded into a wall.
//
// Run: node --test scripts/text-keeps-its-shape.test.mjs
//
// She typed the newlines. They survived the relay (the event content is the string she wrote). They were lost
// at the last step, in CSS, because the bubble that renders a message never asked to keep them — HTML collapses
// whitespace by default, so a paragraph of plain text arrives shapeless unless something says otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const CHAT = stripComments(readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8'));

// EVERY renderer of a message body, not the first one found. Bubble alone has TWO {m.text} branches — an
// ordinary message and a broadcast — and a first draft of this test read `indexOf('{m.text}')`, fixed the
// ordinary one, passed, and left ANNOUNCEMENTS (the exact surface that was reported) still collapsing. That
// is the recurring shape here: fix the caller you found, ship the sibling you didn't.
const BODY_RENDERERS = /<p style=\{\{[^\n]*\}\}>\{(?:m\.text|m\.content|c\.note|p\.note)\}<\/p>/g;

test('C6 — every message body keeps the line breaks its author typed', () => {
  const all = CHAT.match(BODY_RENDERERS) || [];
  assert.ok(all.length >= 5, `expected the known message-body renderers, found ${all.length} — re-anchor`);
  const collapsing = all.filter(el => !/whiteSpace: 'pre-wrap'/.test(el));
  assert.deepEqual(collapsing, [],
    `${collapsing.length} renderer(s) still collapse whitespace, so a pasted order of service arrives as one ` +
    'run-on paragraph');
});

test('C6 — the private-message sibling is covered by name', () => {
  // The SAME defect, in a sibling nobody filed: DMThread renders {m.content} with the same style minus the
  // same property. Fixing only the one that was reported is how half a defect ships.
  const dm = fnBody(CHAT, 'function DMThread');
  const i = dm.indexOf('{m.content}');
  assert.ok(i > 0, 'the DM thread no longer renders m.content — re-anchor this test');
  const el = dm.slice(dm.lastIndexOf('<p ', i), i);
  assert.match(el, /whiteSpace: 'pre-wrap'/, 'a private message still arrives with its line breaks collapsed');
});


// ── the CONSOLE has its own message bubbles, and they were missed twice ────────────────────────────
// This was confirmed during round 4's verification pass and then not fixed — it was not among the three
// chosen, and that was not said out loud. The very next round, a vicar setting up a church for the first
// time posted her opening notice and read it back as one run-on paragraph. A notice sheet is MADE of
// separate lines; it was the first thing she complained about.
const STEWD = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('C6 — the console keeps line breaks too, in both its message bubbles', () => {
  const bubbles = STEWD.split('\n').filter(l => l.includes('title="Tap to react"'));
  assert.equal(bubbles.length, 2, `expected the group-chat and private-message bubbles, found ${bubbles.length}`);
  const collapsing = bubbles.filter(l => !/whiteSpace: 'pre-wrap'/.test(l));
  assert.deepEqual(collapsing.map(l => l.trim().slice(0, 60)), [],
    'a console message bubble still collapses what the steward typed');
});
