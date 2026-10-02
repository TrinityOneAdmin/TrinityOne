// THE SETUP WIZARD'S FIRST ROOMS AND FIRST MEETINGS WORK IN A NEW CHURCH'S FIRST SESSION.
//   Run: node --test scripts/the-wizard-seals-a-new-churchs-first-rooms.test.mjs
//
// THE DEFECT (measured 2026-10-02, main at d73d8fb, church made through the real screens, no reload):
//   · "Create 3 & continue" (Whole Church, Notices, Prayer): all three came out with NO `encrypted` flag and no key
//     envelope — the two group rooms were meant to be sealed (the church's default) and were created in the clear,
//     silently, because the console had not signed in so their keys could not be saved, and the wizard un-flagged
//     them and said nothing;
//   · "Add 2 & continue" (the regular meetings): "Couldn't save your meetings yet — try again in a moment", for ever,
//     because no name key existed to seal them with. The only way past was to skip.
// Both are what every new church does in its first minute. Fixed by the console signing in on its own, the relay
// challenging a key read, the dashboard's streams following the relay once it is admitted, and no room meant to be
// encrypted ever being created without its key (this branch, parts A–D).
//
// THE POINT OF USE (CLAUDE.md rule 1). The real console in headless chromium; a church made through the real screens;
// the wizard driven by its own buttons, pressed AS SOON AS the screen allows — two seconds after the church key was
// made, which is a faster steward than any real one and exactly the window in which the console is still signing in.
// Read back from a raw logger signed in as the church. Rule 3: nothing here matches text in app/*.jsx.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, openNewChurch, sleep } from './new-church-session.mjs';

let s;
before(async () => { if (!CHROME) return; s = await openNewChurch({ wizard: 'rooms', name: 'wizrooms' }); });
after(() => { try { s && s.close(); } catch {} });
const SKIP = !CHROME ? 'no chromium' : false;

test('"Create 3 & continue", pressed at once: the two group rooms are flagged encrypted AND have their key envelopes; the broadcast channel is not sealed; the wizard moves on', { skip: SKIP, timeout: 120000 }, async () => {
  await s.press(/^Create 3/);
  await s.waitFor(`/Your regular meetings/.test(document.body.innerText)`, 60000, 'the wizard to move on to the meetings step');
  const t0 = Date.now(); while (Date.now() - t0 < 10000 && s.events.filter(e => e.d.startsWith('trinityone/groupkey:')).length < 2) await sleep(200);
  const rooms = new Map();   // id -> newest doc seen
  for (const e of s.events.filter(x => x.d.startsWith('trinityone/group:'))) rooms.set(e.d.slice('trinityone/group:'.length), { ...JSON.parse(e.content), t: e.t });
  const byName = Object.fromEntries([...rooms.entries()].map(([id, o]) => [o.name, { id, ...o }]));
  assert.deepEqual(Object.keys(byName).sort(), ['Notices', 'Prayer', 'Whole Church'], 'the wizard did not create the three rooms: ' + JSON.stringify(Object.keys(byName)));
  const keys = new Map(s.events.filter(x => x.d.startsWith('trinityone/groupkey:')).map(e => [e.d.slice('trinityone/groupkey:'.length), e]));
  for (const name of ['Whole Church', 'Prayer']) {
    assert.equal(byName[name].encrypted, true, `“${name}” was created in the clear (no encrypted flag) — the church's default is sealed rooms`);
    assert.ok(keys.has(byName[name].id), `“${name}” is flagged encrypted and has NO key envelope: every member's send would be refused for ever`);
    assert.ok(keys.get(byName[name].id).t <= byName[name].t, `“${name}”'s key reached the relay AFTER the room — a window in which it is flagged encrypted with no key`);
  }
  assert.notEqual(byName['Notices'].encrypted, true, 'the broadcast channel (the church\'s own voice) was sealed');
  assert.deepEqual(await s.ev(`window.__blocked`), [], 'the console raised a "not saved" warning: ' + JSON.stringify(await s.ev(`window.__blocked`)));
  assert.doesNotMatch(await s.text(), /weren’t created|Couldn’t create your rooms/, 'the step reported a failure although it advanced');
});

test('"Add 2 & continue": the regular meetings save in the first session, sealed, and the wizard moves on', { skip: SKIP, timeout: 120000 }, async () => {
  await s.press(/^Add 2/);
  await s.waitFor(`!/Your regular meetings/.test(document.body.innerText)`, 40000, 'the wizard to move past the meetings step (it said "Couldn\'t save your meetings yet" for ever before)');
  const t0 = Date.now(); while (Date.now() - t0 < 10000 && s.events.filter(e => e.d.startsWith('trinityone/event:')).length < 2) await sleep(200);
  const ev = s.events.filter(e => e.d.startsWith('trinityone/event:'));
  assert.ok(ev.length >= 2, 'the two meetings did not reach the relay: ' + ev.length);
  assert.ok(ev.every(e => e.sealed), 'a meeting reached the relay in the clear: ' + ev.map(e => e.content.slice(0, 60)).join(' | '));
  assert.ok(!ev.some(e => /Sunday Service|Midweek/.test(e.content)), 'a meeting carries its title in the clear');
  assert.doesNotMatch(await s.text(), /Couldn’t save your meetings/, 'the step still shows the failure');
});
