package church.trinityone.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.widget.RemoteViews;

/**
 * Draws the widget: a StackView (a swipeable collection widget, available to RemoteViews since API 11 — our
 * minSdk is 22) fed by TrinityWidgetService. Page order and the "most current" rule: see WidgetStore.
 * Tapping anywhere opens the app (no deep link: the app's link handler accepts only /join invites).
 */
public class TrinityWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(final Context c, final AppWidgetManager m, int[] ids) {
        long now = System.currentTimeMillis();
        // pages() also enforces validUntil before anything is drawn.
        String order = WidgetStore.pageOrder(WidgetStore.pages(c, now));
        drawAll(new Host() {
            @Override public String shownOrder(int id) { return WidgetStore.shownOrder(c, id); }
            @Override public void update(int id, boolean front) { m.updateAppWidget(id, views(c, id, front)); }
            @Override public void dataChanged(int[] done) { m.notifyAppWidgetViewDataChanged(done, R.id.trinity_widget_stack); }
            @Override public void front(int id) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.trinity_widget);
                v.setDisplayedChild(R.id.trinity_widget_stack, 0);
                m.partiallyUpdateAppWidget(id, v);
            }
            @Override public void recordOrder(int id, String o) { WidgetStore.recordOrder(c, id, o); }
        }, ids, order);
        scheduleNextChange(c, now);
        if (WidgetStore.read(c, WidgetStore.K_PROMPT) != null) PromptFetchJob.schedule(c);   // re-arm after a reboot
    }

    /** What drawAll needs from the launcher and the prefs — an interface so the JVM test (DrawOrderTest) runs the order. */
    interface Host {
        String shownOrder(int id);
        void update(int id, boolean front);   // the full RemoteViews; front → it also asks for page 0
        void dataChanged(int[] ids);
        void front(int id);                   // a partial update that only asks for page 0
        void recordOrder(int id, String order);
    }

    /**
     * MOST CURRENT PAGE IN FRONT (device D2; re-audit R2 of c0c78163). StackView does not promise which child it
     * shows after an update, so when the page set or order CHANGED, page 0 is asked for twice: inside the full update,
     * and again by a partial update sent AFTER the data-changed notice (so it lands after the adapter is told to
     * reload). Only then is the new order recorded; a widget whose update threw is NOT recorded, so the next update
     * tries again. When nothing changed, page 0 is not asked for, so a member's swipe to the other page survives —
     * helped by the adapter's address now being stable per widget (views()), so the launcher keeps the same adapter.
     * What the launcher actually does with the request is not knowable from here: the recorded order means "asked
     * for, after the update was accepted", not "seen in front".
     */
    static void drawAll(Host h, int[] ids, String order) {
        int[] done = new int[ids.length]; boolean[] reset = new boolean[ids.length]; int n = 0;
        for (int id : ids) {
            boolean r = WidgetStore.frontNeedsReset(h.shownOrder(id), order);
            try { h.update(id, r); } catch (RuntimeException e) { continue; }
            reset[n] = r; done[n++] = id;
        }
        int[] ok = java.util.Arrays.copyOf(done, n);
        if (n > 0) h.dataChanged(ok);
        for (int i = 0; i < n; i++) {
            if (!reset[i]) continue;
            try { h.front(ok[i]); } catch (RuntimeException e) { continue; }
            h.recordOrder(ok[i], order);
        }
    }

    static RemoteViews views(Context c, int id, boolean front) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.trinity_widget);
        Intent svc = new Intent(c, TrinityWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        // Unique PER WIDGET (so two widgets never share an adapter) and STABLE across updates (re-audit R2): it used to
        // carry the update time, which handed StackView a new adapter — and a new front page — on every redraw.
        svc.setData(Uri.parse("trinitywidget://" + id));
        v.setRemoteAdapter(R.id.trinity_widget_stack, svc);
        v.setEmptyView(R.id.trinity_widget_stack, R.id.trinity_widget_empty);
        PendingIntent open = openApp(c, true);
        if (open != null) v.setPendingIntentTemplate(R.id.trinity_widget_stack, open);
        PendingIntent openEmpty = openApp(c, false);
        if (openEmpty != null) v.setOnClickPendingIntent(R.id.trinity_widget_empty, openEmpty);
        if (front) v.setDisplayedChild(R.id.trinity_widget_stack, 0);
        return v;
    }

    @Override
    public void onDeleted(Context c, int[] ids) {
        for (int id : ids) WidgetStore.forgetOrder(c, id);
    }

    /** Resized: the verse's line count depends on the height (TrinityWidgetService.linesForThisWidget), so redraw. */
    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle newOptions) {
        m.notifyAppWidgetViewDataChanged(new int[] { id }, R.id.trinity_widget_stack);
    }

    static PendingIntent openApp(Context c, boolean template) {
        Intent launch = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (launch == null) return null;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // A collection template must be MUTABLE on API 31+ so each card's fill-in intent can merge into it.
        if (Build.VERSION.SDK_INT >= 31) flags |= template ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE;
        else if (Build.VERSION.SDK_INT >= 23 && !template) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, template ? 1 : 2, launch, flags);
    }

    /** Redraw at local midnight or the next scheduled prompt, without the app. Inexact by design (no permission). */
    static void scheduleNextChange(Context c, long now) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).setComponent(WidgetStore.provider(c));
        int[] ids = AppWidgetManager.getInstance(c).getAppWidgetIds(WidgetStore.provider(c));
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids == null ? new int[0] : ids);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(c, 3, i, flags);
        am.set(AlarmManager.RTC, WidgetStore.nextChange(c, now) + 1000L, pi);
    }
}
