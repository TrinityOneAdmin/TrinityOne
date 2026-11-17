package church.trinityone.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
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
        Factory(Context c, int widgetId) { this.c = c; this.widgetId = widgetId; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            pages = WidgetStore.pages(c, System.currentTimeMillis());
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
            WidgetStore.Page p = pages.get(position);
            String label = p.label + (pages.size() > 1 ? "  ·  " + c.getString(R.string.trinity_widget_swipe) : "");
            v.setTextViewText(R.id.trinity_widget_label, label);
            v.setTextViewText(R.id.trinity_widget_text, p.text);
            v.setInt(R.id.trinity_widget_text, "setMaxLines", verseLines);
            v.setTextViewText(R.id.trinity_widget_ref, p.ref);
            v.setOnClickFillInIntent(R.id.trinity_widget_item, new Intent());
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
    }
}
