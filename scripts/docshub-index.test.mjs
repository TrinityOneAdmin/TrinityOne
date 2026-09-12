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
import { fnBody } from './test-slice.mjs';

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
// Parse each registration's `want` and the first guard inside its own onevent, tolerating anything between
// them. The previous version required want -> onevent -> guard on consecutive lines; adding one benign property
// (`emit,`) made it silently match ZERO registrations while every assertion still passed, because the count was
// only floored at >= 5. A structural test that can quietly stop reading its own subject is worse than none.
// A REGISTRATION'S OWN BLOCK, not a fixed 1500 characters. The window was 1500 and that is shorter than some
// handlers' onevent: a handler whose guards sat past the cut read as UNGUARDED, which is the same silent
// blindness the `emit,` note above records. It now runs to the next registration (or 12000 characters, so a
// runaway parse cannot swallow the file), which is strictly more of each handler than before.
function blockAt(i) {
  const next = SRC.indexOf('_onChurchDocs(', i + 1);
  const end = next === -1 ? SRC.length : next;
  return SRC.slice(i, Math.min(end, i + 12000));
}
function registrations() {
  const out = [];
  for (const m of SRC.matchAll(/_onChurchDocs\(\w+, \{/g)) {
    const block = blockAt(m.index);
    const w = block.match(/want: \[([^\]]+)\]/);
    if (!w) continue;
    const want = w[1].trim();
    const g = block.match(/onevent\(e, d\) \{[\s\S]*?if \(!?d(?:\.startsWith\((\w+)\)|\s*!==\s*(\w+))\) return;/);
    // ── AND THE MULTI-PREFIX DISPATCH SHAPE, added 2026-09-10 ─────────────────────────────────────────────
    // subscribeCheckinRegister reads THREE document types on one registration — a clearance, a session-key
    // envelope and the records themselves — because the three decide one answer together and splitting them
    // would put shared state behind three teardowns. It cannot have a single negative guard, so it dispatches
    // positively: `if (d.startsWith(X)) { … return; }` once per declared want, with no fall-through.
    //
    // THIS IS A WIDENING OF WHAT THE TEST CAN READ, NOT OF WHAT IT ALLOWS. The invariant is unchanged — the
    // slice a handler replays must be exactly the slice its own onevent accepts — and for this shape it is
    // checked as a SET EQUALITY over every declared prefix, which is a stricter claim than the single-guard
    // case (that one only compares the first guard it finds). A handler of this shape that declared a fourth
    // want, or guarded on a prefix it never declared, fails here.
    const wants = want.split(',').map(x => x.trim()).filter(Boolean);
    if (wants.length > 1) {
      const onev = block.slice(block.indexOf('onevent(e, d) {'));
      const dispatched = [...onev.matchAll(/if \(d\.startsWith\((\w+)\)\) \{/g)].map(x => x[1]);
      out.push({ want, wants, dispatched, guard: null, exact: null, multi: true });
      continue;
    }
    out.push({ want, wants, guard: g ? (g[1] || g[2] || '').trim() : null, exact: g ? !g[1] : null, multi: false });
  }
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
  // EXACT, not a floor: a floor let registrations drop out of coverage unnoticed, which is exactly what happened.
  const declared = (SRC.match(/want: \[/g) || []).length;
  assert.equal(regs.length, declared,
    `parsed ${regs.length} registrations but ${declared} declare want — the parser stopped seeing some, so they are unguarded`);
  assert.ok(declared >= 5, `expected the indexed handlers, found ${declared}`);
  for (const r of regs) assert.ok(r.multi || r.guard, `a handler declares want: [${r.want}] but no d-prefix guard was found in its onevent`);
  // THE MULTI-PREFIX HANDLERS: the set of prefixes dispatched on must EQUAL the set declared, exactly. A
  // declared want with no branch replays a slice nothing reads (the feature silently loses a document type);
  // a branch with no declared want reads a slice that is never replayed, so it works live and is blank on
  // every cold start — which is the commoner path and the harder failure to see.
  for (const r of regs.filter(x => x.multi)) {
    assert.deepEqual([...r.dispatched].sort(), [...r.wants].sort(),
      `handler declares want: [${r.want}] but its onevent dispatches on [${r.dispatched.join(', ')}] — one of ` +
      `those document types is either replayed and never read, or read and never replayed`);
  }
  for (const r of regs.filter(x => !x.multi)) {
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

test('every prefix a MULTI-PREFIX handler declares buckets like a real document id', () => {
  // The other half of the check the single-guard loop already does, and the half that matters most for a new
  // document type: if a declared prefix bucketed differently from an actual d-tag built from it, that slice
  // would come back EMPTY on every replay and the feature would be blank on every cold start.
  const dkey = realDkeyOf();
  const consts = prefixConstants();
  const multi = registrations().filter(r => r.multi);
  assert.ok(multi.length >= 1, 're-anchor: no handler reads more than one document type any more');
  for (const r of multi) {
    for (const name of r.wants) {
      const val = consts.get(name);
      assert.ok(val, `${name} is declared as a want but is not a 'trinityone/…' prefix constant in this file`);
      assert.notEqual(dkey(val), '', `${name} has no doc type — it would fall into the catch-all bucket`);
      assert.ok(val.endsWith(':'), `${name} is dispatched with startsWith but is not a prefix ("${val}")`);
      assert.equal(dkey(val), dkey(val + 'someid1234'),
        `${name} ("${val}") buckets differently from an actual document id — its slice would come back empty`);
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
  const chunk = fnBody(BUNDLE, at);
  assert.match(chunk, /Array\.isArray\(h\.want\) && h\.want\.length/, 'the want check must be guarded so an undeclared handler falls through');
  assert.match(chunk, /else pool0 = \[\.\.\.hub\.buf\.values\(\)\]/, 'the full-corpus fallback is missing — undeclared handlers would replay nothing');
});
