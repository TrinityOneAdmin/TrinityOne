package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * Re-audit X-a of e19bfb9d: every read and write of the stored prompt config by publishPrompt, publishTexts and the
 * background job's commit happens while WidgetStore.PROMPT_LOCK is held (the store records Thread.holdsLock at each
 * call). Not covered here: clearPrompt / forget / WidgetStore.promptConfig, which need a Context — their lock is a
 * one-line wrap, checked by reading only.
 */
public class PromptLockTest {
    static final String NPUB = "npub1" + "q".repeat(58);

    static final class Store implements TrinityWidgetPlugin.PromptStore {
        final List<String> log = new ArrayList<>(); JSONObject stored;
        private String held() { return Thread.holdsLock(WidgetStore.PROMPT_LOCK) ? "locked" : "UNLOCKED"; }
        @Override public JSONObject read() { log.add("read " + held()); try { return stored == null ? null : new JSONObject(stored.toString()); } catch (Exception e) { return null; } }
        @Override public void write(JSONObject cfg) { log.add("write " + held()); stored = cfg; }
        @Override public void schedule() {}
        @Override public void refresh() {}
    }

    static final class Plugin extends TrinityWidgetPlugin {
        final Store st = new Store();
        @Override PromptStore promptStore() { return st; }
        @Override long nowMs() { return (1795510000L - 86400L) * 1000L; }
    }

    static final class Call extends PluginCall {
        Call(String json) throws Exception { super(null, "TrinityWidget", "cb", "m", new JSObject(json)); }
        @Override public void resolve() {}
        @Override public void resolve(JSObject d) {}
        @Override public void reject(String m) { throw new AssertionError("rejected: " + m); }
    }

    @Test
    public void publishPrompt_publishTexts_andTheJobsCommit_allHoldTheLock() throws Exception {
        Plugin p = new Plugin();
        p.publishPrompt(new Call("{\"npub\":\"" + NPUB + "\",\"bases\":[\"https://a8.example\"],\"validUntil\":1795510000,\"texts\":{},\"cached\":null}"));
        p.publishTexts(new Call("{\"npub\":\"" + NPUB + "\",\"texts\":{\"Numbers 7\":\"x\"}}"));
        PromptFetchJob.Probe pr = new PromptFetchJob.Probe(); pr.saw404 = true;
        assertTrue(PromptFetchJob.commit(p.st, NPUB, pr));
        assertEquals(List.of("write locked", "read locked", "write locked", "read locked", "write locked"), p.st.log);
        assertEquals("x", p.st.stored.getJSONObject("texts").getString("Numbers 7"));
    }
}
