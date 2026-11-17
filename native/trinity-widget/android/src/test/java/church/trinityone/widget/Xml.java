package church.trinityone.widget;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.File;

import javax.xml.parsers.DocumentBuilderFactory;

/**
 * Parsed resource XML for the tests (audit D-4 of 1bbab650): a text match over the file can be satisfied by an XML
 * COMMENT; the DOM parser drops comments, so these read only real attributes and real string values.
 */
final class Xml {
    private Xml() {}

    static Document doc(String path) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setIgnoringComments(true);
        return f.newDocumentBuilder().parse(new File(path));
    }

    static Document layout(String name) throws Exception { return doc("src/main/res/layout/" + name + ".xml"); }

    static Element root(Document d) { return d.getDocumentElement(); }

    static Element byId(Document d, String id) {
        NodeList all = d.getElementsByTagName("*");
        for (int i = 0; i < all.getLength(); i++) {
            Element e = (Element) all.item(i);
            if (("@+id/" + id).equals(e.getAttribute("android:id"))) return e;
        }
        throw new AssertionError("no view with id " + id);
    }

    /** "-10dp" -> -10. Missing -> 0. */
    static float dp(Element e, String attr) {
        String v = e.getAttribute("android:" + attr);
        if (v.isEmpty()) return 0f;
        if (!v.endsWith("dp")) throw new AssertionError(attr + "=" + v + " is not in dp");
        return Float.parseFloat(v.substring(0, v.length() - 2));
    }

    static float num(Element e, String attr) { String v = e.getAttribute("android:" + attr); return v.isEmpty() ? 0f : Float.parseFloat(v); }

    static String string(String name) throws Exception {
        NodeList all = doc("src/main/res/values/trinity_widget_strings.xml").getElementsByTagName("string");
        for (int i = 0; i < all.getLength(); i++) {
            Element e = (Element) all.item(i);
            if (name.equals(e.getAttribute("name"))) return e.getTextContent();
        }
        return null;
    }

    static boolean anyStringContains(String text) throws Exception {
        NodeList all = doc("src/main/res/values/trinity_widget_strings.xml").getElementsByTagName("string");
        for (int i = 0; i < all.getLength(); i++) if (all.item(i).getTextContent().contains(text)) return true;
        return false;
    }
}
