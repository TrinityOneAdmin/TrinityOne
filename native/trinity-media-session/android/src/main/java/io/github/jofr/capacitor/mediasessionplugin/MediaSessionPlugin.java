/*
 * Vendored from @jofr/capacitor-media-session 4.0.0 (https://github.com/jofr/capacitor-media-session,
 * author Jonas <jofr@vivaldi.net>), licensed GPL-3.0-or-later: see native/trinity-media-session/LICENSE and NOTICE.
 *
 * MODIFIED by TrinityOne, 2026-11-18 (plan: TrinityOne-internal/PLAN-AUDIO-PLAYBACK-FIXES-2026-11-18.html, Fix 2).
 * Every change carries a "TrinityOne:" comment saying why. In short: no native throw may escape (Capacitor turns
 * one into a process crash), artwork is data:-only, 'none' tears the service down, and a refused foreground start
 * is a reject instead of a crash.
 */
package io.github.jofr.capacitor.mediasessionplugin;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.IBinder;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "MediaSession")
public class MediaSessionPlugin extends Plugin {
    private static final String TAG = "MediaSessionPlugin";

    private boolean startServiceOnlyDuringPlayback = true;

    private String title = "";
    private String artist = "";
    private String album = "";
    private Bitmap artwork = null;
    private String playbackState = "none";
    private double duration = 0.0;
    private double position = 0.0;
    private double playbackRate = 1.0;
    private final Map<String, PluginCall> actionHandlers = new HashMap<>();

