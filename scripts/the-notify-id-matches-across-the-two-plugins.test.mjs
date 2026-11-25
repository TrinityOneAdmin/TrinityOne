// THE TWO COPIES OF THE DIRECT-PUSH NOTIFICATION ID ARE THE SAME NUMBER (B6, part 1b).
//   Run: node --test scripts/the-notify-id-matches-across-the-two-plugins.test.mjs
//
// DirectPushWorker (plugins/trinity-directpush, Kotlin) POSTS the "You have N new messages"
// notification under NOTIFY_ID. WidgetStore (native/trinity-widget, Java) CANCELS it from
// clearMessageCount under its own duplicated constant DIRECTPUSH_NOTIFY_ID — two plugins, no shared
// module in a patch round, so drift between the copies would silently turn every app-side clear into
// a no-op against the status-bar notification. This is CONSTANT EQUALITY plus wiring presence, by
// design (plan-audit change 4): whether the cancel RUNS is only provable on a device, and that leg
// (and the warm-app tap) belongs to the conductor, not this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const KT = readFileSync(new URL('../plugins/trinity-directpush/android/src/main/java/church/trinityone/directpush/DirectPushWorker.kt', import.meta.url), 'utf8');
const JAVA = readFileSync(new URL('../native/trinity-widget/android/src/main/java/church/trinityone/widget/WidgetStore.java', import.meta.url), 'utf8');

const one = (src, re, what) => {
  const m = [...src.matchAll(re)];
  assert.equal(m.length, 1, what + ': expected exactly one definition, found ' + m.length);
  return m[0][1];
};

test('DirectPushWorker.NOTIFY_ID and WidgetStore.DIRECTPUSH_NOTIFY_ID are one number', () => {
  const kt = one(KT, /const val NOTIFY_ID = (0x[0-9a-fA-F]+|\d+)/g, 'DirectPushWorker.NOTIFY_ID');
  const java = one(JAVA, /static final int DIRECTPUSH_NOTIFY_ID = (0x[0-9a-fA-F]+|\d+)/g, 'WidgetStore.DIRECTPUSH_NOTIFY_ID');
  assert.equal(Number(kt), Number(java), 'the two plugins no longer agree on the notification id — a clear would cancel nothing');
});

test('the poster uses its constant and the canceller uses its own (no stray literal id on either side)', () => {
  assert.match(KT, /NotificationManagerCompat\.from\(ctx\)\.notify\(NOTIFY_ID, n\)/, 'DirectPushWorker no longer posts under NOTIFY_ID');
  const clear = JAVA.slice(JAVA.indexOf('static void clearMessageCount('), JAVA.indexOf('static ComponentName provider('));
  assert.match(clear, /NotificationManagerCompat\.from\(c\)\.cancel\(DIRECTPUSH_NOTIFY_ID\)/, 'WidgetStore.clearMessageCount no longer cancels the direct-push notification');
});
