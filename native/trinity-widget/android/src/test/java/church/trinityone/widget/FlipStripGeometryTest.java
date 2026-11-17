package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * Audit D-1 of 1bbab650 + device D-2: from the PARSED layouts, for every card width 180-480dp, the tap-to-flip strip
 * covers the dots and does not reach the verse's last words; and the page BEHIND the front one (StackView draws it
 * ~(1 - 2/3) x 10% of the stack's width further right) keeps its dots hidden behind the front page. Arithmetic over the
 * real attribute values, using AOSP StackView's 90% page width; what the launcher draws is a device check.
 */
public class FlipStripGeometryTest {
    @Test
    public void theStripCoversTheDotsAndNotTheVerse_andTheBackPagesDotsStayHidden() throws Exception {
        Document root = Xml.layout("trinity_widget"), item = Xml.layout("trinity_widget_item");
        Element stack = Xml.byId(root, "trinity_widget_stack"), strip = Xml.byId(root, "trinity_widget_flip");
        Element spacer = (Element) strip.getParentNode().getFirstChild().getNextSibling();
        while (spacer != null && spacer.getAttribute("android:layout_weight").isEmpty()) spacer = (Element) spacer.getNextSibling();
        Element page = Xml.root(item), dots = Xml.byId(item, "trinity_widget_dots"), dot0 = Xml.byId(item, "trinity_widget_dot0");
        assertEquals(0f, Xml.dp(Xml.root(root), "padding"), 0f);
        float widen = -Xml.dp(stack, "layout_marginEnd"), padEnd = Xml.dp(page, "paddingEnd");
        float dotW = Xml.dp(dot0, "layout_width"), gap = Xml.dp(dots, "layout_marginStart");
        float wS = Xml.num(spacer, "layout_weight"), wF = Xml.num(strip, "layout_weight"), mF = Xml.dp(strip, "layout_marginStart");
        for (int card = 180; card <= 480; card += 5) {
            float stackW = card + widen, pageRight = 0.9f * stackW;
            float dotsRight = pageRight - padEnd, dotsLeft = dotsRight - dotW, verseRight = dotsLeft - gap;
            float stripLeft = (card - mF) * wS / (wS + wF) + mF;
            assertTrue(card + "dp: the strip (from " + stripLeft + ") misses the dots (from " + dotsLeft + ")", stripLeft <= dotsLeft);
            assertTrue(card + "dp: the strip (from " + stripLeft + ") covers the verse (to " + verseRight + ")", stripLeft >= verseRight);
            float backOffset = (1f - 2f / 3f) * 0.1f * stackW;
            assertTrue(card + "dp: the back page's dots (to " + (dotsRight + backOffset) + ") peek past the front page (" + pageRight + ")",
                    dotsRight + backOffset <= pageRight);
        }
    }
}
