package church.trinityone.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import android.app.job.JobScheduler;
import android.content.Context;


import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * The Android 16 crash (2026-11-19): JobScheduler.schedule threw SecurityException inside publishPrompt, a
 * @PluginMethod, which is FATAL on the CapacitorPlugins thread. PromptFetchJob.schedule must never throw, and must
 * fall back to a job without the network constraint before giving up.
 */
public class ScheduleFallbackTest {

    static final class Fake implements PromptFetchJob.Scheduler {
        final List<String> log = new ArrayList<>();
        boolean pending, pendingThrows, netThrows, plainThrows;
        @Override public boolean pending() { log.add("pending"); if (pendingThrows) throw new SecurityException("p"); return pending; }
        @Override public void schedule(boolean network) {
            log.add(network ? "net" : "plain");
            if (network && netThrows) throw new SecurityException("ACCESS_NETWORK_STATE required");
            if (!network && plainThrows) throw new IllegalArgumentException("x");
        }
    }

    @Test
    public void schedulesWithTheNetworkConstraintWhenItCan() {
        Fake f = new Fake();
        assertEquals(PromptFetchJob.SCHEDULED, PromptFetchJob.scheduleSafely(f));
        assertEquals(List.of("pending", "net"), f.log);
    }

    @Test
    public void aPendingJobIsLeftAlone() {
        Fake f = new Fake(); f.pending = true;
        assertEquals(PromptFetchJob.ALREADY_PENDING, PromptFetchJob.scheduleSafely(f));
        assertEquals(List.of("pending"), f.log);
    }

    @Test
    public void aRefusedNetworkConstraintFallsBackToAPlainJob() {
        Fake f = new Fake(); f.netThrows = true;
        assertEquals(PromptFetchJob.SCHEDULED_NO_NETWORK, PromptFetchJob.scheduleSafely(f));
        assertEquals(List.of("pending", "net", "plain"), f.log);
    }

    @Test
    public void bothRefusedGivesUpWithoutThrowing() {
        Fake f = new Fake(); f.pendingThrows = true; f.netThrows = true; f.plainThrows = true;
        assertEquals(PromptFetchJob.GAVE_UP, PromptFetchJob.scheduleSafely(f));
        assertEquals(List.of("pending", "net", "plain"), f.log);
    }

    /**
     * schedule(Context) ITSELF, the method publishPrompt and the provider call: off-device every JobInfo.Builder call
     * throws ("Stub!"), standing in for a JobScheduler that refuses. The pre-fix body let that escape.
     */
    @Test
    public void scheduleWithARealContextNeverThrows() {
        Context c = mock(Context.class);
        JobScheduler js = mock(JobScheduler.class);
        when(c.getSystemService(Context.JOB_SCHEDULER_SERVICE)).thenReturn(js);
        when(js.getPendingJob(PromptFetchJob.JOB_ID)).thenReturn(null);
        PromptFetchJob.schedule(c);   // must return, not throw
        PromptFetchJob.schedule(c);   // and again (the log-once path)
    }

    /** publishPrompt, the @PluginMethod from the crash log: a store that throws → the call is rejected, not thrown. */
    @Test
    public void publishPromptRejectsWhenTheStoreThrows() throws Exception {
        PublishPromptTest.Call c = new PublishPromptTest.Call(PublishPromptTest.args(Long.toString(PublishPromptTest.UNTIL)));
        TrinityWidgetPlugin p = new TrinityWidgetPlugin() {
            @Override long nowMs() { return PublishPromptTest.NOW_MS; }
            @Override PromptStore promptStore() {
                return new PromptStore() {
                    @Override public JSONObject read() { return null; }
                    @Override public void write(JSONObject cfg) {}
                    @Override public void schedule() { throw new SecurityException("ACCESS_NETWORK_STATE required"); }
                    @Override public void refresh() {}
                };
            }
        };
        p.publishPrompt(c);
        assertEquals("widget update failed", c.rejected);
        assertTrue(!c.resolved);
    }
}
