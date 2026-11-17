package church.trinityone.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * The app's side of the widget: window.Capacitor.Plugins.TrinityWidget. Absent on the web and on iOS
 * (no iOS half yet) — every caller in app/*.jsx treats a missing plugin as "no widget" and does nothing.
 *
 *   status()                → { supported, enabled, pinSupported }
 *   setEnabled({ on })      → on: the widget appears in the launcher's widget list. off: clears everything.
 *   publishVotd({ days })   → the 60-day verse table (app/screens-today.jsx)
 *   publishPrompt({ npub, bases, validUntil, texts, cached }) → the church's public verse prompt config
 *   clearPrompt()           → back to the daily verse only; stops the background fetch
 *   clear()                 → forget everything
 *   requestPin()            → Android 8+: ask the launcher to place the widget
 *   probe({ npub, bases })  → the app's one-off check of the public verse prompt (native GET, see PromptFetchJob)
 */
@CapacitorPlugin(name = "TrinityWidget")
public class TrinityWidgetPlugin extends Plugin {

    private Context ctx() { return getContext().getApplicationContext(); }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", true);
        r.put("enabled", WidgetStore.enabled(ctx()));
        r.put("pinSupported", Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(ctx()).isRequestPinAppWidgetSupported());
        call.resolve(r);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (!on) { forget(); }
        WidgetStore.setEnabled(ctx(), on);
        call.resolve();
    }

    @PluginMethod
    public void publishVotd(PluginCall call) {
        JSObject days = call.getObject("days");
        if (days == null) { call.reject("days missing"); return; }
        try {
            JSONObject v = new JSONObject(); v.put("days", days); v.put("written", System.currentTimeMillis());
            WidgetStore.write(ctx(), WidgetStore.K_VOTD, v);
        } catch (Exception e) { call.reject("bad days"); return; }
        WidgetStore.refresh(ctx());
        call.resolve();
    }

    @PluginMethod
    public void publishPrompt(PluginCall call) {
        JSONObject p;
        try { p = promptArgs(call, nowMs()); }
        catch (IllegalArgumentException e) { call.reject(e.getMessage()); return; }
        catch (Exception e) { call.reject("bad prompt"); return; }
        PromptStore st = promptStore();
        st.write(p);
        st.schedule();
        st.refresh();
        call.resolve();
    }

    /** Where publishPrompt puts an accepted config. An interface so the JVM test (PublishPromptTest) can run
     *  publishPrompt ITSELF with a recording store (audit M1 of eab4bf9b): no Context exists off-device. */
    interface PromptStore { void write(JSONObject cfg); void schedule(); void refresh(); }

    PromptStore promptStore() {
        final Context c = ctx();
        return new PromptStore() {
            @Override public void write(JSONObject cfg) { WidgetStore.write(c, WidgetStore.K_PROMPT, cfg); }
            @Override public void schedule() { PromptFetchJob.schedule(c); }
            @Override public void refresh() { WidgetStore.refresh(c); }
        };
    }

    long nowMs() { return System.currentTimeMillis(); }

    /** No caller asks for more than this: a week with no PIN, "remember me" (30 days) with one. */
    static final long MAX_VALID_S = 366L * 86400L;

    /**
     * publishPrompt's arguments → the config WidgetStore keeps. Pure (no Context), so the JVM test
     * (src/test/.../PublishPromptArgsTest) runs exactly the code publishPrompt runs.
     *
     * NUMBERS: never PluginCall.getLong / getInt / getDouble. They return the default unless the bridge's value is
     * already that exact boxed type, and the bridge parses JSON with org.json, which hands back an Integer for any
     * whole number that fits in 32 bits. A unix-seconds validUntil (1795510000) is such a number, so getLong returned
     * 0, WidgetStore.promptConfig deleted the config on the next redraw, and the church prompt never reached the
     * widget (device-found on the Oppo, 2026-11-17). Read the raw value as a Number instead.
     */
    static JSONObject promptArgs(PluginCall call, long nowMs) throws Exception {
        JSONObject p = new JSONObject();
        String npub = call.getString("npub", "");
        if (npub == null || !npub.matches("^npub1[a-z0-9]{58}$")) throw new IllegalArgumentException("bad npub");
        p.put("npub", npub);
        p.put("bases", call.getArray("bases"));
        long until = seconds(call.getData(), "validUntil");
        // Refused rather than stored: a config that is already past (or 0) would be deleted at the next redraw, which
        // looks like success to the app; one in milliseconds would never expire and defeat the native lock bound.
        if (until * 1000L <= nowMs || until > nowMs / 1000L + MAX_VALID_S) throw new IllegalArgumentException("bad validUntil");
        p.put("validUntil", until);
        JSObject texts = call.getObject("texts");
        p.put("texts", texts == null ? new JSONObject() : texts);
        JSObject cached = call.getObject("cached");
        p.put("cached", cached == null ? JSONObject.NULL : PromptFetchJob.sanitise(cached));
        return p;
    }

    /** A whole number of seconds from the bridge, whatever boxed type org.json chose (Integer, Long, Double); else 0. */
    static long seconds(JSONObject data, String key) {
        Object v = data == null ? null : data.opt(key);
        if (!(v instanceof Number)) return 0L;
        double d = ((Number) v).doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) return 0L;
        return ((Number) v).longValue();
    }

    /**
     * probe({ npub, bases }) → { outcome: 'found' | 'absent' | 'unreachable', copy? }. The app's one-off check of the
     * public verse prompt, run with the SAME native GET as the background job (PromptFetchJob.probe): https only, no
     * redirects, timed out, size-capped, sanitised. 'absent' only when EVERY base asked answered 404.
     */
    @PluginMethod
    public void probe(final PluginCall call) {
        final String npub = call.getString("npub", "");
        final JSArray bases = call.getArray("bases");
        if (npub == null || !npub.matches("^npub1[a-z0-9]{58}$") || bases == null) { call.reject("bad probe"); return; }
        new Thread(() -> {
            JSObject r = new JSObject();
            try {
                PromptFetchJob.Probe p = PromptFetchJob.probe(npub, bases);
                r.put("outcome", p.saw200 ? "found" : (p.saw404 && !p.sawFail ? "absent" : "unreachable"));
                if (p.saw200 && p.best != null) r.put("copy", p.best);
            } catch (Throwable t) { r.put("outcome", "unreachable"); }
            call.resolve(r);
        }).start();
    }

    @PluginMethod
    public void clearPrompt(PluginCall call) {
        WidgetStore.write(ctx(), WidgetStore.K_PROMPT, null);
        PromptFetchJob.cancel(ctx());
        WidgetStore.refresh(ctx());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) { forget(); call.resolve(); }

    @PluginMethod
    public void requestPin(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= 26) {
            AppWidgetManager m = AppWidgetManager.getInstance(ctx());
            if (m.isRequestPinAppWidgetSupported()) ok = m.requestPinAppWidget(WidgetStore.provider(ctx()), null, null);
        }
        r.put("requested", ok);
        call.resolve(r);
    }

    private void forget() {
        WidgetStore.write(ctx(), WidgetStore.K_VOTD, null);
        WidgetStore.write(ctx(), WidgetStore.K_PROMPT, null);
        WidgetStore.forgetAllOrders(ctx());
        PromptFetchJob.cancel(ctx());
        WidgetStore.refresh(ctx());
    }
}
