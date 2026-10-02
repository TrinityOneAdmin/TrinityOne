// A REMOVED SERVING SLOT CANCELS ITS REMINDER.
//   Run: node --test scripts/a-removed-serving-slot-cancels-its-reminder.test.mjs
//
// THE DEFECT. `sync` in `app/reminders.jsx` never cancelled a scheduled reminder. If a volunteer
// was taken off the rota, or their slot was deleted, the evening-before reminder still fired on
// their lock screen. Turning reminders off in settings also left them in place.
//
// THE FIX. On each sync, any scheduled id NOT in the new slots list is cancelled (native and web).
// When prefs are off, everything is cancelled. TrinityNotif.set also cancels when prefs change.
//
// Caller of sync: app/app.jsx (servKey effect).
// Caller of TrinityNotif.set: the notifications settings screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';

const SRC = readFileSync(new URL('../app/reminders.jsx', import.meta.url), 'utf8');

function makeEnv() {
  const scheduled = [];
  const cancelled = [];
  const storage = {};
  const ctx = createContext({
    window: {
      Capacitor: {
        Plugins: {
          LocalNotifications: {
            requestPermissions: async () => ({ display: 'granted' }),
            schedule: async (o) => { scheduled.push(...(o.notifications || [])); },
            cancel: async (o) => { cancelled.push(...(o.notifications || []).map(n => n.id)); },
          },
        },
      },
    },
    localStorage: {
      _m: storage,
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    JSON, Date, Number, parseInt, atob: globalThis.atob,
    Notification: { permission: 'granted' },
    console,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    navigator: {},
    fetch: async () => ({ json: async () => ({}) }),
  });
  new Script(SRC, { filename: 'reminders.jsx' }).runInContext(ctx);
  return { ctx, scheduled, cancelled };
}

function futureDate(daysAhead) {
  const d = new Date(); d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

test('A. removing a slot from the rota cancels its reminder', async () => {
  const { ctx, scheduled, cancelled } = makeEnv();
  const d1 = futureDate(3), d2 = futureDate(5);
  const slots = [
    { id: 'svc-a', date: d1, teamName: 'Kids', role: 'Helper' },
    { id: 'svc-b', date: d2, teamName: 'Welcome', role: 'Greeter' },
  ];
  await ctx.window.TrinityReminders.sync(slots);
  assert.equal(scheduled.length, 2, 'both slots should be scheduled');

  await ctx.window.TrinityReminders.sync([slots[0]]);
  assert.ok(cancelled.length > 0,
    'REMOVING A SERVING SLOT DOES NOT CANCEL ITS REMINDER — a volunteer taken off the rota still ' +
    'gets "You\'re serving tomorrow" on their lock screen the evening before');
});

test('B. syncing with empty slots cancels everything', async () => {
  const { ctx, scheduled, cancelled } = makeEnv();
  const slots = [{ id: 'svc-c', date: futureDate(4), teamName: 'Band', role: 'Piano' }];
  await ctx.window.TrinityReminders.sync(slots);
  assert.equal(scheduled.length, 1);

  cancelled.length = 0;
  await ctx.window.TrinityReminders.sync([]);
  assert.ok(cancelled.length > 0,
    'syncing with no slots should cancel existing reminders');
});

test('C. turning reminders off cancels everything', async () => {
  const { ctx, scheduled, cancelled } = makeEnv();
  const slots = [{ id: 'svc-d', date: futureDate(6), teamName: 'Sound', role: 'Desk' }];
  await ctx.window.TrinityReminders.sync(slots);
  assert.equal(scheduled.length, 1);

  cancelled.length = 0;
  await ctx.window.TrinityNotif.set({ reminders: false });
  assert.ok(cancelled.length > 0,
    'turning reminders off in settings should cancel existing reminders');
});

test('CONTROL: an unchanged rota keeps its reminder', async () => {
  const { ctx, scheduled, cancelled } = makeEnv();
  const slots = [{ id: 'svc-e', date: futureDate(7), teamName: 'Tea', role: 'Server' }];
  await ctx.window.TrinityReminders.sync(slots);
  assert.equal(scheduled.length, 1);

  cancelled.length = 0;
  await ctx.window.TrinityReminders.sync(slots);
  assert.equal(cancelled.length, 0, 'an unchanged slot should not be cancelled');
});
