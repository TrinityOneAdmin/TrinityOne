package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * Re-audit S1 of d6f0e32c. TrinityWidgetPlugin.publishTexts ITSELF (real plugin, store swapped) changes ONLY the
 * texts of the stored config, and only for the same church; and PromptFetchJob.applyFetch applies a background
 * fetch to the config as stored NOW, touching only "cached". Not covered: the real SharedPreferences / network.
 */
public class PublishTextsTest {
    static final String NPUB = "npub1" + "q".repeat(58);
    static final String OTHER = "npub1" + "p".repeat(58);

    static final class Call extends PluginCall {
        String rejected; JSObject resolved;
        Call(String json) throws Exception { super(null, "TrinityWidget", "cb1", "publishTexts", new JSObject(json)); }
        @Override public void resolve(JSObject data) { resolved = data; }
        @Override public void reject(String msg) { rejected = msg; }
    }

    static final class Plugin extends TrinityWidgetPlugin {
        JSONObject stored; final List<String> log = new ArrayList<>();
        @Override PromptStore promptStore() {
            return new PromptStore() {
                @Override public JSONObject read() { try { return stored == null ? null : new JSONObject(stored.toString()); } catch (Exception e) { return null; } }
                @Override public void write(JSONObject cfg) { stored = cfg; log.add("write"); }
                @Override public void schedule() { log.add("schedule"); }
                @Override public void refresh() { log.add("refresh"); }
            };
        }
    }

    static JSONObject config(String npub, Object cached) throws Exception {
        return new JSONObject("{\"npub\":\"" + npub + "\",\"bases\":[\"https://a8.example\"],\"validUntil\":1795510000,\"texts\":{},\"cached\":"
                + (cached == null ? "null" : cached.toString()) + "}");
    }
    static String call(String npub) { return "{\"npub\":\"" + npub + "\",\"texts\":{\"Numbers 7\":\"On the day Moses finished\"}}"; }

    @Test
    public void onlyTheTextsChange_theNewerOrWithdrawnCopyTheJobStoredStays() throws Exception {
        Plugin p = new Plugin();
        p.stored = config(NPUB, null);   // the background job found the copy withdrawn (404 everywhere) and stored null
        Call c = new Call(call(NPUB));
        p.publishTexts(c);
        assertNull(c.rejected);
        assertTrue(c.resolved.getBoolean("updated"));
        assertEquals("On the day Moses finished", p.stored.getJSONObject("texts").getString("Numbers 7"));
        assertTrue("publishTexts put a copy back", p.stored.isNull("cached"));
        assertEquals(1795510000L, p.stored.getLong("validUntil"));
        assertEquals("https://a8.example", p.stored.getJSONArray("bases").getString(0));
        assertEquals(List.of("write", "refresh"), p.log);
    }

    @Test
    public void noConfigOrAnotherChurchsConfig_isLeftAlone() throws Exception {
        Plugin p = new Plugin();
        Call c = new Call(call(NPUB));
        p.publishTexts(c);
        assertFalse(c.resolved.getBoolean("updated"));
        assertNull(p.stored);
        p.stored = config(OTHER, null);
        String before = p.stored.toString();
        c = new Call(call(NPUB));
        p.publishTexts(c);
        assertFalse(c.resolved.getBoolean("updated"));
        assertEquals(before, p.stored.toString());
        assertTrue(p.log.isEmpty());
    }

    @Test
    public void aBadNpubOrMissingTextsIsRefused() throws Exception {
        Plugin p = new Plugin(); p.stored = config(NPUB, null);
        Call c = new Call(call("npub1short")); p.publishTexts(c); assertEquals("bad npub", c.rejected);
        c = new Call("{\"npub\":\"" + NPUB + "\"}"); p.publishTexts(c); assertEquals("bad texts", c.rejected);
        assertTrue(p.log.isEmpty());
    }

    static PromptFetchJob.Probe found(long ts) throws Exception {
        PromptFetchJob.Probe pr = new PromptFetchJob.Probe(); pr.saw200 = true; pr.best = new JSONObject("{\"ts\":" + ts + ",\"ref\":\"Numbers 7\",\"schedule\":[]}"); return pr;
    }

    @Test
    public void theBackgroundFetchChangesOnlyCached_ofTheConfigAsItIsNow() throws Exception {
        JSONObject now = config(NPUB, new JSONObject("{\"ts\":100,\"ref\":\"A\",\"schedule\":[]}"));
        now.getJSONObject("texts").put("Numbers 7", "kept");
        assertTrue(PromptFetchJob.applyFetch(now, NPUB, found(200)));
        assertEquals(200L, now.getJSONObject("cached").getLong("ts"));
        assertEquals("the fetch wiped texts the app wrote while it was on the network", "kept", now.getJSONObject("texts").getString("Numbers 7"));
        assertTrue(PromptFetchJob.applyFetch(now, NPUB, found(50)));
        assertEquals("an older copy replaced a newer one", 200L, now.getJSONObject("cached").getLong("ts"));
        PromptFetchJob.Probe gone = new PromptFetchJob.Probe(); gone.saw404 = true;
        assertTrue(PromptFetchJob.applyFetch(now, NPUB, gone));
        assertTrue(now.isNull("cached"));
        PromptFetchJob.Probe mixed = new PromptFetchJob.Probe(); mixed.saw404 = true; mixed.sawFail = true;
        assertFalse(PromptFetchJob.applyFetch(now, NPUB, mixed));
    }

    @Test
    public void aFetchForAChurchTheAppHasSwitchedAwayFromWritesNothing() throws Exception {
        assertFalse(PromptFetchJob.applyFetch(null, NPUB, found(200)));
        JSONObject other = config(OTHER, null);
        assertFalse(PromptFetchJob.applyFetch(other, NPUB, found(200)));
        assertTrue(other.isNull("cached"));
    }
}
