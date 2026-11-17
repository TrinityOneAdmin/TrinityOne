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
import android.view.View;
import android.widget.RemoteViews;

/**
 * Draws the widget: a StackView (a swipeable collection widget, available to RemoteViews since API 11 — our
 * minSdk is 22) fed by TrinityWidgetService. Page order and the "most current" rule: see WidgetStore.
 * Tapping anywhere opens the app (no deep link: the app's link handler accepts only /join invites) — except the
 * right-edge strip over the page dots when there are two pages, which flips to the next page (ACTION_FLIP).
 */
public class TrinityWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(final Context c, final AppWidgetManager m, int[] ids) {
        long now = System.currentTimeMillis();
        drawAll(host(c, m), ids, orderNow(c, now));
        afterDraw(c, now);
    }

    /** The tap-to-flip strip's broadcast (trinity_widget_flip; explicit, to this receiver only). */
    static final String ACTION_FLIP = "church.trinityone.widget.FLIP";

    @Override
    public void onReceive(Context c, Intent i) {
        if (i != null && handle(c, i.getAction(), i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))) return;
        super.onReceive(c, i);
    }

    /** ACTION_FLIP → the next page of that widget (Host.flip); anything else → false (AppWidgetProvider handles it).
     *  The flip records nothing: a member's choice of page is kept until the page set changes (drawAll). */
    boolean handle(Context c, String action, int id) {
        if (!ACTION_FLIP.equals(action)) return false;
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID) host(c, manager(c)).flip(id);
        return true;
    }

    AppWidgetManager manager(Context c) { return AppWidgetManager.getInstance(c); }

    static int pageCount(String order) {
        int n = 0;
        for (int i = 0; i < order.length(); i++) if (order.charAt(i) == '\n') n++;
        return n;
    }

    // onUpdate's three seams, so the JVM test (DrawOrderTest) runs onUpdate ITSELF and sees it reach drawAll (re-audit
    // N-b of d6f0e32c). Each is the plain Android call it names; nothing else overrides them.

    /** The page order now. pages() also enforces validUntil before anything is drawn. */
    String orderNow(Context c, long now) { return WidgetStore.pageOrder(WidgetStore.pages(c, now)); }

    void afterDraw(Context c, long now) {
        scheduleNextChange(c, now);
        if (WidgetStore.read(c, WidgetStore.K_PROMPT) != null) PromptFetchJob.schedule(c);   // re-arm after a reboot
    }

    Host host(final Context c, final AppWidgetManager m) {
        return new Host() {
            @Override public String shownOrder(int id) { return WidgetStore.shownOrder(c, id); }
            @Override public void update(int id, boolean front, int pages) { m.updateAppWidget(id, views(c, id, front, pages)); }
            @Override public void dataChanged(int[] done) { m.notifyAppWidgetViewDataChanged(done, R.id.trinity_widget_stack); }
            @Override public void front(int id) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.trinity_widget);
                v.setDisplayedChild(R.id.trinity_widget_stack, 0);
                m.partiallyUpdateAppWidget(id, v);
            }
            @Override public void recordOrder(int id, String o) { WidgetStore.recordOrder(c, id, o); }
            @Override public void flip(int id) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.trinity_widget);
                v.showNext(R.id.trinity_widget_stack);
                m.partiallyUpdateAppWidget(id, v);
            }
        };
    }

    /** What drawAll needs from the launcher and the prefs — an interface so the JVM test (DrawOrderTest) runs the order. */
    interface Host {
        String shownOrder(int id);
        void update(int id, boolean front, int pages);   // the full RemoteViews; front → it also asks for page 0
        void dataChanged(int[] ids);
        void front(int id);                   // a partial update that only asks for page 0
        void recordOrder(int id, String order);
        void flip(int id);                    // a partial update: showNext on the stack
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
        int pages = pageCount(order);
        for (int id : ids) {
            boolean r = WidgetStore.frontNeedsReset(h.shownOrder(id), order);
            try { h.update(id, r, pages); } catch (RuntimeException e) { continue; }
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

    static RemoteViews views(Context c, int id, boolean front, int pages) {
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
        // Tap to flip: only with two pages (one page → the strip is gone and the whole card opens the app).
        v.setViewVisibility(R.id.trinity_widget_flip, pages >= 2 ? View.VISIBLE : View.GONE);
        if (pages >= 2) v.setOnClickPendingIntent(R.id.trinity_widget_flip, flipIntent(c, id));
        return v;
    }

    static PendingIntent flipIntent(Context c, int id) {
        Intent i = new Intent(ACTION_FLIP).setComponent(WidgetStore.provider(c));
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        i.setData(Uri.parse("trinitywidget-flip://" + id));   // one PendingIntent per widget
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(c, 100 + id, i, flags);
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