    private MediaSessionService service = null;
    // TrinityOne: true from bindService() until 'none'. Upstream keyed everything on `service`, which stays null until
    // onServiceConnected, so a second 'playing' in that window started a second service.
    private boolean bound = false;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName componentName, IBinder iBinder) {
            // TrinityOne (audit B1): native code outside a @PluginMethod has no catch above it; a throw here kills the app.
            try {
                MediaSessionService.LocalBinder binder = (MediaSessionService.LocalBinder) iBinder;
                service = binder.getService();
                service.connectAndInitialize(MediaSessionPlugin.this, contentIntent());
                updateServiceMetadata();
                updateServicePlaybackState();
                updateServicePositionState();
            } catch (Exception e) {
                Log.e(TAG, "onServiceConnected failed", e);
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName componentName) {
            Log.d(TAG, "Disconnected from MediaSessionService");
            service = null;
        }
    };

    // TrinityOne: the notification's tap target. Upstream used getActivity().getClass(), which throws when the
    // activity is gone; fall back to the launcher intent.
    private Intent contentIntent() {
        if (getActivity() != null) return new Intent(getActivity(), getActivity().getClass());
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
        return launch != null ? launch : new Intent();
    }

    @Override
    public void load() {
        super.load();
        try {
            final String foregroundServiceConfig = getConfig().getString("foregroundService", "");
            if (foregroundServiceConfig.equals("always")) {
                startServiceOnlyDuringPlayback = false;
            }
            if (!startServiceOnlyDuringPlayback) {
                startMediaService();
            }
        } catch (Exception e) {
            Log.e(TAG, "load failed", e);
        }
    }

    // TrinityOne patch 5: Android 12+ refuses to start a foreground service from the background
    // (ForegroundServiceStartNotAllowedException). Catch its PARENT, IllegalStateException, so minSdk 22 never
    // references the API 31 class (audit B4). The caller rejects; the JS keeps playing without OS controls for
    // that track, and the next 'playing' tries again.
    private boolean startMediaService() {
        Intent intent = new Intent(getContext(), MediaSessionService.class);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (IllegalStateException e) {
            Log.w(TAG, "The playback service may not start now", e);
            return false;
        }
        bound = getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        return bound;
    }

    // TrinityOne patch 3: 'none' stops foreground, stops the service and releases the session (destroy()).
    private void stopMediaService() {
        if (service != null) service.destroy();
        if (bound) {
            try { getContext().unbindService(serviceConnection); } catch (IllegalArgumentException e) { Log.d(TAG, "not bound"); }
        }
        service = null;
        bound = false;
    }

    private void updateServiceMetadata() {
        if (service == null) return;
        service.setTitle(title);
        service.setArtist(artist);
        service.setAlbum(album);
        service.setArtwork(artwork);
        service.update();
    }

    // TrinityOne patch 2: only data: artwork is decoded. Upstream fetched http(s) URLs with HttpURLConnection on the
    // ONE plugin thread (blocking every other plugin) and threw when offline or refused, which crashed the app.
    private Bitmap dataUrlToBitmap(String url) {
        int base64Index = url.indexOf(";base64,");
        if (base64Index == -1) return null;
        byte[] decoded = Base64.decode(url.substring(base64Index + 8), Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        // TrinityOne patch 1: every @PluginMethod body rejects instead of throwing (Bridge.java:825-829 rethrows
        // any exception as a RuntimeException on the plugin thread: a process crash).
        try {
            title = call.getString("title", title);
            artist = call.getString("artist", artist);
            album = call.getString("album", album);

            // TrinityOne patch 2: a missing artwork key means none (upstream: NullPointerException); any non-data: src
            // is ignored.
            Bitmap art = null;
            final JSArray artworkArray = call.getArray("artwork");
            if (artworkArray != null) {
                for (int i = 0; i < artworkArray.length(); i++) {
                    JSONObject a = artworkArray.optJSONObject(i);
                    String src = a != null ? a.optString("src", "") : "";
                    if (src.startsWith("data:")) {
                        Bitmap b = dataUrlToBitmap(src);
                        if (b != null) art = b;
                    }
                }
            }
            this.artwork = art;

            updateServiceMetadata();
            call.resolve();
        } catch (Exception e) {
            call.reject("setMetadata failed: " + e.getMessage());
        }
    }

    private void updateServicePlaybackState() {
        if (service == null) return;
        if (playbackState.equals("playing")) {
            service.setPlaybackState(PlaybackStateCompat.STATE_PLAYING);
            service.update();
        } else if (playbackState.equals("paused")) {
            service.setPlaybackState(PlaybackStateCompat.STATE_PAUSED);
            service.update();
        } else {
            service.setPlaybackState(PlaybackStateCompat.STATE_NONE);
            service.update();
        }
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        try { // TrinityOne patch 1
            playbackState = call.getString("playbackState", playbackState);

            final boolean playback = playbackState.equals("playing") || playbackState.equals("paused");
            if (startServiceOnlyDuringPlayback && service == null && !bound && playback) {
                if (!startMediaService()) {
                    playbackState = "none";
                    call.reject("The playback service could not start");
                    return;
                }
            } else if (startServiceOnlyDuringPlayback && (service != null || bound) && !playback) {
                stopMediaService();
            } else if (service != null) {
                updateServicePlaybackState();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("setPlaybackState failed: " + e.getMessage());
        }
    }

    private void updateServicePositionState() {
        if (service == null) return;
        service.setDuration(Math.round(duration * 1000));
        service.setPosition(Math.round(position * 1000));
        float playbackSpeed = playbackRate == 0.0 ? (float) 1.0 : (float) playbackRate;
        service.setPlaybackSpeed(playbackSpeed);
        service.update();
    }

    @PluginMethod
    public void setPositionState(PluginCall call) {
        try { // TrinityOne patch 1
            duration = call.getDouble("duration", 0.0);
            position = call.getDouble("position", 0.0);
            playbackRate = call.getFloat("playbackRate", 1.0F);

            updateServicePositionState();
            call.resolve();
        } catch (Exception e) {
            call.reject("setPositionState failed: " + e.getMessage());
        }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void setActionHandler(PluginCall call) {
        try { // TrinityOne patch 1
            String action = call.getString("action");
            if (action == null) {
                call.reject("setActionHandler needs an action");
                return;
            }
            // TrinityOne (build audit #9): { action, remove: true } takes a handler away (Previous/Next on a one-item
            // queue), and a replaced handler's kept-alive call is released rather than left saved for ever.
            if (Boolean.TRUE.equals(call.getBoolean("remove", false))) {
                PluginCall old = actionHandlers.remove(action);
                if (old != null) old.release(getBridge());
                call.resolve();
                if (service != null) { service.updatePossibleActions(); }
                return;
            }
            call.setKeepAlive(true);
            PluginCall old = actionHandlers.put(action, call);
            if (old != null && old != call) old.release(getBridge());

            if (service != null) { service.updatePossibleActions(); }
        } catch (Exception e) {
            call.reject("setActionHandler failed: " + e.getMessage());
        }
    }

    public boolean hasActionHandler(String action) {
        return actionHandlers.containsKey(action) && !actionHandlers.get(action).getCallbackId().equals(PluginCall.CALLBACK_ID_DANGLING);
    }

    public void actionCallback(String action) {
        actionCallback(action, new JSObject());
    }

    public void actionCallback(String action, JSObject data) {
        try { // TrinityOne (B1): reached from the session callback, the focus listener and the noisy receiver
            PluginCall call = actionHandlers.get(action);
            if (call != null && !call.getCallbackId().equals(PluginCall.CALLBACK_ID_DANGLING)) {
                data.put("action", action);
                call.resolve(data);
            } else {
                Log.d(TAG, "No handler for action " + action);
            }
        } catch (Exception e) {
            Log.e(TAG, "actionCallback failed", e);
        }
    }

    // TrinityOne: the activity is gone (swiped from recents, or finished): its WebView, and so the sound, goes with
    // it, so the notification and the foreground service must too (upstream issue #29). Not in the plan's patch list;
    // it is the plan's own device expectation "swipe the app away while playing: the notification goes".
    @Override
    protected void handleOnDestroy() {
        try { stopMediaService(); } catch (Exception e) { Log.e(TAG, "handleOnDestroy failed", e); }
        super.handleOnDestroy();
    }
}
