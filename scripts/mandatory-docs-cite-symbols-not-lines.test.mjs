// THE DOCUMENTS CLAUDE.md MAKES MANDATORY MUST NOT CITE LINE NUMBERS.
// Run: node --test scripts/mandatory-docs-cite-symbols-not-lines.test.mjs
//
// Audit item 16, 2026-09-14. CLAUDE.md rule 10 says to read reference/RELAY-ADMISSION.md before touching
// relay admission, and rule 7 says to read reference/DOMAIN.md before anything user-facing. Between them
// they carried ten `file.js:NNN` citations and EVERY ONE WAS STALE — including the one quoted inside rule 10
// itself, `fellowship.src.js:650`, which by then landed inside safeguarding chat code. Four others pointed
// at bare closing braces.
//
// A stale citation in a document a reader is TOLD to trust is worse than no citation: it sends them to the
// wrong function with the document's authority behind it. This repo has already recorded the cause — one
// +101-line commit invalidated three citations and pointed one inside the WRONG function.
//
// A SYMBOL SURVIVES A REFACTOR, AND FAILS LOUDLY WHEN IT DOES NOT. So: no line numbers, and every symbol
// named must still exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const DOCS = ['CLAUDE.md', 'reference/RELAY-ADMISSION.md', 'reference/DOMAIN.md'];
// ⚠ LONGEST ALTERNATIVE FIRST. `js` before `jsx` matches the `.js` INSIDE `screens-today.jsx` and then
// reports a file that does not exist — a regex bug that reads exactly like a real finding.
const LINE_CITE = /(?:src|app|scripts|relay-app|vendor)\/[A-Za-z0-9._-]+\.(?:src\.)?(?:jsx|mjs|js):\d+/g;

test('no mandatory document cites a line number', () => {
  for (const d of DOCS) {
    const text = readFileSync(ROOT + d, 'utf8');
    // the warning comments in these files quote the old citations on purpose, as the worked example
    const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
    const hits = body.match(LINE_CITE) || [];
    assert.deepEqual(hits, [],
      d + ' cites line numbers: ' + hits.join(', ') + '. Every one of these was stale within a week last ' +
      'time, and a reader is TOLD to trust this file. Name the symbol instead.');
  }
});

test('every FILE a mandatory document names still exists', () => {
  // The cheaper half of the same rot: a document pointing at a file that has been renamed or deleted.
  const FILE_CITE = /(?:src|app|scripts|relay-app)\/[A-Za-z0-9._-]+\.(?:src\.)?(?:jsx|mjs|js)/g;
  for (const d of DOCS) {
    const text = readFileSync(ROOT + d, 'utf8');
    for (const f of new Set(text.match(FILE_CITE) || [])) {
      assert.ok(existsSync(ROOT + f), d + ' points at ' + f + ', which does not exist');
    }
  }
});

test('the symbols rule 10 leans on are really in the code it names', () => {
  // Rule 10 and RELAY-ADMISSION both hang on these three. If one is renamed, the documents that are
  // mandatory reading before touching relay admission go quietly wrong, which is how this item started.
  const NET = readFileSync(ROOT + 'src/relay-net.src.js', 'utf8');
  const FEL = readFileSync(ROOT + 'src/fellowship.src.js', 'utf8');
  const TODAY = readFileSync(ROOT + 'app/screens-today.jsx', 'utf8');
  assert.ok(/function proveRelay\(/.test(NET), 'proveRelay is gone from src/relay-net.src.js');
  assert.ok(/root: 'software'/.test(NET), "the `software` root RELAY-ADMISSION describes is gone");
  assert.ok(/function churchRelayNet\(/.test(FEL),
    'churchRelayNet is gone from src/fellowship.src.js — CLAUDE.md rule 10 names it as the deliberately ' +
    'unfiltered bootstrap read, and a rule naming a function that does not exist is unfollowable');
  assert.ok(/const CARE_SEND_REFUSAL = \{/.test(TODAY), 'CARE_SEND_REFUSAL is gone from app/screens-today.jsx');
});
