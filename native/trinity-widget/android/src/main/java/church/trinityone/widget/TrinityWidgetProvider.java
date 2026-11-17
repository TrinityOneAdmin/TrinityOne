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
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        long now = System.currentTimeMillis();
        WidgetStore.pages(c, now);   // enforces validUntil before anything is drawn
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.trinity_widget);
            Intent svc = new Intent(c, TrinityWidgetService.class);
            svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            svc.setData(Uri.parse("trinitywidget://" + id + "/" + now));   // unique per widget, so adapters do not share a cache
            v.setRemoteAdapter(R.id.trinity_widget_stack, svc);
            v.setEmptyView(R.id.trinity_widget_stack, R.id.trinity_widget_empty);
            PendingIntent open = openApp(c, true);
            if (open != null) v.setPendingIntentTemplate(R.id.trinity_widget_stack, open);
            PendingIntent openEmpty = openApp(c, false);
            if (openEmpty != null) v.setOnClickPendingIntent(R.id.trinity_widget_empty, openEmpty);
            m.updateAppWidget(id, v);
        }
        m.notifyAppWidgetViewDataChanged(ids, R.id.trinity_widget_stack);
        scheduleNextChange(c, now);
        if (WidgetStore.read(c, WidgetStore.K_PROMPT) != null) PromptFetchJob.schedule(c);   // re-arm after a reboot
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
