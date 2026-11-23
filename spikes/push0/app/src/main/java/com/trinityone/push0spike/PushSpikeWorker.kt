package com.trinityone.push0spike

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
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

/**
 * THROWAWAY Phase-0 spike worker. Answers P0.1-P0.4 (see spikes/push0/README.md). NOT shipped.
 *
 * P0.1  A WorkManager worker (CoroutineWorker) hosts a headless WebView on the MAIN Looper thread
 *       and keeps itself alive (suspends on a CompletableDeferred) while the async socket work runs.
 * P0.2  The WebView boots the real nostr-tools SimplePool and runs ONE since= REQ to a real,
 *       already-admitted church relay, reading to EOSE.
 * P0.3  The worker reads a Keystore-backed secret NATIVELY (SecretStoreCompat, the plugin's exact
 *       scheme) and injects it into the WebView before the REQ. It also probes, from JS, whether a
 *       window.Capacitor bridge exists in this raw WebView at all (F2).
 * P0.4  The worker posts a LOCAL notification via native NotificationManagerCompat.
 */
class PushSpikeWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    companion object {
        const val TAG = "PUSH0"
        const val CHANNEL_ID = "push0_spike"
        // Spike-only prefixed key. The member app's real signing-key alias is the plugin prefix +
        // "trinityone.nostr.mnemonic.enc" (identity.src.js ENC_KEY). We use a distinct name so this
        // spike never collides with anything real, and because it runs under its own UID anyway.
        const val SPIKE_KEY = "push0.spike.signingkey"
        // Default REAL, already-admitted church relay (member app talks to it; NOT a new/widened relay).
        const val DEFAULT_RELAY = "wss://app.trinityone.church/relay"
    }

    private val reports = StringBuilder()

    override suspend fun doWork(): Result {
        val relay = inputData.getString("relay") ?: DEFAULT_RELAY
        Log.i(TAG, "P0.1 worker started on thread=${Thread.currentThread().name}; relay=$relay")

        ensureChannel()
        // P0.4 (part A): prove a worker can post a notification even before any WebView work.
        postNotification("push0: worker started", "WorkManager worker is running (P0.1)")

        // P0.3 (native half, done off the WebView): write a throwaway secret the plugin's way, then
        // read it back NATIVELY. In Phase 1 the write is the member app; only this read ships.
        var injectedKey: String? = null
        try {
            SecretStoreCompat.writeSecret(
                applicationContext, SPIKE_KEY,
                "deadbeef_spike_signing_key_" + System.currentTimeMillis()
            )
            injectedKey = SecretStoreCompat.readSecret(applicationContext, SPIKE_KEY)
            Log.i(TAG, "P0.3 native keystore read-back: ${if (injectedKey != null) "OK len=${injectedKey.length}" else "NULL"}")
        } catch (e: Throwable) {
            Log.e(TAG, "P0.3 native keystore FAILED: ${e.javaClass.simpleName}: ${e.message}", e)
        }

        val done = CompletableDeferred<Boolean>()

        // P0.1: WebView must live on a thread with a Looper. Build + drive it on the main Looper.
        withContext(Dispatchers.Main) {
            val wv = WebView(applicationContext)
            WebView.setWebContentsDebuggingEnabled(true)
            wv.settings.javaScriptEnabled = true
            wv.settings.domStorageEnabled = true // localStorage in the WebView

            wv.addJavascriptInterface(object {
                @JavascriptInterface
                fun result(json: String) {
                    Log.i(TAG, "JS> $json")
                    reports.append(json).append('\n')
                    if (json.contains("\"stage\":\"closed\"") || json.contains("\"stage\":\"fatal\"")) {
                        if (!done.isCompleted) done.complete(true)
                    }
                }
            }, "SpikeNative")

            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    Log.i(TAG, "P0.2 page finished: $url")
                    // P0.3: inject the natively-read key INTO the WebView, then start the REQ.
                    val keyJs = if (injectedKey != null)
                        "window.__spikeInjectedKey=${jsString(injectedKey)};" else
                        "window.__spikeInjectedKey=null;"
                    view.evaluateJavascript(keyJs) {
                        view.evaluateJavascript("window.__spikeStart(${jsString(relay)});", null)
                    }
                }
            }
            Log.i(TAG, "P0.1 WebView constructed on thread=${Thread.currentThread().name} (hasLooper=${Looper.myLooper() != null})")
            wv.loadUrl("file:///android_asset/spike.html")
        }

        // Keep the worker alive while the async WebSocket/REQ runs (P0.1 kept-alive requirement).
        val finished = withTimeoutOrNull(30_000) { done.await() } != null
        Log.i(TAG, "worker awaited WebView; finished=$finished")

        // Tear the WebView down on the main thread.
        withContext(Dispatchers.Main) {
            // nothing retained; GC'd. (Spike: we do not reuse the instance.)
        }

        val eose = reports.contains("\"stage\":\"eose\"")
        val bridge = reports.contains("\"hasCapacitorBridge\":true")
        // P0.4 (part B): post the outcome as a local notification from the worker.
        postNotification(
            "push0: run complete",
            "eose=$eose keyInjected=${injectedKey != null} capacitorBridge=$bridge (P0.2/P0.3/P0.4)"
        )
        Log.i(TAG, "SUMMARY eose=$eose keyInjected=${injectedKey != null} capacitorBridge=$bridge finished=$finished")

        return Result.success()
    }

    private fun jsString(s: String?): String {
        if (s == null) return "null"
        val esc = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
        return "\"$esc\""
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "push0 spike", NotificationManager.IMPORTANCE_HIGH)
            )
        }
    }

    private fun postNotification(title: String, text: String) {
        val n = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(applicationContext).notify(title.hashCode(), n)
            Log.i(TAG, "P0.4 posted notification: $title / $text")
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted (API 33+). Logged so the device checklist can catch it.
            Log.e(TAG, "P0.4 notification blocked (POST_NOTIFICATIONS not granted?): ${e.message}")
        }
    }
}
