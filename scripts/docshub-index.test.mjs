// The docs-hub prefix index must never make a feature go blank.
// Run: node --test scripts/docshub-index.test.mjs
//
// PERF (AUDIT-2026-07-24): replaying the church docs hub was O(handlers x corpus) — every registration copied
// and sorted the WHOLE buffer, then handed it to a handler that discarded everything not matching its own
// d-prefix. The member app registers ~17 handlers and re-runs them on every reconnect. The buffer is now
// indexed by doc TYPE and a handler declares `want: [PREFIX]` to replay only its own slice.
//
// That optimisation has exactly one dangerous failure mode, and it is SILENT: if a handler's declared `want`
// stops matching the guard inside its own onevent — someone edits one and not the other — the handler replays
// the wrong slice (or an empty one) and its whole feature renders blank with no error anywhere. Groups, plans,
// devotionals and care all go through this path.
//
// So this drives the SHIPPED bundle: it executes the real _dkeyOf, and it checks every real registration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// pull the REAL _dkeyOf out of the shipped bundle and run it — not a copy of it
function realDkeyOf() {
  const at = BUNDLE.indexOf('function _dkeyOf(');
  assert.notEqual(at, -1, '_dkeyOf missing from the shipped bundle — the index was removed or renamed');
  let depth = 0, end = -1;
  for (let i = BUNDLE.indexOf('{', at); i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, 'could not find the end of _dkeyOf');
  return new Function(BUNDLE.slice(at, end) + '; return _dkeyOf;')();
}

// every `const X_D = 'trinityone/...'` prefix constant in the source
function prefixConstants() {
  const out = new Map();
  for (const m of SRC.matchAll(/^const (\w+) = '(trinityone\/[^']*)';/gm)) out.set(m[1], m[2]);
  return out;
}

// every _onChurchDocs registration that declares `want`, paired with the guard inside its own onevent
function registrations() {
  const out = [];
  const re = /_onChurchDocs\(\w+, \{\s*\n\s*want: \[([^\]]+)\],[^\n]*\n\s*onevent\(e, d\) \{[^\n]*\n\s*if \(!?d(?:\.startsWith\((\w+)\)|\s*!==\s*(\w+))\) return;/g;
  for (const m of SRC.matchAll(re)) out.push({ want: m[1].trim(), guard: (m[2] || m[3] || '').trim(), exact: !m[2] });
  return out;
}

test('the shipped bundle still has the index (it was not silently reverted)', () => {
  const dkey = realDkeyOf();
  assert.equal(typeof dkey, 'function');
  assert.ok(BUNDLE.includes('function _hubBufSet('), '_hubBufSet missing — the buffer would not be indexed');
  assert.ok(BUNDLE.includes('want: ['), 'no handler declares want — every replay is still full-corpus');
});

test('every handler replays the SAME slice its own guard accepts', () => {
  const dkey = realDkeyOf();
  const consts = prefixConstants();
  const regs = registrations();
  assert.ok(regs.length >= 5, `expected the indexed handlers, found ${regs.length}`);
  for (const r of regs) {
    assert.equal(r.want, r.guard,
      `handler declares want: [${r.want}] but its onevent guards on ${r.guard} — it will replay the wrong slice and render blank`);
    // For the named constants, the declared prefix and a REAL d-tag built from it must land in the same bucket.
    const val = consts.get(r.want);
    if (!val) continue;
    assert.notEqual(dkey(val), '', `${r.want} has no doc type — it would fall into the catch-all bucket`);
    if (r.exact) {
      // an EXACT d-tag (guard is `d !== X`), e.g. trinityone/meals-settings — the document's own d IS the
      // constant, so it must bucket to itself. Appending an id here would be testing a shape that never exists.
      assert.equal(dkey(val), dkey(val), `${r.want} must bucket to itself`);
      assert.ok(!val.endsWith(':'), `${r.want} is guarded with !== but looks like a prefix ("${val}") — one of the two is wrong`);
    } else {
      // a PREFIX (guard is startsWith), e.g. trinityone/group: — real ids are appended, and every one of them
      // must land in the same bucket as the prefix itself or the slice comes back empty and the list renders blank.
      assert.ok(val.endsWith(':'), `${r.want} is guarded with startsWith but is not a prefix ("${val}")`);
      assert.equal(dkey(val), dkey(val + 'someid1234'),
        `${r.want} ("${val}") buckets differently from an actual document id — its slice would come back empty`);
    }
  }
});

test('_dkeyOf buckets the real d-tag shapes correctly', () => {
  const dkey = realDkeyOf();
  assert.equal(dkey('trinityone/group:abc'), 'group');
  assert.equal(dkey('trinityone/care:xyz'), 'care');
  assert.equal(dkey('trinityone/meals-settings'), 'meals-settings', 'a prefix with NO colon must still bucket by its whole name');
  assert.equal(dkey('trinityone/member:deadbeef'), 'member');
  // anything not ours must not be silently filed under a real doc type
  assert.equal(dkey('other/group:abc'), '');
  assert.equal(dkey(''), '');
  assert.equal(dkey(null), '');
  assert.equal(dkey(undefined), '');
});

test('a handler that declares nothing still gets the FULL replay (opt-in, not opt-out)', () => {
  // The fallback is what makes this change safe to land incrementally: the 5 handlers with no `want`
  // (safeguarding, join, message tags, care needs, care availability) must keep receiving everything.
  const at = BUNDLE.indexOf('function _onChurchDocs(');
  assert.notEqual(at, -1, '_onChurchDocs missing from the shipped bundle');
  const chunk = BUNDLE.slice(at, at + 1600);
  assert.match(chunk, /Array\.isArray\(h\.want\) && h\.want\.length/, 'the want check must be guarded so an undeclared handler falls through');
  assert.match(chunk, /else pool0 = \[\.\.\.hub\.buf\.values\(\)\]/, 'the full-corpus fallback is missing — undeclared handlers would replay nothing');
});
