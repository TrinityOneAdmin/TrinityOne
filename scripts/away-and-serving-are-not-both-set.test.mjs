// "AWAY" AND "I'LL SERVE" CANNOT BOTH BE SET FOR ONE SUNDAY.
// Run: node --test scripts/away-and-serving-are-not-both-set.test.mjs
//
// Sim 2026-10-02, item 47: nothing stopped a member marking a Sunday "away" while holding an "I'll serve" for it
// (or saying "I'll serve" to a Sunday they had marked away). Both were stored, with no warning; the rota honours
// whichever the steward happens to read.
//
//   marking AWAY  -> any "I'll serve" for that Sunday is withdrawn (a 'decline' goes to the church);
//   saying "I'll serve" -> that Sunday comes off the away list.
//
// Both are driven through the SHIPPED screens: the real UnavailSheet (tick a Sunday, press Save) and the real
// svRespond that every serving button goes through (CLAUDE.md rules 1 and 3). The ctx is a spy that records what
// was sent to the church, in order.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { nodes } from './app-screens.mjs';
import { loadServing, baseCtx, nodeText, slot } from './serving-screen-harness.mjs';

let h, SUNDAY, OTHER;
before(() => {
  h = loadServing();
  const s = h.mod.svNextSundays(3);
  SUNDAY = s[0]; OTHER = s[1];
});

function spyCtx({ away = [], complete = true, confirmed = [] } = {}) {
  const log = [];
  let list = [...away];
  const ctx = baseCtx({
    servConfirmed: confirmed,
    respondServing: async (item, verdict) => { log.push(['respond', item.id, verdict]); return true; },
    getUnavailableDates: () => [...list],
    readUnavailableDates: async () => ({ dates: [...list], complete }),
    setUnavailableDates: async (dates) => { log.push(['away', [...dates]]); list = [...dates]; },
    toast: (t) => log.push(['toast', t]),
  });
  return { ctx, log, away: () => [...list] };
}
const toasts = (log) => log.filter(e => e[0] === 'toast').map(e => e[1]);

// ── "I'll serve" takes the Sunday off the away list ────────────────────────────────────────────────────────
test('saying "I\'ll serve" for a Sunday marked away takes that Sunday off the away list', async () => {
  const { ctx, log, away } = spyCtx({ away: [SUNDAY.iso, OTHER.iso] });
  const ok = await h.mod.svRespond(ctx, slot({ date: SUNDAY.iso }), 'accept', '', 'You’re serving');
  assert.equal(ok, true);
  assert.deepEqual(Array.from(away()), [OTHER.iso], 'THE DEFECT: the Sunday is still on the away list beside the "I\'ll serve"');
  assert.ok(log.some(e => e[0] === 'respond' && e[2] === 'accept'), 'the yes itself was not sent');
  assert.match(toasts(log).join(' '), /no longer marked away/, 'the member was not told their away mark went');
});

test('…but never writes an away list it could not read (a replace over an unconfirmed list deletes real dates)', async () => {
  const { ctx, log } = spyCtx({ away: [SUNDAY.iso, OTHER.iso], complete: false });
  await h.mod.svRespond(ctx, slot({ date: SUNDAY.iso }), 'accept', '', 'You’re serving');
  assert.ok(!log.some(e => e[0] === 'away'), 'the away list was REPLACED from a read the church never answered');
  assert.match(toasts(log).join(' '), /still marked away/, 'the member is not told the Sunday is still marked away');
});

test('a Sunday that was not away is left alone: no write at all', async () => {
  const { ctx, log } = spyCtx({ away: [OTHER.iso] });
  await h.mod.svRespond(ctx, slot({ date: SUNDAY.iso }), 'accept', '', 'You’re serving');
  assert.ok(!log.some(e => e[0] === 'away'), 'the away list was rewritten although nothing on it clashed');
});

test('a DECLINE never touches the away list', async () => {
  const { ctx, log } = spyCtx({ away: [SUNDAY.iso] });
  await h.mod.svRespond(ctx, slot({ date: SUNDAY.iso }), 'decline', '', 'Taken off');
  assert.ok(!log.some(e => e[0] === 'away'));
});

// ── marking AWAY withdraws the "I'll serve" ───────────────────────────────────────────────────────────────
// The real sheet: open it, let it read what the church holds, tick a Sunday, press Save.
async function markAway(ctx, iso) {
  h.r.fresh();
  const draw = () => { h.r.reset(); const t = h.mod.UnavailSheet({ open: true, onClose() {}, ctx }); h.r.flush(); return t; };
  draw();                                           // effect asks the church what it holds
  await new Promise(r => setTimeout(r, 0));          // …and the answer lands
  const sun = h.mod.svNextSundays(6).find(d => d.iso === iso);
  let tree = draw();
  const tick = nodes(tree).filter(n => n.type === 'button').find(b => nodeText(b).includes(`${sun.dow} ${sun.day} ${sun.mon}`));
  assert.ok(tick, 'the Sunday is not on the sheet');
  tick.props.onClick();
  tree = draw();
  const save = nodes(tree).filter(n => n.type === 'button').find(b => /Mark \d+ away/.test(nodeText(b)));
  assert.ok(save, 'no "Mark n away" button after ticking a Sunday');
  await save.props.onClick();
}

test('marking a Sunday away withdraws the "I\'ll serve" the member had given for it', async () => {
  const mine = slot({ id: 'req-sun', date: SUNDAY.iso, _verdict: 'accept' });
  const { ctx, log } = spyCtx({ confirmed: [mine] });
  await markAway(ctx, SUNDAY.iso);
  assert.deepEqual(log.filter(e => e[0] !== 'toast').map(e => e.slice(0, 3)),
    [['away', [SUNDAY.iso]], ['respond', 'req-sun', 'decline']],
    'THE DEFECT: the Sunday was marked away and no decline was sent — both stand. (Order matters: the away list is saved FIRST, so a refused save leaves nothing half-done.)');
  assert.match(toasts(log).join(' '), /took you off 1 slot/, 'the member was not told they were taken off');
});

test('only an explicit yes is withdrawn, and only for the Sunday marked away', async () => {
  const placedOnly = slot({ id: 'req-placed', date: SUNDAY.iso, _verdict: 'pending' });
  const otherDay = slot({ id: 'req-other', date: OTHER.iso, _verdict: 'accept' });
  const { ctx, log } = spyCtx({ confirmed: [placedOnly, otherDay] });
  await markAway(ctx, SUNDAY.iso);
  assert.deepEqual(log.filter(e => e[0] === 'respond'), [], 'a slot the member never said yes to, or one on another Sunday, was declined');
});

test('a withdrawal that could not be sent is SAID, not thanked', async () => {
  const mine = slot({ id: 'req-sun', date: SUNDAY.iso, _verdict: 'accept' });
  const { ctx, log } = spyCtx({ confirmed: [mine] });
  ctx.respondServing = async () => false;           // respondServing explains itself in its own toast and answers false
  await markAway(ctx, SUNDAY.iso);
  assert.match(toasts(log).join(' '), /couldn’t take you off/, 'the toast claims a clean result over a withdrawal that was never sent');
  assert.doesNotMatch(toasts(log).join(' '), /took you off 1/);
});
