package church.trinityone.directpush

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.graphics.drawable.toBitmap
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.ByteArrayInputStream

/**
 * Direct Mode background check, Phase 1 "Option B" (docs/direct-mode-push-plan.md), COMMIT 1: triggered on demand.
 *
 *  1. Read the member's PLAINTEXT mnemonic natively (SecretStoreCompat). Absent => PIN install => no-op quietly.
 *  2. Host a WebView on the main Looper at the app's OWN origin (https://localhost, served from the app's assets) with
 *     the DEFAULT data directory, in the app's main process => it shares the app's real localStorage.
 *  3. The page (assets/directpush/bg.html + bg-bundle.js) proves that (gate 1), boots fellowship and asks it for the
 *     admitted relay set (gate 2), then NIP-42-auths and counts new events with one since= REQ (gate 3).
 *  4. If the count is > 0, post a GENERIC native notification. No content is decoded and none is shown.
 *
 * Read-mostly: nothing here writes the app's cursors (docshub/memhub) — that is Phase 3.
 */
class DirectPushWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    companion object {
        const val TAG = "DIRECTPUSH"
        const val CHANNEL_ID = "trinity_directpush"
        const val NOTIFY_ID = 0x7d1
        const val KEY_SINCE = "sinceOverride"     // debug aid: force the count window (epoch seconds)
        const val KEY_DEBUG = "debug"            // debug aid: JSON of test switches, see bg-entry.js
        const val HARD_TIMEOUT_MS = 70_000L
        private const val ORIGIN = "https://localhost"
        private const val OWN_PREFIX = "/__directpush/"
        // The home-screen widget's store (native/trinity-widget WidgetStore: PREFS, K_DM_COUNT, K_DM_AT) and provider.
        // Same app, same UID, so this module can write the widget's own prefs file; keep the names in step with it.
        const val WIDGET_PREFS = "trinityone.widget"
        const val WIDGET_COUNT = "dm.count"
        const val WIDGET_AT = "dm.at"
        private const val WIDGET_PROVIDER = "church.trinityone.widget.TrinityWidgetProvider"
    }

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        Log.i(TAG, "worker start thread=${Thread.currentThread().name} pid=${android.os.Process.myPid()}")

        // ---- key-read task (audit F-B): the REAL plaintext mnemonic, natively ----
        val keyRec: SecretStoreCompat.Key? = try {
            SecretStoreCompat.readKey(ctx)
        } catch (e: Throwable) {
            Log.e(TAG, "KEYREAD error ${e.javaClass.simpleName}: ${e.message}")
            null
        }
        if (keyRec == null) {
            // PIN/passphrase install (plaintext removed) or no identity: out of scope, never guess, never crash.
            Log.i(TAG, "KEYREAD none -> no usable key (PIN install without stay-open, or no identity). Quiet no-op.")
            // Locked, forgotten or remember-me expired: the widget's count goes with the key.
            applyWidgetCount(ctx, "clear", 0)
            return Result.success()
        }
        val mnemonic = keyRec.mnemonic
        val words = mnemonic.trim().split(Regex("\\s+")).size
        Log.i(TAG, "KEYREAD ok source=${keyRec.source} words=$words (value never logged)")

        val debuggable = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        // Test switches are honoured only on a debuggable build; a release build ignores them whatever the input data says.
        val since = if (debuggable) inputData.getLong(KEY_SINCE, 0L) else 0L
        val debugJson = if (debuggable) (inputData.getString(KEY_DEBUG) ?: "{}") else "{}"
        val done = CompletableDeferred<Boolean>()
        var summary: JSONObject? = null
        var wv: WebView? = null

        withContext(Dispatchers.Main) {
            // DEFAULT data directory (no setDataDirectorySuffix) + this process = the app's storage partition.
            val v = WebView(ctx)
            wv = v
            v.settings.javaScriptEnabled = true
            v.settings.domStorageEnabled = true
            v.settings.allowFileAccess = false
            v.settings.allowContentAccess = false
            // CDP on this WebView exposes a page holding the injected key: ONLY for a debuggable build, never release.
            if (debuggable) WebView.setWebContentsDebuggingEnabled(true)
            v.addJavascriptInterface(object {
                @JavascriptInterface
                fun isDebug(): Boolean = debuggable
                @JavascriptInterface
                fun result(json: String) {
                    if (debuggable) Log.i(TAG, "JS> $json")
                    try {
                        val o = JSONObject(json)
                        if (o.optString("stage") == "summary") summary = o
                        if (o.optString("stage") == "summary" || o.optString("stage") == "fatal") {
                            if (!done.isCompleted) done.complete(true)
                        }
                    } catch (e: Throwable) { /* a non-JSON line is only logged */ }
                }
            }, "DPNative")
            v.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    serve(ctx, request)
                override fun onPageFinished(view: WebView, url: String) {
                    Log.i(TAG, "page finished: $url")
                    // Hand the key to the page ONLY now, after the page's own gate-1 read has already run.
                    val opts = JSONObject().put("since", since).put("source", keyRec.source).put("recordPub", keyRec.recordPub).put("debug", try { JSONObject(debugJson) } catch (e: Throwable) { JSONObject() }).toString()
                    view.evaluateJavascript(
                        "window.__dpStart(${JSONObject.quote(mnemonic)}, $opts);", null
                    )
                }
            }
            v.loadUrl("$ORIGIN${OWN_PREFIX}bg.html")
        }

        val finished = withTimeoutOrNull(HARD_TIMEOUT_MS) { done.await() } != null
        Log.i(TAG, "worker awaited page; finished=$finished")
        withContext(Dispatchers.Main) {
            try { wv?.stopLoading(); wv?.loadUrl("about:blank"); wv?.destroy() } catch (e: Throwable) {}
        }

        val s = summary
        val count = s?.optInt("newSinceCursor", 0) ?: 0
        val verdict = s?.optString("verdict", "none") ?: "no-summary"
        Log.i(TAG, "SUMMARY finished=$finished verdict=$verdict newSinceCursor=$count")
        if (count > 0) postGeneric(ctx, count)
        // The page decides (bg-entry.js widgetCountAction); a summary without it (older bundle) changes nothing.
        val w = s?.optJSONObject("widget")
        applyWidgetCount(ctx, w?.optString("op", "keep") ?: "keep", w?.optInt("n", 0) ?: 0)
        return Result.success()
    }

    /**
     * The widget's bare count: ONE integer and its timestamp, in the widget's own prefs, then a redraw of the placed
     * widgets. Nothing else crosses: no name, no room, no text. Never throws (a worker that throws is retried and logs
     * noise; the widget is a convenience). op: "set" | "clear" | anything else = keep.
     */
    private fun applyWidgetCount(ctx: Context, op: String, n: Int) {
        try {
            val p = ctx.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
            when (op) {
                "set" -> if (n > 0) p.edit().putInt(WIDGET_COUNT, n).putLong(WIDGET_AT, System.currentTimeMillis()).apply() else return
                "clear" -> { p.edit().remove(WIDGET_COUNT).remove(WIDGET_AT).apply(); try { NotificationManagerCompat.from(ctx).cancel(NOTIFY_ID) } catch (e: Throwable) {} }
                else -> return
            }
            val mgr = AppWidgetManager.getInstance(ctx)
            val cn = ComponentName(ctx.packageName, WIDGET_PROVIDER)
            val ids = mgr.getAppWidgetIds(cn)
            if (ids != null && ids.isNotEmpty()) {
                // The provider is exported=false: an explicit broadcast from our own process reaches it.
                ctx.sendBroadcast(Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).setComponent(cn).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids))
            }
            Log.i(TAG, "WIDGET count op=$op")
        } catch (e: Throwable) {
            Log.w(TAG, "WIDGET count ${e.javaClass.simpleName}")
        }
    }

    /** https://localhost/__directpush/<f> -> this module's assets; everything else -> the app's own web assets. */
    private fun serve(ctx: Context, req: WebResourceRequest): WebResourceResponse? {
        val u = req.url
        if (u.scheme != "https" || u.host != "localhost") return null
        val path = u.path ?: "/"
        val assetPath = if (path.startsWith(OWN_PREFIX)) "directpush/" + path.removePrefix(OWN_PREFIX)
        else "public" + (if (path == "/") "/index.html" else path)
        return try {
            val stream = ctx.assets.open(assetPath)
            val mime = when {
                assetPath.endsWith(".html") -> "text/html"
                assetPath.endsWith(".js") -> "application/javascript"
                assetPath.endsWith(".json") -> "application/json"
                assetPath.endsWith(".css") -> "text/css"
                else -> "application/octet-stream"
            }
            WebResourceResponse(mime, "utf-8", stream)
        } catch (e: Throwable) {
            Log.w(TAG, "asset miss $assetPath")
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }
    }

    private fun postGeneric(ctx: Context, count: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "New messages", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val pi = launch?.let {
            PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val appIcon = try { ctx.packageManager.getApplicationIcon(ctx.packageName).toBitmap() } catch (e: Throwable) { null }
        val body = if (count == 1) "You have 1 new message" else "You have $count new messages"
        val n = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notify_trinity)
            .setContentTitle("TrinityOne")
            .setContentText(body)
            .setNumber(count)
            .setAutoCancel(true)
            .apply { if (appIcon != null) setLargeIcon(appIcon) }
            .apply { if (pi != null) setContentIntent(pi) }
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFY_ID, n)
            Log.i(TAG, "NOTIFY posted generic notification")
        } catch (e: SecurityException) {
            Log.e(TAG, "NOTIFY blocked (POST_NOTIFICATIONS not granted?): ${e.message}")
        }
    }
}
