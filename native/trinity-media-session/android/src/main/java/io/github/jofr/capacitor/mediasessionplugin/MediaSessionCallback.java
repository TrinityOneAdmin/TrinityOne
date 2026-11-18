/*
 * Vendored from @jofr/capacitor-media-session 4.0.0 (https://github.com/jofr/capacitor-media-session,
 * author Jonas <jofr@vivaldi.net>), licensed GPL-3.0-or-later: see native/trinity-media-session/LICENSE and NOTICE.
 *
 * MODIFIED by TrinityOne, 2026-11-18: every callback is wrapped (audit B1). These run on the main thread from the
 * system's media session; a throw here has no catch above it and kills the app.
 */
package io.github.jofr.capacitor.mediasessionplugin;

import android.support.v4.media.session.MediaSessionCompat;
import android.util.Log;

import com.getcapacitor.JSObject;

public class MediaSessionCallback extends MediaSessionCompat.Callback {
    private static final String TAG = "MediaSessionCallback";

    private final MediaSessionPlugin plugin;

    MediaSessionCallback(MediaSessionPlugin plugin) {
        this.plugin = plugin;
    }

    private void send(String action, JSObject data) {
        try {
            if (data == null) plugin.actionCallback(action); else plugin.actionCallback(action, data);
        } catch (Exception e) {
            Log.e(TAG, "action " + action + " failed", e);
        }
    }

    @Override
    public void onPlay() {
        send("play", null);
    }

    @Override
    public void onPause() {
        send("pause", null);
    }

    @Override
    public void onSeekTo(long pos) {
        JSObject data = new JSObject();
        data.put("seekTime", (double) pos / 1000.0);
        send("seekto", data);
    }

    @Override
    public void onRewind() {
        send("seekbackward", null);
    }

    @Override
    public void onFastForward() {
        send("seekforward", null);
    }

    @Override
    public void onSkipToPrevious() {
        send("previoustrack", null);
    }

    @Override
    public void onSkipToNext() {
        send("nexttrack", null);
    }

    @Override
    public void onStop() {
        send("stop", null);
    }
}
