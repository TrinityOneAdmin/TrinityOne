package church.trinityone.widget;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.io.File;

/**
 * Re-audit E-1 of cfc3fd22: the app declares supportsRtl, and a mirrored widget puts the widen, the dots and the flip
 * strip on the wrong side. EVERY widget layout's root is pinned left-to-right — read from the PARSED XML.
 */
public class LayoutDirectionTest {
    @Test
    public void everyWidgetLayoutRootIsLeftToRight() throws Exception {
        File[] layouts = new File("src/main/res/layout").listFiles((d, n) -> n.startsWith("trinity_widget") && n.endsWith(".xml"));
        assertEquals("expected the two widget layouts", 2, layouts.length);
        for (File f : layouts)
            assertEquals(f.getName(), "ltr", Xml.root(Xml.doc(f.getPath())).getAttribute("android:layoutDirection"));
    }
}
