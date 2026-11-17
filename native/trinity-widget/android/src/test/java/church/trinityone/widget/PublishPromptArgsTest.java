package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * TrinityWidgetPlugin.publishPrompt's argument parsing, run against a REAL Capacitor PluginCall built the way the
 * bridge builds one: from the JSON text the webview sends, parsed by org.json. Device-found 2026-11-17 (Oppo):
 * publishPrompt read validUntil with call.getLong, which returns its default for an Integer; 1795510000 parses as an
 * Integer; the stored validUntil was 0 and WidgetStore.promptConfig deleted the config at the next redraw.
 *
 * Run: cd android && ./gradlew --offline :trinityone-widget:testDebugUnitTest
 * Covers TrinityWidgetPlugin.promptArgs (everything publishPrompt does before it writes). Does NOT cover the
 * Context-bound tail (WidgetStore.write / schedule / refresh) — that needs a device.
 */
public class PublishPromptArgsTest {
    static final String NPUB = "npub1" + "q".repeat(58);
    static final long UNTIL = 1795510000L;                       // what Today sends: unix seconds, fits in an int
    static final long NOW_MS = (UNTIL - 7L * 86400L) * 1000L;    // a week before it, as Today computes it

    /** What the bridge does with the webview's message: org.json parses the JSON text. */
    static PluginCall bridgeCall(String json) throws Exception {
        return new PluginCall(null, "TrinityWidget", "cb1", "publishPrompt", new JSObject(json));
    }

    static String args(String validUntilJson) {
        return "{\"npub\":\"" + NPUB + "\",\"bases\":[\"https://box.example\"],"
                + (validUntilJson == null ? "" : "\"validUntil\":" + validUntilJson + ",")
                + "\"texts\":{\"John 3:16\":\"For God so loved\"},"
                + "\"cached\":{\"ts\":1795400000,\"ref\":\"John 3:16\",\"note\":\"PRIVATE\","
                + "\"schedule\":[{\"at\":1795400000,\"ref\":\"John 3:16\",\"note\":\"PRIVATE\"}]}}";
    }

    @Test
    public void theInstrument_aSecondsValueReachesThePluginAsAnInteger_soGetLongMissesIt() throws Exception {
        PluginCall c = bridgeCall(args(Long.toString(UNTIL)));
        assertTrue("the bridge's parser no longer yields an Integer here; this test's premise needs rechecking",
                c.getData().opt("validUntil") instanceof Integer);
        assertEquals("PluginCall.getLong no longer misses an Integer; the trap this guards may be gone",
                Long.valueOf(0L), c.getLong("validUntil", 0L));
    }

    @Test
    public void theRealValidUntilIsStored_notZero() throws Exception {
        JSONObject p = TrinityWidgetPlugin.promptArgs(bridgeCall(args(Long.toString(UNTIL))), NOW_MS);
        assertEquals("publishPrompt stored the wrong validUntil (0 = the device bug: the config is deleted at the next redraw)",
                UNTIL, p.getLong("validUntil"));
        assertEquals(NPUB, p.getString("npub"));
        assertEquals("https://box.example", p.getJSONArray("bases").getString(0));
    }

    @Test
    public void aLongSizedAndAFractionalValueAreBothRead() throws Exception {
        long big = 4102444800L;   // 2100-01-01: past 2^31, so the parser yields a Long
        JSONObject p = TrinityWidgetPlugin.promptArgs(bridgeCall(args(Long.toString(big))), (big - 86400L) * 1000L);
        assertEquals(big, p.getLong("validUntil"));
        PluginCall c = bridgeCall(args(null));
        c.getData().put("validUntil", 1795510000.75d);   // a Double, as Android's org.json yields for "1795510000.75"
        assertEquals(UNTIL, TrinityWidgetPlugin.promptArgs(c, NOW_MS).getLong("validUntil"));
    }

    @Test
    public void aMissingPastZeroStringOrMillisecondValidUntilIsRefused_notStoredAsSuccess() throws Exception {
        String[] bad = { null, "0", "-5", "\"1795510000\"", "null", Long.toString(UNTIL * 1000L), Long.toString(UNTIL) };
        long[] now = { NOW_MS, NOW_MS, NOW_MS, NOW_MS, NOW_MS, NOW_MS, UNTIL * 1000L /* exactly expired */ };
        for (int i = 0; i < bad.length; i++) {
            try {
                TrinityWidgetPlugin.promptArgs(bridgeCall(args(bad[i])), now[i]);
                fail("validUntil " + bad[i] + " was accepted");
            } catch (IllegalArgumentException e) {
                assertEquals("bad validUntil", e.getMessage());
            }
        }
    }

    @Test
    public void aBadNpubIsRefused() throws Exception {
        try {
            TrinityWidgetPlugin.promptArgs(bridgeCall(args(Long.toString(UNTIL)).replace(NPUB, "npub1short")), NOW_MS);
            fail("a bad npub was accepted");
        } catch (IllegalArgumentException e) { assertEquals("bad npub", e.getMessage()); }
    }

    @Test
    public void theCachedCopyKeepsItsIntegerTimes_andLosesTheNote() throws Exception {
        JSONObject p = TrinityWidgetPlugin.promptArgs(bridgeCall(args(Long.toString(UNTIL))), NOW_MS);
        JSONObject cached = p.getJSONObject("cached");
        assertEquals(1795400000L, cached.getLong("ts"));
        JSONArray sch = cached.getJSONArray("schedule");
        assertEquals(1, sch.length());
        assertEquals(1795400000L, sch.getJSONObject(0).getLong("at"));
        assertFalse("the note crossed into widget storage", cached.has("note"));
        assertFalse("the note crossed into widget storage", sch.getJSONObject(0).has("note"));
        assertEquals("For God so loved", p.getJSONObject("texts").getString("John 3:16"));
    }

    @Test
    public void secondsReadsEveryNumberTypeAndNothingElse() throws Exception {
        JSONObject d = new JSONObject();
        d.put("i", 5); d.put("l", 5L); d.put("d", 5.9d); d.put("s", "5");
        assertEquals(5L, TrinityWidgetPlugin.seconds(d, "i"));
        assertEquals(5L, TrinityWidgetPlugin.seconds(d, "l"));
        assertEquals(5L, TrinityWidgetPlugin.seconds(d, "d"));
        assertEquals(0L, TrinityWidgetPlugin.seconds(d, "s"));
        assertEquals(0L, TrinityWidgetPlugin.seconds(d, "missing"));
        assertEquals(0L, TrinityWidgetPlugin.seconds(null, "i"));
        assertNull(d.opt("missing"));
    }
}
