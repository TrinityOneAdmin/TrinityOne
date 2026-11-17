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
    public void the180dpCardAtNormalFontGetsFourLinesAtTwelveSp() {
        // (180-12)*0.9-24 = 127.2; - header 28 - ref 21 - slack 8 = 70.2; / 15 = 4.68 -> 4
        assertEquals(4, WidgetStore.verseLines(180, 1f, 12f));
    }
}
