package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * TrinityWidgetPlugin.publishPrompt ITSELF — the @PluginMethod the app calls — run off-device (audit M1 of eab4bf9b:
 * the promptArgs tests stayed green when publishPrompt stopped calling promptArgs and read getLong inline). The
 * plugin is a real TrinityWidgetPlugin with only its store and clock swapped; the call is a real PluginCall built
 * from JSON text as the bridge builds it, with resolve/reject captured (there is no bridge to answer to).
 * Not covered: the real store (SharedPreferences, JobScheduler, the redraw broadcast) — a device check.
 */
public class PublishPromptTest {
    static final String NPUB = "npub1" + "q".repeat(58);
    static final long UNTIL = 1795510000L;
    static final long NOW_MS = (UNTIL - 7L * 86400L) * 1000L;

    static final class Call extends PluginCall {
        String rejected; boolean resolved;
        Call(String json) throws Exception { super(null, "TrinityWidget", "cb1", "publishPrompt", new JSObject(json)); }
        @Override public void resolve() { resolved = true; }
        @Override public void reject(String msg) { rejected = msg; }
    }

    static final class Plugin extends TrinityWidgetPlugin {
        final List<String> log = new ArrayList<>(); JSONObject written;
        @Override PromptStore promptStore() {
            return new PromptStore() {
                @Override public JSONObject read() { log.add("read"); return null; }
                @Override public void write(JSONObject cfg) { written = cfg; log.add("write"); }
                @Override public void schedule() { log.add("schedule"); }
                @Override public void refresh() { log.add("refresh"); }
            };
        }
        @Override long nowMs() { return NOW_MS; }
    }

    static String args(String until) {
        return "{\"npub\":\"" + NPUB + "\",\"bases\":[\"https://box.example\"],\"validUntil\":" + until
                + ",\"texts\":{},\"cached\":{\"ts\":1795400000,\"ref\":\"Numbers 7\",\"note\":\"PRIVATE\",\"schedule\":[]}}";
    }

    @Test
    public void publishPromptStoresTheRealValidUntil_andResolves() throws Exception {
        Plugin p = new Plugin(); Call c = new Call(args(Long.toString(UNTIL)));
        assertTrue("premise: the bridge hands validUntil over as an Integer", c.getData().opt("validUntil") instanceof Integer);
        p.publishPrompt(c);
        assertNull("publishPrompt refused a good config: " + c.rejected, c.rejected);
        assertTrue(c.resolved);
        assertEquals("publishPrompt stored the wrong validUntil (0 = the device bug: the config is deleted at the next redraw)",
                UNTIL, p.written.getLong("validUntil"));
        assertEquals(List.of("write", "schedule", "refresh"), p.log);
        assertTrue("the note crossed into widget storage", !p.written.getJSONObject("cached").has("note"));
    }

    @Test
    public void publishPromptRejectsAnUnboundableValidUntil_andWritesNothing() throws Exception {
        for (String bad : new String[] { "0", "\"1795510000\"", Long.toString(UNTIL * 1000L) }) {
            Plugin p = new Plugin(); Call c = new Call(args(bad));
            p.publishPrompt(c);
            assertEquals("validUntil " + bad, "bad validUntil", c.rejected);
            assertTrue(!c.resolved && p.written == null && p.log.isEmpty());
        }
    }
}
