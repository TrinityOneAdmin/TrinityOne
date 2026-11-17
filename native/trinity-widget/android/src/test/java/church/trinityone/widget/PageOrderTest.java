package church.trinityone.widget;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/**
 * Device D2 (2026-11-17): the provider puts page 0 back in front only when WidgetStore.pageOrder changes. This tests
 * the decision. The RemoteViews.setDisplayedChild call itself, and what StackView does with it, are device checks.
 */
public class PageOrderTest {
    static WidgetStore.Page prompt(String ref) { return new WidgetStore.Page(true, "From your church", ref, "x"); }
    static WidgetStore.Page votd(String ref) { return new WidgetStore.Page(false, "Verse of the day", ref, "y"); }

    @Test
    public void aFirstDrawAndAnyChangeOfSetOrOrderPutPageZeroInFront() {
        String pv = WidgetStore.pageOrder(List.of(prompt("Numbers 7"), votd("John 3:16")));
        assertTrue("a widget never drawn must start at page 0", WidgetStore.frontNeedsReset(null, pv));
        assertTrue("order flipped", WidgetStore.frontNeedsReset(WidgetStore.pageOrder(List.of(votd("John 3:16"), prompt("Numbers 7"))), pv));
        assertTrue("a new daily verse", WidgetStore.frontNeedsReset(WidgetStore.pageOrder(List.of(prompt("Numbers 7"), votd("John 1:1"))), pv));
        assertTrue("the prompt arrived", WidgetStore.frontNeedsReset(WidgetStore.pageOrder(List.of(votd("John 3:16"))), pv));
        assertNotEquals(WidgetStore.pageOrder(List.of(prompt("A"))), WidgetStore.pageOrder(List.of(votd("A"))));
    }

    @Test
    public void aRedrawThatChangesNothingLeavesTheMembersSwipeAlone() {
        String a = WidgetStore.pageOrder(List.of(prompt("Numbers 7"), votd("John 3:16")));
        String b = WidgetStore.pageOrder(List.of(prompt("Numbers 7"), votd("John 3:16")));
        assertFalse(WidgetStore.frontNeedsReset(a, b));
    }
}
