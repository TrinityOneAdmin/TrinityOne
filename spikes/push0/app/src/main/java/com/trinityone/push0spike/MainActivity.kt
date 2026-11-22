package com.trinityone.push0spike

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

/**
 * THROWAWAY Phase-0 spike launcher. One button enqueues a OneTimeWorkRequest for PushSpikeWorker
 * so the worker can be fired ON DEMAND (no 15-minute wait). It also fires once on launch, so
 * `adb shell monkey -p com.trinityone.push0spike 1` or `am start` triggers a run.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 80, 40, 40) }
        val label = TextView(this).apply { text = "push0 Phase-0 spike\nTap to run the WorkManager worker.\nWatch: adb logcat -s PUSH0" }
        val btn = Button(this).apply { text = "Run spike worker" }
        btn.setOnClickListener { enqueue() }
        root.addView(label); root.addView(btn)
        setContentView(root)

        enqueue() // fire once on launch too
    }

    private fun enqueue() {
        val req = OneTimeWorkRequestBuilder<PushSpikeWorker>().build()
        WorkManager.getInstance(this).enqueue(req)
        Log.i(PushSpikeWorker.TAG, "enqueued OneTimeWorkRequest ${req.id}")
    }
}
