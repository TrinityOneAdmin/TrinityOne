// THE CONSOLE WARMS CARE + SCHEDULE IN THE BACKGROUND AFTER OVERVIEW — AT THE POINT OF USE.
//   Run: node --test scripts/console-warm-after-overview.test.mjs
//
// THE FEATURE under test (feat/console-warm-after-overview-2026-11-04). The console's subscriptions live
// per-TAB: each DashX unmounts on leave and makeSub drops its socket when the last listener goes
// (steward-root.jsx `_subShared` ref-count), so every navigation re-opens the stream and waits a tunnel
// round-trip — a multi-second blank. <ConsoleWarm> (app/stew-dashboard.jsx) mounts the makeSub HOOKS for a
// bounded set of the heavier surfaces in the persistent shell, so their sockets stay live and `_subCache`
// stays warm across tabs; a later tab mount joins the live entry and paints instantly and fresh.
//
// THE POINT OF USE (CLAUDE.md rule 1 — this must fail if the warm is DELETED). A real gateway on a free
// port, the real console in headless chromium, a church made through the real screens and left on the
// OVERVIEW tab — the Care and Schedule tabs are NEVER opened. We then read the console's OWN
// `window.stewardStreamLoaded(method, idv)`, which answers true only once makeSub has actually cached a
// delivery for that stream (steward-root.jsx:251). The deletion detector is a SCHEDULE stream:
//
//   · subscribeServices / subscribeRotas — DashOverview does NOT subscribe these (its hook list holds
//     needs/slots/settings/rosters but not services/rotas/events/rotaSettings). On the Overview, with no
//     Schedule tab opened, the ONLY thing that can open them is <ConsoleWarm> → <ScheduleWarm>. Delete the
//     <ConsoleWarm> mount and these stay false → this test reddens. (Proven by hand on 2026-11-04:
//     removing the mount made both assertions fail with "never loaded".)
//
// WHY THE CARE STREAM IS NOT ASSERTED HERE (deviation from the plan's §4 sketch — honest record, CLAUDE.md §4).
// The plan sketched asserting stewardStreamLoaded('subscribeNeeds'). That is NOT measurable, for a reason
// deeper than DashOverview co-warming: the Care streams go through the StewardMeals engine, and makeSub's
// cache key is `method|idv|(obj.actingChurch||obj.churchPub)`. window.StewardMeals exposes NEITHER
// actingChurch NOR churchPub (it reads them off window.Steward internally — src/steward-meals.src.js:73),
// so every meals stream is cached under who=''. But window.stewardStreamLoaded builds the key with the REAL
// window.Steward.churchPub (steward-root.jsx:251-254), so it can never match a meals entry and always
// answers false for subscribeNeeds/Slots/Settings — verified 2026-11-04. The Schedule streams go through
// the Steward engine, whose churchPub IS the real one, so the key matches and the reader works. The Care
// warm is therefore proven by logic + the A/B probe, not by this reader: <CareWarm> and <ScheduleWarm> live
// inside the SAME <ConsoleWarm> mount, and <CareWarm> mounts at an EARLIER stagger phase with the same
// _warmOn gate, so if the Schedule streams loaded, <ConsoleWarm> ran and <CareWarm> mounted too.
//
// Rule 3: nothing here matches text in app/*.jsx — it runs the console's own exposed reader.
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, openNewChurch } from './new-church-session.mjs';

let s;
before(async () => {
  if (!CHROME) return;
  // Default gateway = THIS worktree's scripts/gateway.mjs (H.ROOT), which is what we are testing against.
  s = await openNewChurch({ wizard: 'skip', name: 'cwarm' });
});
after(() => { try { s && s.close(); } catch {} });
const SKIP = !CHROME ? 'no chromium' : false;

// stewardStreamLoaded(method, idv) keys on the identity version; a fresh church that never switches
// identity sits at idv 0, but scan a small range so an incidental bump cannot make this flaky.
const loaded = (method) =>
  `(() => { for (let i = 0; i <= 9; i++) { try { if (window.stewardStreamLoaded(${JSON.stringify(method)}, i)) return true; } catch (e) {} } return false; })()`;

test('CONTROL: we are on the Overview and the Schedule hooks exist (so the assertions below mean something)', { skip: SKIP, timeout: 120000 }, async () => {
  await s.waitFor(`!!(window.Steward && window.Steward.churchPub)`, 60000, 'the church key to load');
  // the Schedule streams we assert on are reached through these hooks; a rename would otherwise make the
  // warm silently warm nothing and the point-of-use assertions vacuously... still fail (good), but say why.
  const hooks = await s.ev(`JSON.stringify(['useStewardServices','useStewardRotas','useMealsNeeds'].map(h => typeof window[h]))`);
  assert.equal(hooks, JSON.stringify(['function', 'function', 'function']), 'a warmed hook is missing/renamed: ' + hooks);
  // the Schedule tab was never opened: its calendar surface is not in the DOM. (DashOverview is the default
  // tab; this guards against a future change that auto-opens Schedule and makes the detector vacuous.)
  const onOverview = await s.ev(`!document.body.innerText.includes('Create a new serving team')`);
  assert.equal(onOverview, true, 'a Schedule/rota surface appears to be mounted — the detector would be vacuous');
});

test('on the Overview, with the Schedule tab NEVER opened, the warm has opened + cached subscribeServices', { skip: SKIP, timeout: 120000 }, async () => {
  await s.waitFor(loaded('subscribeServices'), 30000, 'subscribeServices to be warmed from the Overview');
  assert.equal(await s.ev(loaded('subscribeServices')), true,
    'subscribeServices never loaded while on the Overview — <ConsoleWarm>/<ScheduleWarm> did not run');
});

test('…and subscribeRotas too (second Schedule-only detector)', { skip: SKIP, timeout: 120000 }, async () => {
  await s.waitFor(loaded('subscribeRotas'), 30000, 'subscribeRotas to be warmed from the Overview');
  assert.equal(await s.ev(loaded('subscribeRotas')), true,
    'subscribeRotas never loaded while on the Overview — the Schedule warm did not run');
});
