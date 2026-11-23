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

    /**
     * ONE lock for every read-modify-write of K_PROMPT (re-audit X-a of e19bfb9d): the app's bridge thread
     * (publishPrompt, publishTexts, clearPrompt, clear/setEnabled off) and the background job's thread (PromptFetchJob)
     * both rewrite it. SharedPreferences updates its in-memory map synchronously, so holding this across read → write
     * makes each change whole. Never held across the network: the job's GET pass runs outside it.
     */
    static final Object PROMPT_LOCK = new Object();

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
        synchronized (PROMPT_LOCK) {
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
        for (String k : prefs(c).getAll().keySet()) if (k.startsWith(K_ORDER) || k.startsWith(K_FLIP) || k.startsWith(K_FLIP_FOR)) e.remove(k);
        e.apply();
    }

    static void forgetOrder(Context c, int widgetId) { prefs(c).edit().remove(K_ORDER + widgetId).remove(K_FLIP + widgetId).remove(K_FLIP_FOR + widgetId).apply(); }

    /**
     * TAP TO FLIP, device D-1 (2026-11-17): ColorOS's launcher ignores a PARTIAL update (showNext / setDisplayedChild)
     * of a StackView. What every host does honour is a data change of the adapter, and StackView keeps its displayed
     * index across one. So a flip ROTATES this widget's adapter by one page and notifies the data change: whatever
     * index the stack is showing — the first, or another one the member swiped to — now holds the other page. With two
     * pages that is always a flip. The rotation is per widget ("flip.<id>"), survives redraws that change nothing, and
     * is cleared when the page set or order changes (drawAll, before the update), so "most current first" still holds.
     */
    static final String K_FLIP = "flip.";

    /** + widget id → the pageOrder the rotation was made against (re-audit E-2 of cfc3fd22). */
    static final String K_FLIP_FOR = "flipfor.";

    /** The rotation to apply to `order` — 0, and the stored flip cleared, when it was made against another page set
     *  (a page-set change can reach the factory before the next full redraw clears it in drawAll). */
    static int rotation(Context c, int widgetId, String order) {
        SharedPreferences p = prefs(c);
        int rot = p.getInt(K_FLIP + widgetId, 0);
        if (rot == 0) return 0;
        if (order != null && order.equals(p.getString(K_FLIP_FOR + widgetId, null))) return rot;
        clearFlip(c, widgetId);
        return 0;
    }

    static void rotate(Context c, int widgetId, String order) {
        int next = (rotation(c, widgetId, order) + 1) % 1000;
        prefs(c).edit().putInt(K_FLIP + widgetId, next).putString(K_FLIP_FOR + widgetId, order).apply();
    }

    static void clearFlip(Context c, int widgetId) { prefs(c).edit().remove(K_FLIP + widgetId).remove(K_FLIP_FOR + widgetId).apply(); }

    /** Adapter position → the page it shows, under a rotation. Dots use THIS (the page's own index), so each page keeps
     *  its dot whichever way it reached the front. */
    static int logical(int position, int rot, int count) {
        if (count <= 0) return position;
        return ((position + rot) % count + count) % count;
    }

    // The layout numbers verseLines mirrors (res/layout/trinity_widget.xml and trinity_widget_item.xml).
    static final float STACK_PULL_UP_DP = 10f;   // the StackView's negative top margin
    static final float PAGE_PAD_V_DP = 10f;      // page paddingTop / paddingBottom
    static final float TEXT_GAP_DP = 6f;         // header -> verse
    static final float REF_GAP_DP = 4f;          // verse -> reference

    /**
     * How many lines of verse fit a widget this many dp tall, so the text ends in "…" instead of being cut through a
     * line (trinity_widget_item.xml). Leans SMALL on purpose: one line too few costs an early "…", one too many is
     * the clipped line this exists to prevent. textSp = the size the verse is drawn at its smallest (12 with API 26+
     * autosize, else 15). heightDp <= 0 (a launcher that reports no size) → 4.
     *
     *   the front page's top = 0.1 × (widget + 10) − 10 (StackView's 10% perspective offset of a StackView pulled up
     *   10dp; its bottom is the card's bottom) → page = widget − top − padding 20 − header (the 20dp mark, or the
     *   12sp label if larger, + 6 gap) − reference (12sp + 4 gap) − 8 slack (launcher padding we cannot see)
     *   → ÷ one line (1.25 × textSp × font scale).
     * Before 2026-11-17 (dots branch): page = (widget − 12) × 0.9 − 24, gaps 8 and 6 — about 28dp less on a 218dp card.
     */
    static int verseLines(int heightDp, float fontScale, float textSp) {
        if (heightDp <= 0) return 4;
        float fs = fontScale > 0 ? fontScale : 1f;
        float top = 0.1f * (heightDp + STACK_PULL_UP_DP) - STACK_PULL_UP_DP;
        float page = heightDp - top - 2f * PAGE_PAD_V_DP;
        float header = Math.max(20f, 12f * 1.25f * fs) + TEXT_GAP_DP;
        float ref = 12f * 1.25f * fs + REF_GAP_DP;
        float line = 1.25f * textSp * fs;
        int n = (int) Math.floor((page - header - ref - 8f) / line);
        return Math.max(1, Math.min(12, n));
    }

    /** One page's dot slots (trinity_widget_dot0/1): DOT_HIDDEN, DOT_OFF or DOT_ON. One page → no dots at all. */
    static final int DOT_HIDDEN = 0, DOT_OFF = 1, DOT_ON = 2, DOT_SLOTS = 2;

    static int[] dots(int count, int position) {
        int[] out = new int[DOT_SLOTS];
        if (count < 2) return out;
        for (int i = 0; i < DOT_SLOTS; i++) out[i] = i >= count ? DOT_HIDDEN : (i == position ? DOT_ON : DOT_OFF);
        return out;
    }

    /** What a page view is told — an interface so the JVM test (PageBindTest) runs exactly what getViewAt runs. */
    interface PageBinder {
        void label(String s);
        void text(String s, int maxLines);
        void ref(String s);
        void dotsShown(boolean shown);
        void dot(int slot, int state);
    }

    /** Fill one page. The label is the page's own ("Verse of the day" / "Your church is reading"), nothing appended:
     *  the dots replaced "Swipe for more" (owner, 2026-11-17 — it read as "swipe sideways", which moves the home screen). */
    static void bindPage(PageBinder b, Page p, int position, int count, int verseLines) {
        b.label(p.label);
        b.text(p.text, verseLines);
        b.ref(p.ref);
        int[] d = dots(count, position);
        b.dotsShown(count >= 2);
        for (int i = 0; i < d.length; i++) b.dot(i, d[i]);
    }

    // ---- The bare "N new messages" count (Direct Mode, Deliverable 3) --------------------------------------------------
    // Written by the background reader's WORKER (plugins/trinity-directpush DirectPushWorker.kt, which has no JS bridge)
    // straight into THIS prefs file under these two keys; the app clears it through TrinityWidgetPlugin.clearMessageCount.
    // A NUMBER and the time it was written — never a name, a room or any text. Keep the key names in step with
    // DirectPushWorker.WIDGET_*.
    static final String K_DM_COUNT = "dm.count";
    static final String K_DM_AT = "dm.at";
    /** A count older than this is not shown. The reader runs about every 15 minutes; if it stops (remember-me expired
     *  and the app was not opened, or the member locked / forgot the device without the app running) nothing is left
     *  to clear the number, so it must stop showing on its own. */
    static final long DM_MAX_AGE_MS = 6L * 3600L * 1000L;

    /** What to show: n, or 0 when it is not positive, was never stamped, is older than DM_MAX_AGE_MS or is stamped in
     *  the future (a clock set back). Pure. */
    static int shownCount(int n, long at, long now) {
        if (n <= 0 || at <= 0) return 0;
        if (now - at > DM_MAX_AGE_MS || at - now > 3600L * 1000L) return 0;
        return n;
    }

    static int messageCount(Context c, long now) {
        SharedPreferences p = prefs(c);
        return shownCount(p.getInt(K_DM_COUNT, 0), p.getLong(K_DM_AT, 0), now);
    }

    static void clearMessageCount(Context c) { prefs(c).edit().remove(K_DM_COUNT).remove(K_DM_AT).apply(); }

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
