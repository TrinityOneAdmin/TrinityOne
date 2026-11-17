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
        try {
            JSONObject p = new JSONObject();
            String npub = call.getString("npub", "");
            if (npub == null || !npub.matches("^npub1[a-z0-9]{58}$")) { call.reject("bad npub"); return; }
            p.put("npub", npub);
            p.put("bases", call.getArray("bases"));
            p.put("validUntil", call.getLong("validUntil", 0L));
            JSObject texts = call.getObject("texts");
            p.put("texts", texts == null ? new JSONObject() : texts);
            JSObject cached = call.getObject("cached");
            p.put("cached", cached == null ? JSONObject.NULL : PromptFetchJob.sanitise(cached));
            WidgetStore.write(ctx(), WidgetStore.K_PROMPT, p);
        } catch (Exception e) { call.reject("bad prompt"); return; }
        PromptFetchJob.schedule(ctx());
        WidgetStore.refresh(ctx());
        call.resolve();
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
        PromptFetchJob.cancel(ctx());
        WidgetStore.refresh(ctx());
    }
}
