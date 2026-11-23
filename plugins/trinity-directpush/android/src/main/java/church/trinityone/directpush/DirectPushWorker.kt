package church.trinityone.directpush

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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
            return Result.success()
        }
        val mnemonic = keyRec.mnemonic
        val words = mnemonic.trim().split(Regex("\\s+")).size
        Log.i(TAG, "KEYREAD ok source=${keyRec.source} words=$words (value never logged)")

        val since = inputData.getLong(KEY_SINCE, 0L)
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
            WebView.setWebContentsDebuggingEnabled(true)   // debug app only matters; lets CDP attach to the bg page
            v.addJavascriptInterface(object {
                @JavascriptInterface
                fun result(json: String) {
                    Log.i(TAG, "JS> $json")
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
                    val opts = JSONObject().put("since", since).put("debug", try { JSONObject(inputData.getString(KEY_DEBUG) ?: "{}") } catch (e: Throwable) { JSONObject() }).toString()
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
        if (count > 0) postGeneric(ctx)
        return Result.success()
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

    private fun postGeneric(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "New messages", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val pi = launch?.let {
            PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val n = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("TrinityOne")
            .setContentText("You have new messages")
            .setAutoCancel(true)
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
