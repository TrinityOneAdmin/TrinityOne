package church.trinityone.widget;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * TrinityWidgetProvider.drawAll — what onUpdate runs — with a recording host (re-audit R2 of c0c78163): page 0 is
 * asked for in the full update AND by a partial update after the data-changed notice, and the order is recorded only
 * after both; a widget whose update threw is not recorded (the next update tries again); an unchanged order asks for
 * nothing. What the launcher does with the requests is a device check.
 */
public class DrawOrderTest {
    static final class Rec implements TrinityWidgetProvider.Host {
        final List<String> log = new ArrayList<>(); final Map<Integer, String> shown = new HashMap<>(); int failId = -1;
        @Override public String shownOrder(int id) { return shown.get(id); }
        @Override public void update(int id, boolean front) { if (id == failId) throw new RuntimeException("TransactionTooLarge"); log.add("update " + id + (front ? " front" : "")); }
        @Override public void dataChanged(int[] ids) { log.add("dataChanged " + Arrays.toString(ids)); }
        @Override public void front(int id) { log.add("front " + id); }
        @Override public void recordOrder(int id, String order) { log.add("record " + id); shown.put(id, order); }
    }

    @Test
    public void onUpdateItselfDrawsThroughDrawAll() {
        // re-audit N-b of d6f0e32c: the real onUpdate, with only its three Android seams swapped.
        final Rec h = new Rec(); final List<String> after = new ArrayList<>();
        TrinityWidgetProvider p = new TrinityWidgetProvider() {
            @Override String orderNow(android.content.Context c, long now) { return "V|John 3:16\n"; }
            @Override Host host(android.content.Context c, android.appwidget.AppWidgetManager m) { return h; }
            @Override void afterDraw(android.content.Context c, long now) { after.add("after"); }
        };
        p.onUpdate(null, null, new int[] { 9 });
        assertEquals(List.of("update 9 front", "dataChanged [9]", "front 9", "record 9"), h.log);
        assertEquals(List.of("after"), after);
    }

    @Test
    public void aChangedOrderAsksForPageZeroTwice_andIsRecordedOnlyAfter() {
        Rec h = new Rec();
        TrinityWidgetProvider.drawAll(h, new int[] { 9 }, "P|Numbers 7\nV|John 3:16\n");
        assertEquals(List.of("update 9 front", "dataChanged [9]", "front 9", "record 9"), h.log);
    }

    @Test
    public void anUnchangedOrderLeavesTheMembersSwipeAlone() {
        Rec h = new Rec(); h.shown.put(9, "P|Numbers 7\nV|John 3:16\n");
        TrinityWidgetProvider.drawAll(h, new int[] { 9 }, "P|Numbers 7\nV|John 3:16\n");
        assertEquals(List.of("update 9", "dataChanged [9]"), h.log);
    }

    @Test
    public void aWidgetWhoseUpdateFailedIsNotRecorded_soTheNextUpdateTriesAgain() {
        Rec h = new Rec(); h.failId = 9;
        TrinityWidgetProvider.drawAll(h, new int[] { 9, 12 }, "V|John 3:16\n");
        assertEquals(List.of("update 12 front", "dataChanged [12]", "front 12", "record 12"), h.log);
        h.failId = -1; h.log.clear();
        TrinityWidgetProvider.drawAll(h, new int[] { 9, 12 }, "V|John 3:16\n");
        assertEquals(List.of("update 9 front", "update 12", "dataChanged [9, 12]", "front 9", "record 9"), h.log);
    }
}
