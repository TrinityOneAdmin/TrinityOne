package church.trinityone.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

/** Feeds the StackView one card per page (WidgetStore.pages: the most current first). */
public class TrinityWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private final int widgetId;
        private List<WidgetStore.Page> pages = new ArrayList<>();
        private int verseLines = 4;
        private int rotation = 0;   // tap-to-flip (WidgetStore.K_FLIP)
        Factory(Context c, int widgetId) { this.c = c; this.widgetId = widgetId; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            pages = WidgetStore.pages(c, System.currentTimeMillis());
            rotation = widgetId == AppWidgetManager.INVALID_APPWIDGET_ID ? 0 : WidgetStore.rotation(c, widgetId, WidgetStore.pageOrder(pages));
            verseLines = linesForThisWidget();
        }

        /** This widget's height as the launcher reports it (portrait: MAX_HEIGHT, landscape: MIN_HEIGHT — the
         *  documented meaning of the two), turned into a line count. Re-read on a resize: see the provider. */
        private int linesForThisWidget() {
            int h = 0;
            try {
                Bundle o = widgetId == AppWidgetManager.INVALID_APPWIDGET_ID ? null : AppWidgetManager.getInstance(c).getAppWidgetOptions(widgetId);
                boolean land = c.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
                if (o != null) h = o.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            } catch (Throwable ignored) {}
            return WidgetStore.verseLines(h, c.getResources().getConfiguration().fontScale, Build.VERSION.SDK_INT >= 26 ? 12f : 15f);
        }
        @Override public void onDestroy() { pages = new ArrayList<>(); }
        @Override public int getCount() { return pages.size(); }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.trinity_widget_item);
            if (position < 0 || position >= pages.size()) return v;
            final RemoteViews rv = v;
            final int page = WidgetStore.logical(position, rotation, pages.size());
            WidgetStore.bindPage(new WidgetStore.PageBinder() {
                @Override public void label(String s) { rv.setTextViewText(R.id.trinity_widget_label, s); }
                @Override public void text(String s, int maxLines) {
                    rv.setTextViewText(R.id.trinity_widget_text, s);
                    rv.setInt(R.id.trinity_widget_text, "setMaxLines", maxLines);
                }
                @Override public void ref(String s) { rv.setTextViewText(R.id.trinity_widget_ref, s); }
                @Override public void dotsShown(boolean shown) { rv.setViewVisibility(R.id.trinity_widget_dots, shown ? View.VISIBLE : View.GONE); }
                @Override public void dot(int slot, int state) {
                    int id = slot == 0 ? R.id.trinity_widget_dot0 : R.id.trinity_widget_dot1;
                    rv.setViewVisibility(id, state == WidgetStore.DOT_HIDDEN ? View.GONE : View.VISIBLE);
                    rv.setImageViewResource(id, state == WidgetStore.DOT_ON ? R.drawable.trinity_widget_dot_on : R.drawable.trinity_widget_dot_off);
                }
            }, pages.get(page), page, pages.size(), verseLines);
            int n = WidgetStore.messageCount(c, System.currentTimeMillis());
            if (n > 0) {
                v.setTextViewText(R.id.trinity_widget_count, c.getResources().getQuantityString(R.plurals.trinity_widget_new_messages, n, n));
                v.setViewVisibility(R.id.trinity_widget_count, View.VISIBLE);
            }
            v.setOnClickFillInIntent(R.id.trinity_widget_item, new Intent());
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
    }
}
