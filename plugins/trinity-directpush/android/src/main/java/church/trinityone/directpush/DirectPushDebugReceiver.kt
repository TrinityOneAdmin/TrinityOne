package church.trinityone.directpush

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.util.Log
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

/**
 * Commit-1 trigger: enqueue ONE DirectPushWorker run now. Debug builds only (refuses on a non-debuggable app), and
 * exported=false in the manifest, so the only way in is `adb shell run-as com.trinityone.app am broadcast ...`.
 * The 15-minute periodic schedule is Commit 2.
 */
class DirectPushDebugReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
        val since = intent.getLongExtra(DirectPushWorker.KEY_SINCE, 0L)
        val dbg = intent.getStringExtra(DirectPushWorker.KEY_DEBUG) ?: "{}"
        val req = OneTimeWorkRequestBuilder<DirectPushWorker>()
            .setInputData(Data.Builder().putLong(DirectPushWorker.KEY_SINCE, since).putString(DirectPushWorker.KEY_DEBUG, dbg).build())
            .build()
        WorkManager.getInstance(context.applicationContext).enqueue(req)
        Log.i(DirectPushWorker.TAG, "debug trigger: enqueued run (sinceOverride=$since)")
    }
}
