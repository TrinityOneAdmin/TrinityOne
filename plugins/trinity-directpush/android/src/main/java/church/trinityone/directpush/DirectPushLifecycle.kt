package church.trinityone.directpush

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Commit 2: lifecycle around DirectPushWorker. Called from MainActivity.onCreate (see ../../../../../README.md).
 * Opt-in is hardcoded ON for this test build; the real toggle is Deliverable 2.
 */
object DirectPushLifecycle {
    const val UNIQUE_NAME = "directpush-periodic"
    const val REQ_NOTIF = 0x7d2
    private const val PREFS = "directpush_lifecycle"

    /** 15 min is the WorkManager floor; do not lower. KEEP => idempotent, never duplicated. WorkManager persists it
     *  across reboot itself (its own RescheduleReceiver), so no boot receiver is needed. */
    fun schedule(context: Context) {
        val req = PeriodicWorkRequestBuilder<DirectPushWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        Log.i(DirectPushWorker.TAG, "periodic work registered ($UNIQUE_NAME, 15min, KEEP)")
    }

    fun onLaunch(activity: Activity) {
        try {
            schedule(activity)
            requestNotificationPermission(activity)
            requestBatteryExemption(activity)
        } catch (e: Throwable) {
            Log.e(DirectPushWorker.TAG, "lifecycle error ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun requestNotificationPermission(a: Activity) {
        if (Build.VERSION.SDK_INT < 33) return
        if (a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        a.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
    }

    /** One-time, DEBUG builds only: the permission is declared in the app's debug manifest only (Play restricts it). */
    private fun requestBatteryExemption(a: Activity) {
        if (a.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
        if (Build.VERSION.SDK_INT < 23) return
        val pm = a.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(a.packageName)) return
        val prefs = a.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean("batteryAsked", false)) return
        prefs.edit().putBoolean("batteryAsked", true).apply()
        a.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${a.packageName}")))
    }
}
