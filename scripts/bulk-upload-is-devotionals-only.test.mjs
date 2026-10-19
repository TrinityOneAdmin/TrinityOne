// BULK UPLOAD IS OFFERED FOR DEVOTIONALS ONLY — READING PLANS GO THROUGH "NEW PLAN → UPLOAD FILE".
// Run: node --test scripts/bulk-upload-is-devotionals-only.test.mjs
//
// Owner decision 2026-10-19: reading plans no longer have a bulk-upload button; each plan is uploaded one
// file at a time via New plan → Upload file (with the contributor Template). Devotionals keep bulk upload.
//
// This mounts the REAL DashResources the way the phone mounts it (console-screens.mjs compiles every console
// script into one scope) and reads the rendered tree — it does NOT match text in a .jsx file (CLAUDE.md §3).
// It fails if the gate is widened back to show Bulk upload on the reading-plans view, and it fails if the
// devotionals view loses its Bulk upload button — so it pins the decision from both sides.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const buttonWith = (tree, label) => nodes(tree).find(n => n.type === 'button' && texts(n).join(' ').includes(label));

function resources() {
  const { React, reset, flush, unmount } = fakeReact();
  const Steward = fakeSteward({ churchPub: 'cp' });
  const { window } = fakeBrowser({ Steward });
  const { DashResources } = loadConsole({ React, window, expr: '{ DashResources }' });
  let tree;
  // DashResources renders the segment + the conditional Bulk upload button itself; the view bodies
  // (<DashPlans/> / <DashDevotionals/>) are left as un-expanded element nodes, so nothing heavy runs.
  const draw = () => { reset(); tree = DashResources({}); flush(); return tree; };
  draw();
  return { draw, get tree() { return tree; }, unmount };
}

test('the reading-plans view (the default) offers NO Bulk upload button', () => {
  const r = resources();
  // sanity: the segment really is there and we are on the plans view
  assert.ok(buttonWith(r.tree, 'Reading plans'), 're-anchor: no "Reading plans" segment button');
  assert.ok(buttonWith(r.tree, 'Devotionals'), 're-anchor: no "Devotionals" segment button');
  assert.ok(!buttonWith(r.tree, 'Bulk upload'),
    'THE DEFECT: Bulk upload is offered on the reading-plans view — plans now upload one file at a time via New plan → Upload file');
  r.unmount();
});

test('switching to the devotionals view DOES offer Bulk upload', () => {
  const r = resources();
  const devView = buttonWith(r.tree, 'Devotionals');
  assert.ok(devView, 're-anchor: no "Devotionals" segment button');
  devView.props.onClick();   // setView('devotionals')
  r.draw();
  assert.ok(buttonWith(r.tree, 'Bulk upload'),
    'the devotionals view lost its Bulk upload button — the gate was narrowed too far');
  r.unmount();
});
