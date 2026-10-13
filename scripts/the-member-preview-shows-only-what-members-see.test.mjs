// THE CONSOLE'S "MEMBER PREVIEW" SHOWS ONLY THE PASSAGES A MEMBER CAN SEE RIGHT NOW.
// Run: node --test scripts/the-member-preview-shows-only-what-members-see.test.mjs
//
// Device finding 2026-10-12: the preview showed an unscheduled passage (Ezra 4:1-4). The preview split
// `vp.ref`, which holds EVERY passage ever added to the prompt (scheduled-for-later ones and older unscheduled
// ones included), while the member's Today card shows only schedule entries whose time has come (or the bare
// ref when there is no schedule at all).
//
// POINT OF USE (rules 1, 3): the REAL DashVersePrompt (it holds dvpLiveRefs) is sliced out of app/stew-dashboard.jsx
// by brace-match, compiled with esbuild, and drawn through the miniature React; the prompt arrives through the
// component's own subscribeVersePrompt effect, and the preview is read OFF THE TREE.
//
// Callers of the shared code (rule 2): dvpLiveRefs is new and local to DashVersePrompt; its one caller is pvRefs there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

const body = fnBody(SRC, 'function DashVersePrompt(', 'DashVersePrompt');
const tmp = join(tmpdir(), 'vpprev-' + process.pid + '.jsx');
let JS;
try { writeFileSync(tmp, body); JS = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8' }); }
finally { rmSync(tmp, { force: true }); }

const NOW = Math.floor(Date.now() / 1000);
// What the steward's screen is showing for a prompt document `vp`: every string in the MEMBER PREVIEW block.
function preview(vp) {
  const { React, draw } = miniReact();
  const win = { Steward: { subscribeVersePrompt: (cb) => { cb(vp); return () => {}; } }, Bible: null };
  const mod = new Function('React', 'window', 'Icon', 'Panel', 'VP_BOOKS', 'setTimeout', 'document', 'console',
    JS + '\nreturn { DashVersePrompt };')(React, win, Stub('Icon'), function Panel(p) { return React.createElement('div', {}, p.children); }, [['John', 21]], () => 0, {}, console);
  draw(mod.DashVersePrompt, {});
  const tree = draw(mod.DashVersePrompt, {});
  const all = texts(tree).join(' | ');
  const at = all.indexOf('MEMBER PREVIEW');
  return at < 0 ? null : all.slice(at);
}

const sch = (ref, dt) => ({ at: NOW + dt, ref, note: '' });

test('CONTROL: a prompt with no schedule previews its ref', () => {
  const p = preview({ ref: 'John 3:16', note: '', schedule: [], ts: 1 });
  assert.ok(p, 'no preview block was drawn - the fixture is wrong, the assertions below prove nothing');
  assert.match(p, /John 3:16/);
});

test('a passage scheduled for LATER is not in the preview, because no member sees it yet', () => {
  const p = preview({ ref: 'John 3:16; Ezra 4:1-4', note: '', schedule: [sch('John 3:16', -3600), sch('Ezra 4:1-4', 86400)], ts: 1 });
  assert.match(p, /John 3:16/);
  assert.doesNotMatch(p, /Ezra/, 'THE DEFECT: the console previews a passage members cannot see yet');
});

test('a passage in the prompt text but in no schedule entry is not previewed (members read only the schedule)', () => {
  const p = preview({ ref: 'Ezra 4:1-4; John 3:16', note: '', schedule: [sch('John 3:16', -60)], ts: 1 });
  assert.match(p, /John 3:16/);
  assert.doesNotMatch(p, /Ezra/, 'an old unscheduled passage is previewed though members do not see it');
});

test('nothing live yet means no preview at all', () => {
  assert.equal(preview({ ref: 'Ezra 4:1-4', note: '', schedule: [sch('Ezra 4:1-4', 3600)], ts: 1 }), null);
});

test('the preview opens on the earliest passage whose time has come, as the member card does', () => {
  const p = preview({ ref: 'Psalm 23; John 3:16', note: '', schedule: [sch('John 3:16', -60), sch('Psalm 23', -7200)], ts: 1 });
  assert.match(p, /Psalm 23/);
});
