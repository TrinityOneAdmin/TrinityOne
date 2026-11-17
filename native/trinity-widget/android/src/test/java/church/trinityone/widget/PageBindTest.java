package church.trinityone.widget;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Page dots (owner chose option A, 2026-11-17): WidgetStore.bindPage, exactly what TrinityWidgetService.getViewAt runs,
 * with a recording binder. Each page lights its OWN index, so the dots are right whichever page is in front; one page
 * shows no dots; the label is the page's own, with no "Swipe for more". The RemoteViews calls behind the binder are
 * a device check.
 */
public class PageBindTest {
    static final class Rec implements WidgetStore.PageBinder {
        final List<String> log = new ArrayList<>();
        @Override public void label(String s) { log.add("label " + s); }
        @Override public void text(String s, int n) { log.add("text " + s + " /" + n); }
        @Override public void ref(String s) { log.add("ref " + s); }
        @Override public void dotsShown(boolean shown) { log.add("dots " + (shown ? "shown" : "gone")); }
        @Override public void dot(int slot, int state) { log.add("dot" + slot + " " + new String[] { "hidden", "off", "ON" }[state]); }
    }
    static final WidgetStore.Page CHURCH = new WidgetStore.Page(true, "Your church is reading", "Numbers 7", "On the day");
    static final WidgetStore.Page VOTD = new WidgetStore.Page(false, "Verse of the day", "John 3:16", "For God");

    @Test
    public void twoPages_eachLightsItsOwnDot() {
        Rec a = new Rec(); WidgetStore.bindPage(a, CHURCH, 0, 2, 8);
        assertEquals(List.of("label Your church is reading", "text On the day /8", "ref Numbers 7", "dots shown", "dot0 ON", "dot1 off"), a.log);
        Rec b = new Rec(); WidgetStore.bindPage(b, VOTD, 1, 2, 8);
        assertEquals(List.of("label Verse of the day", "text For God /8", "ref John 3:16", "dots shown", "dot0 off", "dot1 ON"), b.log);
    }

    @Test
    public void onePage_noDots_andNoSwipeText() {
        Rec a = new Rec(); WidgetStore.bindPage(a, VOTD, 0, 1, 6);
        assertEquals(List.of("label Verse of the day", "text For God /6", "ref John 3:16", "dots gone", "dot0 hidden", "dot1 hidden"), a.log);
    }

    @Test
    public void theChurchPagesLabelIsYourChurchIsReading() throws Exception {
        String s = new String(Files.readAllBytes(Paths.get("src/main/res/values/trinity_widget_strings.xml")), "UTF-8");
        assertEquals(1, s.split("<string name=\"trinity_widget_prompt\">Your church is reading</string>", -1).length - 1);
        assertEquals("the old swipe text is still a resource", -1, s.indexOf("Swipe for more"));
    }
}
