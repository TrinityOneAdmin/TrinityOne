package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.widget.RemoteViews;

import org.json.JSONObject;
import org.junit.Test;
import org.mockito.MockedConstruction;

/**
 * The FACTORY's side of tap-to-flip (device D-1): TrinityWidgetService.Factory.getViewAt itself, after a flip, puts
 * the other page at the stack's index and lights THAT page's own dot. RemoteViews is constructed as a Mockito mock
 * (off-device it is an android.jar stub); prefs are FlipTest's in-memory SharedPreferences.
 */
public class FactoryFlipTest {
    static final String NPUB = "npub1" + "q".repeat(58);

    static Context context(FlipTest.Prefs p) throws Exception {
        Context c = FlipTest.context(p);
        Resources r = mock(Resources.class);
        when(r.getConfiguration()).thenReturn(new Configuration());
        when(c.getResources()).thenReturn(r);
        when(c.getPackageName()).thenReturn("com.trinityone.app");
        when(c.getString(R.string.trinity_widget_votd)).thenReturn("Verse of the day");
        when(c.getString(R.string.trinity_widget_prompt)).thenReturn("Your church is reading");
        when(c.getString(R.string.trinity_widget_tap_to_read)).thenReturn("Tap to read");
        long now = System.currentTimeMillis();
        JSONObject days = new JSONObject().put(WidgetStore.localDate(now), new JSONObject().put("ref", "John 3:16").put("text", "For God so loved"));
        p.m.put(WidgetStore.K_VOTD, new JSONObject().put("days", days).toString());
        p.m.put(WidgetStore.K_PROMPT, new JSONObject().put("npub", NPUB).put("validUntil", now / 1000 + 86400)
                .put("texts", new JSONObject().put("Numbers 7", "On the day Moses"))
                .put("cached", new JSONObject().put("ts", now / 1000 - 1).put("ref", "Numbers 7").put("schedule", new org.json.JSONArray())).toString());
        return c;
    }

    @Test
    public void afterAFlipTheStacksIndexHoldsTheOtherPage_withItsOwnDotLit() throws Exception {
        FlipTest.Prefs p = new FlipTest.Prefs(); Context c = context(p);
        TrinityWidgetService.Factory f = new TrinityWidgetService.Factory(c, 9);
        f.onDataSetChanged();
        assertEquals(2, f.getCount());
        try (MockedConstruction<RemoteViews> rv = mockConstruction(RemoteViews.class)) {
            f.getViewAt(0);
            RemoteViews v = rv.constructed().get(0);
            verify(v).setTextViewText(R.id.trinity_widget_text, "On the day Moses");
            verify(v).setImageViewResource(R.id.trinity_widget_dot0, R.drawable.trinity_widget_dot_on);
        }
        WidgetStore.rotate(c, 9);     // what a tap on the dots does (FlipTest drives it through the provider)
        f.onDataSetChanged();         // what the data-changed notice makes the launcher ask for
        try (MockedConstruction<RemoteViews> rv = mockConstruction(RemoteViews.class)) {
            f.getViewAt(0);
            RemoteViews v = rv.constructed().get(0);
            verify(v).setTextViewText(R.id.trinity_widget_text, "For God so loved");
            verify(v).setTextViewText(R.id.trinity_widget_label, "Verse of the day");
            verify(v).setImageViewResource(R.id.trinity_widget_dot1, R.drawable.trinity_widget_dot_on);
            verify(v).setImageViewResource(R.id.trinity_widget_dot0, R.drawable.trinity_widget_dot_off);
        }
    }
}
