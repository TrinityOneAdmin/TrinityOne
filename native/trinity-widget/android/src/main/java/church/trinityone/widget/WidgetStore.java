package church.trinityone.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Everything the widget knows lives here, in one SharedPreferences file, written ONLY by the app
 * (TrinityWidgetPlugin) and by the background fetch (PromptFetchJob). The widget never runs the app's JS,
 * never opens a relay socket and never holds a key.
 *
 *   "votd"   — { days: { "YYYY-MM-DD": { ref, text, version } } }  60 days ahead, written by the Today screen.
 *   "prompt" — { npub, bases: ["https://host", …], validUntil (unix s), texts: { ref: text },
 *                cached: { ts, ref, schedule: [{ at, ref }] } | null }
 *              Only the church's PUBLIC verse prompt (/public/<npub>/verse-prompt.json). No note, ever.
 *
 * WHICH PAGE IS MAIN (owner, 2026-11-16): the widget's main page is whichever of { today's daily verse, the
 * church's active verse prompt } became current MOST RECENTLY; the other is one swipe away. The daily verse
 * becomes current at local midnight; a prompt at its active schedule entry's `at` (the latest entry whose time
 * has passed), or at its publish `ts` when it has no schedule. No active prompt: a single page.
 * NOTE this is a widget-only rule. In the app the two are separate cards shown together
 * (app/screens-today.jsx, the verse-prompt card and the verse-of-the-day card).
 */
final class WidgetStore {
    static final String PREFS = "trinityone.widget";
    static final String K_VOTD = "votd";
    static final String K_PROMPT = "prompt";

    static final class Page {
        final String label, ref, text;
        final boolean prompt;
        Page(boolean prompt, String label, String ref, String text) { this.prompt = prompt; this.label = label; this.ref = ref; this.text = text; }
    }

    private WidgetStore() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static JSONObject read(Context c, String key) {
        String s = prefs(c).getString(key, null);
        if (s == null) return null;
        try { return new JSONObject(s); } catch (Exception e) { return null; }
    }

    static void write(Context c, String key, JSONObject v) {
        if (v == null) prefs(c).edit().remove(key).apply(); else prefs(c).edit().putString(key, v.toString()).apply();
    }

    static String localDate(long ms) {
        Calendar k = Calendar.getInstance(); k.setTimeInMillis(ms);
        return String.format(Locale.ROOT, "%04d-%02d-%02d", k.get(Calendar.YEAR), k.get(Calendar.MONTH) + 1, k.get(Calendar.DAY_OF_MONTH));
    }

    static long localMidnight(long ms) {
        Calendar k = Calendar.getInstance(); k.setTimeInMillis(ms);
        k.set(Calendar.HOUR_OF_DAY, 0); k.set(Calendar.MINUTE, 0); k.set(Calendar.SECOND, 0); k.set(Calendar.MILLISECOND, 0);
        return k.getTimeInMillis();
    }

    static long nextLocalMidnight(long ms) {
        Calendar k = Calendar.getInstance(); k.setTimeInMillis(localMidnight(ms));
        k.add(Calendar.DAY_OF_MONTH, 1);
        return k.getTimeInMillis();
    }

    /** The prompt config, or null. Enforces validUntil WITHOUT the app: past it, the config is deleted. */
    static JSONObject promptConfig(Context c, long now) {
        JSONObject p = read(c, K_PROMPT);
        if (p == null) return null;
        long until = p.optLong("validUntil", 0);
        if (until <= 0 || until * 1000L <= now) {
            write(c, K_PROMPT, null);
            PromptFetchJob.cancel(c);
            return null;
        }
        return p;
    }

    /** The active prompt entry: { ref, becameMs } or null. */
    static String[] activePrompt(JSONObject cached, long now) {
        if (cached == null) return null;
        JSONArray sch = cached.optJSONArray("schedule");
        if (sch != null && sch.length() > 0) {
            long bestAt = -1; String bestRef = null;
            for (int i = 0; i < sch.length(); i++) {
                JSONObject e = sch.optJSONObject(i); if (e == null) continue;
                long at = e.optLong("at", 0); String ref = e.optString("ref", "");
                if (at <= 0 || ref.isEmpty() || at * 1000L > now) continue;
                if (at >= bestAt) { bestAt = at; bestRef = ref; }
            }
            return bestRef == null ? null : new String[] { bestRef, String.valueOf(bestAt * 1000L) };
        }
        String ref = cached.optString("ref", "");
        long ts = cached.optLong("ts", 0);
        if (ref.isEmpty() || ts <= 0) return null;
        // An unscheduled prompt may carry several passages ("A; B"); the console appends new ones at the end,
        // so the last is the newest. The app pages through all of them; a widget card shows one.
        String[] parts = ref.split("; ");
        String last = parts[parts.length - 1].trim();
        return last.isEmpty() ? null : new String[] { last, String.valueOf(ts * 1000L) };
    }

    static Page votdPage(Context c, long now) {
        JSONObject v = read(c, K_VOTD);
        JSONObject days = v == null ? null : v.optJSONObject("days");
        if (days == null) return null;
        String today = localDate(now);
        JSONObject e = days.optJSONObject(today);
        if (e == null) {
            // Past the end of the table (the app has not run for 60 days): show the newest day we have that is
            // not in the future, rather than nothing.
            String best = null;
            JSONArray names = days.names();
            if (names != null) for (int i = 0; i < names.length(); i++) {
                String d = names.optString(i);
                if (d.compareTo(today) <= 0 && (best == null || d.compareTo(best) > 0)) best = d;
            }
            if (best != null) e = days.optJSONObject(best);
        }
        if (e == null) return null;
        return new Page(false, c.getString(R.string.trinity_widget_votd), e.optString("ref", ""), e.optString("text", ""));
    }

