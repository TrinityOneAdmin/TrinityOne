// The app must not ask for notification permission before the person has asked for notifications.
// Run: node --test scripts/no-unprompted-permission.test.mjs
//
// Reported from a real phone, 2026-07-28: a browser permission prompt appeared on FIRST LAUNCH — before the
// tester had joined a church or done anything. registerPush fires as soon as an identity key exists
// (app.jsx, on [servReqs, activeChurch]), the master pref defaults to enabled, so it called ensurePerm()
// unprompted. That spends the one chance the app gets: a reflexive "Block" is close to permanent, because
// recovering it means digging into browser site settings, and Chrome penalises prompts with no user gesture.
// For this product it is also the worst possible first impression — the first thing a new member sees is a
// request, before any relationship exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REM = readFileSync(new URL('../app/reminders.jsx', import.meta.url), 'utf8');
const fn = (name) => {
  const at = REM.indexOf(name);
  assert.notEqual(at, -1, name + ' is gone from reminders.jsx');
  let d = 0, q = '';
  for (let i = REM.indexOf('{', at); i < REM.length; i++) {
    const c = REM[i], prev = REM[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && REM[i + 1] === '/') { i = REM.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') d++; else if (c === '}' && --d === 0) return REM.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + name);
};

test('registering for push never triggers the permission prompt', () => {
  const body = fn('async function registerPush');
  assert.doesNotMatch(body, /ensurePerm\(\)/,
    'registerPush asks for permission — it runs on first launch, so a new member is prompted before joining anything');
  assert.match(body, /Notification\.permission !== 'granted'\) return/,
    'registerPush must bail out unless permission was already granted elsewhere');
});

test('serving reminders only ask when there is something to remind about', () => {
  // This one may prompt: the person has confirmed a serving slot, so a reminder is a reason they can see.
  // But it must bail out first when there is nothing scheduled, or it becomes another first-launch prompt.
  const body = fn('async function sync');
  const guard = body.indexOf('if (!slots.length) return');
  const ask = body.indexOf('ensurePerm()');
  assert.notEqual(guard, -1, 'sync no longer bails out when there are no slots — it will prompt on an empty app');
  assert.ok(ask === -1 || guard < ask, 'sync asks for permission before checking there is anything to schedule');
});

test('the place that SHOULD ask still does', () => {
  // Removing the prompt everywhere would just break notifications silently. The Settings toggle is the
  // correct moment: the person has just asked for them.
  const EX = readFileSync(new URL('../app/screens-extras.jsx', import.meta.url), 'utf8');
  assert.match(EX, /ensurePerm \? await N\.ensurePerm\(\)/,
    'the notifications toggle no longer requests permission, so a member can never turn them on');
});
