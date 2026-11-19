package church.trinityone.widget;

import static org.junit.Assert.assertTrue;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.junit.Test;

/**
 * Crash 2026-11-19 (Pixel 10 Pro, Android 16, versionCode 224): PromptFetchJob schedules with a connectivity
 * constraint, and Android 16 throws SecurityException from JobScheduler.schedule unless the app holds
 * ACCESS_NETWORK_STATE. The member app's own manifest has only INTERNET and CAMERA, so the permission must come from
 * THIS plugin's manifest, which the manifest merger folds into every APK the shared android/ project builds.
 * Parsed as XML with comments dropped (Xml.doc), so a commented-out line does not satisfy it.
 */
public class ManifestPermissionTest {
    @Test
    public void thePluginManifestDeclaresAccessNetworkState() throws Exception {
        Document d = Xml.doc("src/main/AndroidManifest.xml");
        NodeList ps = d.getDocumentElement().getElementsByTagName("uses-permission");
        boolean found = false;
        for (int i = 0; i < ps.getLength(); i++) {
            Element e = (Element) ps.item(i);
            // a direct child of <manifest>: a uses-permission anywhere else is ignored by the merger
            if (e.getParentNode() == d.getDocumentElement()
                    && "android.permission.ACCESS_NETWORK_STATE".equals(e.getAttribute("android:name"))) found = true;
        }
        assertTrue("ACCESS_NETWORK_STATE missing from the widget plugin manifest: PromptFetchJob crashes Android 16", found);
    }
}
