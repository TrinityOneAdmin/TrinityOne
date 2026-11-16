package church.trinityone.widget;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

/** Feeds the StackView one card per page (WidgetStore.pages: the most current first). */
public class TrinityWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) { return new Factory(getApplicationContext()); }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private List<WidgetStore.Page> pages = new ArrayList<>();
        Factory(Context c) { this.c = c; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() { pages = WidgetStore.pages(c, System.currentTimeMillis()); }
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
