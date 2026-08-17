// A BACKSLASH ESCAPE IN JSX TEXT IS NOT AN ESCAPE — IT IS FOUR CHARACTERS ON A MEMBER'S SCREEN.
// Run: node --test scripts/no-literal-escapes-in-jsx.test.mjs
//
// FOUND BY A SIMULATED MEMBER, 2026-08-17. A youth leader opened Serving & events and read:
//
//   "3 events you can’t open yet. Your church’s key hasn’t reached this phone.
//    They’ll appear once it does — nothing is missing."
//
// Four raw escapes in one paragraph, on the banner whose entire job is to reassure someone that nothing has
// been lost. `’` works inside a JavaScript string literal. Between JSX tags it is markup text, and a
// backslash there means a backslash.
//
// It is an easy mistake to make and an impossible one to see in a diff, because the source LOOKS correct —
// which is exactly why it wants a scan rather than care. Type the character.
//
// The scan deliberately ignores escapes inside quoted strings (style objects, aria-labels, JS expressions),
// where they are legitimate and common. It only looks at text that lands between tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const APP = new URL('../app/', import.meta.url).pathname;


// Remove balanced {...} expression segments from a JSX text run, leaving only what is rendered as text.
function stripBraces(run) {
  let out = '', depth = 0;
  for (const c of run) {
    if (c === '{') { depth++; continue; }
    if (c === '}') { if (depth) depth--; continue; }
    if (!depth) out += c;
  }
  return out;
}

// Pull out JSX text children: the runs between a `>` and the next `<`, outside of any quotes.
function jsxTextRuns(src) {
  const runs = [];
  let i = 0, quote = '', inLineComment = false, inBlockComment = false;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; i++; continue; }
    if (inBlockComment) { if (c === '*' && n === '/') { inBlockComment = false; i++; } i++; continue; }
    if (!quote && c === '/' && n === '/') { inLineComment = true; i += 2; continue; }
    if (!quote && c === '/' && n === '*') { inBlockComment = true; i += 2; continue; }
    if (quote) { if (c === '\\') { i += 2; continue; } if (c === quote) quote = ''; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    if (c === '>') {
      const end = src.indexOf('<', i + 1);
      if (end === -1) break;
      const run = src.slice(i + 1, end);
      // STRIP EMBEDDED EXPRESSIONS, do not skip the run. The real defect lived in
      //   <b>{n} event{n === 1 ? '' : 's'} you can’t open yet.</b>
      // — a run that contains braces, and the escape was in the plain text BETWEEN them. Skipping any run
      // with a `{` in it made this scan pass over the one line it was written to catch, and the sabotage
      // check caught that. Inside `{...}` an escape is legitimate; outside it is four characters on screen.
      const plain = stripBraces(run);
      if (plain.trim()) runs.push({ text: plain, at: i + 1 });
      i = end; continue;
    }
    i++;
  }
  return runs;
}

test('no \\uXXXX escapes are typed into JSX text', () => {
  const bad = [];
  for (const f of readdirSync(APP).filter(x => x.endsWith('.jsx'))) {
    const src = readFileSync(join(APP, f), 'utf8');
    for (const { text, at } of jsxTextRuns(src)) {
      // Only \uXXXX. \n and \t produced false positives from regex literals (/\\/g), which this simple
      // scanner does not model — and they are not the defect anyway: a stray \n reads as a typo, while
      // \u2019 mid-sentence looks like deliberate, correct code right up until a member reads it.
      const m = text.match(/\\u[0-9a-fA-F]{4}/);
      if (m) {
        const line = src.slice(0, at).split('\n').length;
        bad.push(`${f}:${line} — ${m[0]} in "${text.trim().slice(0, 60)}"`);
      }
    }
  }
  assert.deepEqual(bad, [],
    'these render as literal backslash-u-two-zero-one-nine on a member’s screen. Type the character ' +
    'instead:\n  ' + bad.join('\n  '));
});
