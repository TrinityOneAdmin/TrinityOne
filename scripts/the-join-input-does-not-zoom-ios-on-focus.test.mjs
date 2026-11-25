// THE CHURCH-JOIN INPUT IS >= 16px, so iOS WKWebView does not auto-zoom the whole app on focus.
//   Run: node --test scripts/the-join-input-does-not-zoom-ios-on-focus.test.mjs
//
// WHY (2026-11-25): on a real iPhone, opening Community -> "join a church" zoomed the entire app in. iOS
// zooms a WKWebView when a focused text field's font is < 16px, and the join input (SchJoin in
// app/screens-church.jsx) carries `autoFocus`, so it zooms the MOMENT the join screen opens — and the zoom
// sticks until the app is relaunched. The field (and the camera-fallback paste textarea) were 14px / 13px.
// Pinned to 16px. This had regressed before (the networks client-engine change), hence this guard.
//
// POINT OF USE: the shipped source the member app renders. It reads app/screens-church.jsx and asserts the
// autofocusing join input's fontSize is >= 16. If anyone drops it below 16 again, this goes red. (iOS text
// inflation itself is not reproducible headlessly — the device confirms the behaviour; this guards the value.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/screens-church.jsx', import.meta.url), 'utf8');

test('the church-join input (autoFocus) is >= 16px so iOS does not zoom on focus', () => {
  const m = src.match(/aria-label="Church name, code, or invite link"[\s\S]{0,500}?fontSize:\s*(\d+(?:\.\d+)?)/);
  assert.ok(m, 'could not find the join input and its fontSize in screens-church.jsx — re-anchor this test');
  const fs = parseFloat(m[1]);
  assert.ok(fs >= 16, `the join input font is ${fs}px — iOS auto-zooms a focused input < 16px, and this one autoFocuses on screen open; keep it >= 16`);
});

test('the camera-fallback paste textarea is also >= 16px', () => {
  // the textarea shown when the camera cannot scan — same iOS zoom trap
  const m = src.match(/<textarea[\s\S]{0,400}?fontSize:\s*(\d+(?:\.\d+)?)[\s\S]{0,120}?var\(--mono\)/);
  assert.ok(m, 'could not find the paste textarea + its fontSize — re-anchor this test');
  assert.ok(parseFloat(m[1]) >= 16, `the paste textarea font is ${m[1]}px — keep it >= 16 to avoid iOS focus-zoom`);
});
