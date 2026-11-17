package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Device D-1 (2026-11-17): ColorOS ignored the partial showNext, so tapping the dots did nothing. A flip now rotates the
 * widget's pages and notifies a data change. This runs the provider's REAL host().flip with a mocked AppWidgetManager
 * and an in-memory SharedPreferences behind a mocked Context, and the factory's mapping (WidgetStore.logical).
 * What the launcher draws is a device check.
 */
public class FlipTest {
    /** A tiny in-memory SharedPreferences: enough for WidgetStore's flip/order keys. */
    static final class Prefs implements SharedPreferences {
        final Map<String, Object> m = new HashMap<>();
        @Override public Map<String, ?> getAll() { return new HashMap<>(m); }
        @Override public String getString(String k, String d) { Object v = m.get(k); return v == null ? d : (String) v; }
        @Override public Set<String> getStringSet(String k, Set<String> d) { return d; }
        @Override public int getInt(String k, int d) { Object v = m.get(k); return v == null ? d : (Integer) v; }
        @Override public long getLong(String k, long d) { return d; }
        @Override public float getFloat(String k, float d) { return d; }
        @Override public boolean getBoolean(String k, boolean d) { return d; }
        @Override public boolean contains(String k) { return m.containsKey(k); }
        @Override public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
        @Override public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
        @Override public Editor edit() {
            final Map<String, Object> put = new HashMap<>(); final java.util.List<String> rm = new java.util.ArrayList<>();
            return new Editor() {
                @Override public Editor putString(String k, String v) { put.put(k, v); return this; }
                @Override public Editor putStringSet(String k, Set<String> v) { return this; }
                @Override public Editor putInt(String k, int v) { put.put(k, v); return this; }
                @Override public Editor putLong(String k, long v) { return this; }
                @Override public Editor putFloat(String k, float v) { return this; }
                @Override public Editor putBoolean(String k, boolean v) { return this; }
                @Override public Editor remove(String k) { rm.add(k); return this; }
                @Override public Editor clear() { return this; }
                @Override public boolean commit() { apply(); return true; }
                @Override public void apply() { for (String k : rm) m.remove(k); m.putAll(put); }
            };
        }
    }

    static Context context(Prefs p) {
        Context c = mock(Context.class);
        when(c.getSharedPreferences(WidgetStore.PREFS, Context.MODE_PRIVATE)).thenReturn(p);
        return c;
    }

    @Test
    public void theRealFlipRotatesThePages_andNotifiesADataChange_notAPartialUpdate() {
        Prefs p = new Prefs(); Context c = context(p); AppWidgetManager m = mock(AppWidgetManager.class);
        new TrinityWidgetProvider().host(c, m).flip(9);
        assertEquals(1, WidgetStore.rotation(c, 9, ""));
        verify(m).notifyAppWidgetViewDataChanged(new int[] { 9 }, R.id.trinity_widget_stack);
        verify(m, never()).partiallyUpdateAppWidget(anyInt(), any(RemoteViews.class));
        new TrinityWidgetProvider().host(c, m).flip(9);
        assertEquals(2, WidgetStore.rotation(c, 9, ""));
        assertEquals(0, WidgetStore.rotation(c, 12, ""));
    }

    @Test
    public void eachFlipShowsTheOtherPageAtWhateverIndexTheStackIsOn() {
        // Two pages, logical 0 = most current. The stack shows index 0 or (after a swipe) index 1; a flip swaps it.
        for (int shownIndex = 0; shownIndex < 2; shownIndex++) {
            int before = WidgetStore.logical(shownIndex, 0, 2), after = WidgetStore.logical(shownIndex, 1, 2), again = WidgetStore.logical(shownIndex, 2, 2);
            assertEquals(1 - before, after);
            assertEquals(before, again);
        }
        assertEquals(0, WidgetStore.logical(0, 5, 1));   // one page: nothing to flip to
    }

    @Test
    public void aRotationMadeAgainstAnotherPageSetIsIgnoredAndCleared() {
        // re-audit E-2 of cfc3fd22: the page set changes before the next full redraw clears the flip in drawAll.
        Prefs p = new Prefs(); Context c = context(p);
        String a = "P|Numbers 7\nV|John 3:16\n", b = "P|Psalms 23\nV|John 3:16\n";
        WidgetStore.rotate(c, 9, a);
        assertEquals(1, WidgetStore.rotation(c, 9, a));
        assertEquals("a stale rotation was applied to a new page set", 0, WidgetStore.rotation(c, 9, b));
        assertEquals("the stale rotation was not cleared", 0, WidgetStore.rotation(c, 9, a));
        WidgetStore.rotate(c, 9, b);
        assertEquals(1, WidgetStore.rotation(c, 9, b));
    }

    @Test
    public void aPageSetChangeClearsTheFlip_andForgettingClearsIt() {
        Prefs p = new Prefs(); Context c = context(p); AppWidgetManager m = mock(AppWidgetManager.class);
        TrinityWidgetProvider.Host h = new TrinityWidgetProvider().host(c, m);
        h.flip(9); h.clearFlip(9);
        assertEquals(0, WidgetStore.rotation(c, 9, ""));
        h.flip(9); WidgetStore.forgetOrder(c, 9);
        assertEquals(0, WidgetStore.rotation(c, 9, ""));
        h.flip(9); h.flip(12); WidgetStore.recordOrder(c, 9, "V|x\n"); WidgetStore.forgetAllOrders(c);
        assertEquals(0, WidgetStore.rotation(c, 9, ""));
        assertEquals(0, WidgetStore.rotation(c, 12, ""));
        assertEquals(null, WidgetStore.shownOrder(c, 9));
    }
}
