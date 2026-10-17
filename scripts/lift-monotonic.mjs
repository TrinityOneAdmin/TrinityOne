// A fresh, REAL _monotonicF lifted from the shipped vendor/fellowship.js — for tests that LIFT a care/other
// writer which now wraps its event in _monotonicF (the same-second stamp). Each call gets its own per-d-tag
// stamp map, so lifts don't share state. Never a stub: the real stamp is what the writers run in the app.
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

export function liftMonotonicF() {
  const lastStamp = new Map();
  const body = fnBody(SHIP, 'function _monotonicF(tmpl)', '_monotonicF');
  return new Function('_lastStampF', 'Math', 'Date',
    'return (' + body.replace(/^function _monotonicF/, 'function') + ');')(lastStamp, Math, Date);
}
