// THE BACKGROUND READER'S CURSOR COVERS THE DM-SEEN MARKER (B6, part 1c).
//   Run: node --test scripts/the-push-reader-counts-against-the-dm-seen-marker.test.mjs
//
// Kind-4 DMs advance NEITHER hub cursor, so before this the reader re-counted — and re-posted, and
// re-set the widget to — DMs the foreground app already held, at every 15-minute poll, for ever. The
// cursor is now max(docshub, memhub, dmseen).since: once the app holds the DMs the next poll is a
// genuine zero and the worker clears.
//
// Rule 3 / house pattern (the-push-reader-keeps-the-widget-when-auth-is-refused.test.mjs): the pieces
// are lifted and EXECUTED — and here they are lifted from a REBUILT bg bundle (built to a TEMP path with
// build-bg.mjs's exact release configuration; the shipped assets/directpush/bg-bundle.js is NOT touched),
// so what runs is what esbuild actually ships, dead code folded away.
// Callers of the lifted code (rule 2): readerCursor only __dpStart's cursor assignment; readerVerdict and
// widgetCountAction only __dpStart/finish (unchanged by B6).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { fnBody } from './test-slice.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const fellowship = join(repo, 'src/fellowship.src.js');
let tmp, BUNDLE, readerCursor, readerVerdict, widgetCountAction;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'trin-bgcur-'));
  // build-bg.mjs's RELEASE configuration, byte for byte in what matters, with only the outfile moved
  await build({
    minifySyntax: true,
    define: { DP_DEBUG: 'false' },
    entryPoints: [join(repo, 'plugins/trinity-directpush/js/bg-entry.js')],
    bundle: true, format: 'iife', target: 'es2020', legalComments: 'none',
    outfile: join(tmp, 'bg-bundle.js'),
    nodePaths: [join(repo, 'node_modules')],
    logLevel: 'silent',
    plugins: [{
      name: 'expose-relaysForChurch',
      setup(b) {
        b.onLoad({ filter: /fellowship\.src\.js$/ }, (args) => {
          if (args.path !== fellowship) return null;
          const src = readFileSync(args.path, 'utf8');
          if ((src.match(/\nfunction relaysForChurch\(cp\) \{/g) || []).length !== 1) throw new Error('relaysForChurch anchor not found exactly once');
          return { contents: src + '\n;window.__dpRelaysForChurch = relaysForChurch;\n', loader: 'js', resolveDir: dirname(args.path) };
        });
      },
    }],
  });
  BUNDLE = readFileSync(join(tmp, 'bg-bundle.js'), 'utf8');
  readerCursor = new Function(fnBody(BUNDLE, 'function readerCursor(', 'readerCursor') + '\nreturn readerCursor;')();
  readerVerdict = new Function(fnBody(BUNDLE, 'function readerVerdict(', 'readerVerdict') + '\nreturn readerVerdict;')();
  widgetCountAction = new Function(fnBody(BUNDLE, 'function widgetCountAction(', 'widgetCountAction') + '\nreturn widgetCountAction;')();
});
after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} });

// the counting the reader does with the cursor, byte-pinned below: since = cursor; newer = created_at > since
const countNewer = (evs, cursor) => evs.filter((e) => e.created_at > cursor).length;

test('a kind-4 at time t with dmseen.since >= t is NOT counted: the poll is a genuine zero and the widget clears', () => {
  const t = 1700000000;
  const cursor = readerCursor({ since: 0 }, { since: 0 }, { since: t });
  assert.equal(cursor, t, 'the DM-seen marker must be part of the cursor max');
  const evs = [{ kind: 4, created_at: t }];
  const newer = countNewer(evs, cursor);
  assert.equal(newer, 0);
  const verdict = readerVerdict(evs.length, newer, 'eose', false, false, {});
  assert.equal(verdict, 'genuinely-0-new', 'DMs the app already holds must read as a real zero');
  assert.deepEqual(widgetCountAction(verdict, newer), { op: 'clear' }, 'the worker must clear, not resurrect the count');
});

test('a kind-4 NEWER than the marker IS still counted and still sets the widget', () => {
  const t = 1700000000;
  const cursor = readerCursor({ since: 0 }, { since: 0 }, { since: t - 1 });
  const evs = [{ kind: 4, created_at: t }];
  const newer = countNewer(evs, cursor);
  assert.equal(newer, 1);
  const verdict = readerVerdict(evs.length, newer, 'eose', false, false, {});
  assert.equal(verdict, 'new-events');
  assert.deepEqual(widgetCountAction(verdict, newer), { op: 'set', n: 1 });
});

test('the hub cursors still count exactly as before: the marker only ever RAISES the max, and absence is 0', () => {
  assert.equal(readerCursor({ since: 500 }, { since: 300 }, {}), 500);
  assert.equal(readerCursor({ since: 500 }, { since: 700 }, { since: 100 }), 700);
  assert.equal(readerCursor({}, {}, {}), 0);
  assert.equal(readerCursor(null, undefined, null), 0, 'a missing record must read as 0, never throw');
});

test('POINT OF USE in the rebuilt bundle: __dpStart derives its one cursor from readerCursor over the three records', () => {
  const fn = BUNDLE.slice(BUNDLE.indexOf('window.__dpStart = async function'), BUNDLE.indexOf('function finish('));
  assert.ok(fn.length > 1000, '__dpStart not found in the rebuilt bundle');
  assert.equal((fn.match(/readerCursor\(/g) || []).length, 1, 'exactly one readerCursor call in __dpStart');
  assert.match(fn, /cursor = readerCursor\(docs, mems, dmseen\)/, 'the cursor must consult docs, mems AND dmseen');
  assert.ok(fn.includes('"trinityone.dmseen." + cp') || fn.includes("'trinityone.dmseen.' + cp"), 'the dmseen record is not read per church');
  // release folds DP_DEBUG away: the REQ window is the cursor itself, and newer-than filters on it
  assert.match(fn, /since = cursor/, 'the counting window no longer derives from the cursor');
  assert.match(fn, /created_at > since/, 'the newer-than filter no longer compares against the cursor');
});
