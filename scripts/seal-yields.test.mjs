// SEALING A KEY FOR EVERY MEMBER MUST NOT FREEZE THE CONSOLE. Run: node --test scripts/seal-yields.test.mjs
//
// THE DEFECT (Fable verification audit, 2026-08-10). Every key envelope in the console holds a separately
// sealed copy of the key ring for each member. Sealing costs ~5 ms per member on a workstation and several
// times that on a phone, and it ran as one synchronous loop.
//
// Measured at 500 members: 2,591 ms per key with nothing drawn for any of it — and blocking someone rotates
// THREE keys, so the console was dead for about eight seconds, on a workstation, right after the steward
// tapped a destructive button. They cannot tell whether it worked, so the honest thing for them to do is tap
// it again.
//
// Yielding every 25 members costs almost nothing in total time (2,469 ms) and cuts the longest uninterrupted
// stretch to 129 ms, which is the number that decides whether a screen feels frozen. It also makes progress
// reportable, which a single blocking loop can never be.
//
// This is not "blocking is now fast". It is "the console is alive while it happens".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function liftSeal() {
  const at = SRC.indexOf('async function _sealEach(');
  assert.notEqual(at, -1,
    '_sealEach() is gone from the console.\n\n' +
    '  If this is the first run, that IS the defect: each key envelope seals its copies in one synchronous\n' +
    '  loop, so a 500-member church freezes the console for seconds at a time with nothing drawn.');
  let depth = 0, body;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) { body = SRC.slice(at, i + 1); break; }
  }
  return new Function('setTimeout', body + '\nreturn _sealEach;')(setTimeout);
}

test('the thread is handed back during a large seal', async () => {
  const _sealEach = liftSeal();
  const members = Array.from({ length: 500 }, (_, i) => 'm' + i);
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 4);   // stands in for the browser painting
  await _sealEach('payload', members, () => 'sealed');
  clearInterval(timer);
  assert.ok(ticks > 0,
    'nothing else ran for the whole seal. That is a frozen console: the steward has just tapped a ' +
    'destructive button and has no way to tell whether it is working');
});

test('every member still gets a copy', async () => {
  const _sealEach = liftSeal();
  const members = Array.from({ length: 120 }, (_, i) => 'm' + i);
  const keys = await _sealEach('payload', members, (pl, mp) => 'sealed:' + mp);
  assert.equal(Object.keys(keys).length, 120,
    'yielding lost members. A member missing from this envelope cannot open anything sealed under the new ' +
    'key — the same harm as being blocked, applied to someone who was not');
  assert.equal(keys.m119, 'sealed:m119', 'the seal was applied to the wrong member');
});

test('one member who cannot be sealed to does not lose the rest', async () => {
  const _sealEach = liftSeal();
  const members = Array.from({ length: 60 }, (_, i) => 'm' + i);
  const keys = await _sealEach('payload', members, (pl, mp) => {
    if (mp === 'm30') throw new Error('bad key');
    return 'sealed';
  });
  assert.equal(Object.keys(keys).length, 59, 'one unusable pubkey aborted the whole rotation');
});

test('progress can be reported, which a blocking loop can never do', async () => {
  const _sealEach = liftSeal();
  const seen = [];
  await _sealEach('p', Array.from({ length: 100 }, (_, i) => 'm' + i), () => 's', (done, total) => seen.push([done, total]));
  assert.ok(seen.length >= 2, 'progress is never reported, so a long rotation looks identical to a hung one');
  assert.deepEqual(seen[seen.length - 1], [100, 100], 'the final call must say it finished');
});

test('every per-member seal in the console goes through it', () => {
  // MATCH THE SHAPE, NOT THE VARIABLE NAMES. The first version of this guard was written as
  // /for \(const mp of \w+\) \{ try \{ keys\[mp\] = nip44e/ — the exact spelling of the five loops that had
  // just been converted. Two others survived with different names (`for (const pk of recips)` in the name key,
  // `for (const p of ...)` in sealToPubs) and this test reported clean over both. A guard written to the code
  // you already fixed cannot see the code you missed; write it to the defect instead. Any identifier now.
  //
  // ONE EXEMPTION, BY NAME AND WITH A REASON. sealToPubs seals to a single care team — the church, the person
  // who asked for help, and the handful of stewards on the team — so its cost does not grow with the
  // congregation and a synchronous loop there cannot freeze anything. It is cut out of the text below rather
  // than allowed to fall through a gap in the pattern, which is how it escaped the first version of this
  // guard. If it ever acquires a church-wide caller the exemption is wrong; that is the thing to re-check.
  const cutMethod = (src, sig) => {
    const at = src.indexOf(sig);
    assert.notEqual(at, -1, sig + ' is gone — this exemption no longer refers to anything, so re-check it');
    let depth = 0;
    for (let i = src.indexOf('{', at); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(0, at) + src.slice(i + 1);
    }
    assert.fail('could not find the end of ' + sig);
  };
  const SCAN = cutMethod(SRC, 'sealToPubs(recips, obj) {');
  const loops = SCAN.match(/for \(const (\w+) of [\s\S]{1,90}?\) \{ try \{ keys\[\1\] = nip44e/g) || [];
  assert.deepEqual(loops, [],
    `${loops.length} key envelope(s) still seal in a synchronous loop:\n    ` + loops.join('\n    ') +
    '\n  Sealing costs ~5 ms per member on a workstation and several times that on a phone, so each of these ' +
    'freezes the console for seconds in a large church. They were identical five times over, which is how ' +
    'this shape got copied that far — a new one will freeze it exactly as the others did.');
  assert.ok((SRC.match(/_sealEach\(/g) || []).length >= 7, 'the call sites were not actually converted');
});

test('the shipped console carries it', () => {
  assert.match(VENDOR, /_sealEach/, 'vendor/steward.js predates this — run bash scripts/build-steward.sh');
});
