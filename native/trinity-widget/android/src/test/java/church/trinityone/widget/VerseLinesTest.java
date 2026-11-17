package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * WidgetStore.verseLines: the verse's maxLines for a widget height. Arithmetic only — whether the lines really fit
 * on a given launcher is a device check (it cannot be measured off-device: no layoutlib here).
 */
public class VerseLinesTest {
    @Test
    public void aLauncherThatReportsNoSizeGetsFour() {
        assertEquals(4, WidgetStore.verseLines(0, 1f, 12f));
    }

    @Test
    public void taller_moreLines_largerFont_fewer_neverBelowOneOrAboveTwelve() {
        int small = WidgetStore.verseLines(110, 1f, 12f), mid = WidgetStore.verseLines(180, 1f, 12f), big = WidgetStore.verseLines(400, 1f, 12f);
        assertTrue(small + " < " + mid, small < mid);
        assertTrue(mid + " < " + big, mid < big);
        assertTrue(WidgetStore.verseLines(180, 1.3f, 12f) < mid);
        assertTrue(WidgetStore.verseLines(180, 1f, 15f) <= mid);
        assertEquals(1, WidgetStore.verseLines(60, 2f, 15f));
        assertEquals(12, WidgetStore.verseLines(5000, 1f, 12f));
    }

    @Test
    public void theReclaimedTopGoesToTheVerse() {
        // Dots branch, 2026-11-17: the front page's top = 0.1 x (h + 10) - 10; padding 10+10; gaps 6 and 4.
        // 180dp: top 9, page 151, - header 26 - ref 19 - slack 8 = 98 / 15 = 6.53 -> 6   (before: 4)
        assertEquals(6, WidgetStore.verseLines(180, 1f, 12f));
        // 218dp (the owner's Oppo card): top 12.8, page 185.2, - 53 = 132.2 / 15 = 8.8 -> 8   (before: 6)
        assertEquals(8, WidgetStore.verseLines(218, 1f, 12f));
        // 110dp (the declared minimum): top 2, page 88, - 53 = 35 / 15 = 2.3 -> 2   (before: 1)
        assertEquals(2, WidgetStore.verseLines(110, 1f, 12f));
    }

    @Test
    public void theLayoutNumbersVerseLinesMirrorsAreTheLayouts() throws Exception {
        // verseLines assumes these; if a layout changes and this does not, the line count lies. PARSED (audit D-4).
        org.w3c.dom.Document root = Xml.layout("trinity_widget"), item = Xml.layout("trinity_widget_item");
        assertEquals(-WidgetStore.STACK_PULL_UP_DP, Xml.dp(Xml.byId(root, "trinity_widget_stack"), "layout_marginTop"), 0f);
        assertEquals(WidgetStore.PAGE_PAD_V_DP, Xml.dp(Xml.root(item), "paddingTop"), 0f);
        assertEquals(WidgetStore.PAGE_PAD_V_DP, Xml.dp(Xml.root(item), "paddingBottom"), 0f);
        assertEquals(WidgetStore.TEXT_GAP_DP, Xml.dp(Xml.byId(item, "trinity_widget_text"), "layout_marginTop"), 0f);
        assertEquals(WidgetStore.REF_GAP_DP, Xml.dp(Xml.byId(item, "trinity_widget_ref"), "layout_marginTop"), 0f);
    }
}
