package church.trinityone.widget;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Background refresh of the church's PUBLIC verse prompt, hourly, with the app closed.
 *
 * It reads ONLY https bases the app handed over, and the app hands over ONLY addresses from
 * Fellowship.widgetFeedBases(), i.e. relaysForChurch(cp) AFTER the relay-admission gate (CLAUDE.md rule 10,
 * reference/RELAY-ADMISSION.md). This job does not re-prove a relay's identity on each fetch; the address was
 * proved when the app wrote it. It reads public data and sends nothing, so a box swapped in at that address
 * would be read (stale), not fed. It never reads a note field (the public copy carries none).
 *
 * Outcome rules: any 200 → keep the newest `ts` ever seen (never let an older copy replace a newer one);
 * no 200, a 404 from EVERY base asked → the prompt was withdrawn or the switch turned off → drop it (daily verse only);
 * a 404 beside a base that could not be reached is NOT proof (an old relay without the route 404s while the
 *   church's own box is briefly offline — audit F8) → keep what we have;
 * only network failures → keep what we have.
 */
public class PromptFetchJob extends JobService {
    static final int JOB_ID = 0x7417;   // fixed: one job per app
    static final long PERIOD_MS = 60L * 60L * 1000L;

    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        if (js.getPendingJob(JOB_ID) != null) return;
        JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(c, PromptFetchJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(PERIOD_MS)
                .build();
        js.schedule(info);
    }

    static void cancel(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(JOB_ID);
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        final Context c = getApplicationContext();
        new Thread(() -> {
            try { fetchNow(c); } catch (Throwable ignored) {}
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    /** One pass over the bases. Package-visible so the plugin can run it right after the app writes the config. */
    static void fetchNow(Context c) {
        long now = System.currentTimeMillis();
        JSONObject cfg = WidgetStore.promptConfig(c, now);   // null when absent or past validUntil (and then cancelled)
        if (cfg == null) { cancel(c); return; }
        String npub = cfg.optString("npub", "");
        JSONArray bases = cfg.optJSONArray("bases");
        if (!npub.matches("^npub1[a-z0-9]{58}$") || bases == null) return;
        Probe pr = probe(npub, bases);
        JSONObject best = pr.best; boolean saw404 = pr.saw404, saw200 = pr.saw200, sawFail = pr.sawFail;
        try {
            JSONObject cur = cfg.optJSONObject("cached");
            if (saw200) {
                if (cur == null || best.optLong("ts", 0) >= cur.optLong("ts", 0)) cfg.put("cached", best);
            } else if (saw404 && !sawFail) {
                cfg.put("cached", JSONObject.NULL);
            } else {
                return;
            }
            // Re-read the config before writing: the app may have cleared it while we were on the network.
            if (WidgetStore.read(c, WidgetStore.K_PROMPT) == null) return;
            WidgetStore.write(c, WidgetStore.K_PROMPT, cfg);
        } catch (Exception e) { return; }
        WidgetStore.refresh(c);
    }

    /** What one pass over the bases found. */
    static final class Probe { JSONObject best; boolean saw200, saw404, sawFail; }

    /**
     * ONE pass over the bases — the ONLY network code that reads the public verse prompt, used by the background job
     * AND by the app's probe (TrinityWidgetPlugin.probe). Done natively on purpose (audit re-check R1): on the APK the
     * webview's fetch is routed through Capacitor's https://localhost/_capacitor_http_interceptor_ proxy, so a page
     * can neither refuse a redirect nor see which address really answered. Here: https only, no redirects, 8 s
     * timeouts, 64 KB cap, and only { ts, ref, schedule } survives (sanitise).
     */
    static final long PROBE_DEADLINE_MS = 15000L;   // the WHOLE pass, all bases — a slow-drip server cannot hold the thread

    static Probe probe(String npub, JSONArray bases) {
        Probe p = new Probe();
        long deadline = System.currentTimeMillis() + PROBE_DEADLINE_MS;
        for (int i = 0; i < bases.length(); i++) {
            String base = bases.optString(i, "");
            if (!base.startsWith("https://")) continue;   // never cleartext
            if (System.currentTimeMillis() >= deadline) { p.sawFail = true; break; }   // out of time: not proof of anything
            int[] code = new int[] { 0 };
            JSONObject got = get(base + "/public/" + npub + "/verse-prompt.json", code, deadline);
            if (code[0] == 404) p.saw404 = true;
            else if (code[0] != 200 || got == null) p.sawFail = true;
            if (got != null) { p.saw200 = true; if (p.best == null || got.optLong("ts", 0) > p.best.optLong("ts", 0)) p.best = got; }
        }
        return p;
    }

    /** GET → the validated public copy, or null. code[0] = the HTTP status (0 on a network failure). */
    static JSONObject get(String url, int[] code, long deadline) {
        HttpURLConnection h = null;
        try {
            int left = (int) Math.max(1L, Math.min(8000L, deadline - System.currentTimeMillis()));
            h = (HttpURLConnection) new URL(url).openConnection();
            h.setConnectTimeout(left); h.setReadTimeout(left);
            h.setInstanceFollowRedirects(false);
            h.setRequestProperty("Accept", "application/json");
            code[0] = h.getResponseCode();
            if (code[0] != 200) return null;
            InputStream in = h.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[4096]; int n, total = 0;
            // A read timeout resets on every byte, so a server dripping one byte at a time could hold this for ever;
            // the overall deadline stops that (re-audit of 3ece67c6, NIT).
            while ((n = in.read(b)) > 0) {
                total += n; if (total > 65536) return null; buf.write(b, 0, n);
                if (System.currentTimeMillis() > deadline) return null;
            }
            return sanitise(new JSONObject(buf.toString("UTF-8")));
        } catch (Throwable t) {
            return null;
        } finally {
            if (h != null) h.disconnect();
        }
    }

    /** Keep only { ts, ref, schedule:[{at, ref}] } — whatever else a relay sends (a note included) is dropped. */
    static JSONObject sanitise(JSONObject j) throws Exception {
        JSONObject out = new JSONObject();
        out.put("ts", j.optLong("ts", 0));
        String ref = j.optString("ref", "");
        out.put("ref", ref.length() > 200 ? ref.substring(0, 200) : ref);
        JSONArray sch = new JSONArray();
        JSONArray in = j.optJSONArray("schedule");
        if (in != null) for (int i = 0; i < in.length() && i < 50; i++) {
            JSONObject e = in.optJSONObject(i); if (e == null) continue;
            String r = e.optString("ref", ""); long at = e.optLong("at", 0);
            if (r.isEmpty() || at <= 0) continue;
            JSONObject o = new JSONObject(); o.put("at", at); o.put("ref", r.length() > 200 ? r.substring(0, 200) : r);
            sch.put(o);
        }
        out.put("schedule", sch);
        return out;
    }
}