    static List<Page> pages(Context c, long now) {
        List<Page> out = new ArrayList<>();
        Page votd = votdPage(c, now);
        Page prompt = null; long promptBecame = -1;
        JSONObject cfg = promptConfig(c, now);
        if (cfg != null) {
            String[] act = activePrompt(cfg.optJSONObject("cached"), now);
            if (act != null) {
                JSONObject texts = cfg.optJSONObject("texts");
                String text = texts == null ? "" : texts.optString(act[0], "");
                prompt = new Page(true, c.getString(R.string.trinity_widget_prompt), act[0],
                        text.isEmpty() ? c.getString(R.string.trinity_widget_tap_to_read) : text);
                promptBecame = Long.parseLong(act[1]);
            }
        }
        long votdBecame = localMidnight(now);
        if (prompt != null && (votd == null || promptBecame >= votdBecame)) { out.add(prompt); if (votd != null) out.add(votd); }
        else { if (votd != null) out.add(votd); if (prompt != null) out.add(prompt); }
        return out;
    }

    /** The next moment the main page could change without new data: local midnight, or the next schedule entry. */
    static long nextChange(Context c, long now) {
        long next = nextLocalMidnight(now);
        JSONObject cfg = read(c, K_PROMPT);
        if (cfg != null) {
            long until = cfg.optLong("validUntil", 0) * 1000L;
            if (until > now && until < next) next = until;
            JSONObject cached = cfg.optJSONObject("cached");
            JSONArray sch = cached == null ? null : cached.optJSONArray("schedule");
            if (sch != null) for (int i = 0; i < sch.length(); i++) {
                JSONObject e = sch.optJSONObject(i); if (e == null) continue;
                long at = e.optLong("at", 0) * 1000L;
                if (at > now && at < next) next = at;
            }
        }
        return next;
    }

    /**
     * The page set and order as one string ("P|ref" / "V|ref" per page, most current first). The provider asks
     * StackView to show page 0 again ONLY when this changes (device D2, 2026-11-17: after a refresh the daily verse
     * was in front although the prompt was the most current), so a member's own swipe is not undone by every redraw
     * that changes nothing.
     */
    static String pageOrder(List<Page> pages) {
        StringBuilder b = new StringBuilder();
        for (Page p : pages) b.append(p.prompt ? 'P' : 'V').append('|').append(p.ref).append('\n');
        return b.toString();
    }

    static boolean frontNeedsReset(String shownOrder, String nowOrder) { return shownOrder == null || !shownOrder.equals(nowOrder); }

    static final String K_ORDER = "order.";   // + widget id → the pageOrder last put in front of that widget

    static String shownOrder(Context c, int widgetId) { return prefs(c).getString(K_ORDER + widgetId, null); }

    static void recordOrder(Context c, int widgetId, String order) { prefs(c).edit().putString(K_ORDER + widgetId, order).apply(); }

    /** Every widget's recorded order (re-audit R3): with them gone, the next draw puts page 0 in front again. */
    static void forgetAllOrders(Context c) {
        SharedPreferences.Editor e = prefs(c).edit();
        for (String k : prefs(c).getAll().keySet()) if (k.startsWith(K_ORDER)) e.remove(k);
        e.apply();
    }

    static void forgetOrder(Context c, int widgetId) { prefs(c).edit().remove(K_ORDER + widgetId).apply(); }

    /**
     * How many lines of verse fit a widget this many dp tall, so the text ends in "…" instead of being cut through a
     * line (trinity_widget_item.xml). Leans SMALL on purpose: one line too few costs an early "…", one too many is
     * the clipped line this exists to prevent. textSp = the size the verse is drawn at its smallest (12 with API 26+
     * autosize, else 15). heightDp <= 0 (a launcher that reports no size) → 4, what fits the declared 110dp minimum
     * at normal font size.
     *
     *   widget − root padding 12 → StackView; a page gets 90% of it (StackView's stack perspective) − page padding 24
     *   − header (the 20dp mark, or the 12sp label if larger, + 8 gap) − reference (12sp + 6 gap) − 8 slack
     *   (launcher padding we cannot see) → ÷ one line (1.25 × textSp × font scale).
     */
    static int verseLines(int heightDp, float fontScale, float textSp) {
        if (heightDp <= 0) return 4;
        float fs = fontScale > 0 ? fontScale : 1f;
        float page = (heightDp - 12f) * 0.9f - 24f;
        float header = Math.max(20f, 12f * 1.25f * fs) + 8f;
        float ref = 12f * 1.25f * fs + 6f;
        float line = 1.25f * textSp * fs;
        int n = (int) Math.floor((page - header - ref - 8f) / line);
        return Math.max(1, Math.min(12, n));
    }

    static ComponentName provider(Context c) { return new ComponentName(c, TrinityWidgetProvider.class); }

    static boolean enabled(Context c) {
        int s = c.getPackageManager().getComponentEnabledSetting(provider(c));
        return s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    static void setEnabled(Context c, boolean on) {
        c.getPackageManager().setComponentEnabledSetting(provider(c),
                on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
                PackageManager.DONT_KILL_APP);
    }

    /** Redraw every placed widget now. */
    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(provider(c));
        if (ids == null || ids.length == 0) return;
        Intent i = new Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).setComponent(provider(c));
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        c.sendBroadcast(i);
    }
}
