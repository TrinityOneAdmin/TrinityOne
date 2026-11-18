/*
 * Vendored from @jofr/capacitor-media-session 4.0.0 (https://github.com/jofr/capacitor-media-session,
 * author Jonas <jofr@vivaldi.net>), licensed GPL-3.0-or-later: see native/trinity-media-session/LICENSE and NOTICE.
 *
 * MODIFIED by TrinityOne, 2026-11-18 (plan: TrinityOne-internal/PLAN-AUDIO-PLAYBACK-FIXES-2026-11-18.html, Fix 2).
 * Every change carries a "TrinityOne:" comment saying why.
 */
package io.github.jofr.capacitor.mediasessionplugin;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Binder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.media.AudioAttributesCompat;
import androidx.media.AudioFocusRequestCompat;
import androidx.media.AudioManagerCompat;
import androidx.media.session.MediaButtonReceiver;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class MediaSessionService extends Service {
    private static final String TAG = "MediaSessionService";
    private static final String CHANNEL_ID = "playback";

    private MediaSessionCompat mediaSession;
    private PlaybackStateCompat.Builder playbackStateBuilder;
    private MediaMetadataCompat.Builder mediaMetadataBuilder;
    private NotificationManager notificationManager;
    private NotificationCompat.Builder notificationBuilder;
    private MediaStyle notificationStyle;
    private final Map<String, NotificationCompat.Action> notificationActions = new HashMap<>();
    private final Map<String, Long> playbackStateActions = new HashMap<>();
    private final String[] possibleActions = {"previoustrack", "seekbackward", "play", "pause", "seekforward", "nexttrack", "seekto", "stop"};
    final Set<String> possibleCompactViewActions = new HashSet<>(Arrays.asList("previoustrack", "play", "pause", "nexttrack", "stop"));
    private static final int NOTIFICATION_ID = 1;

    private int playbackState = PlaybackStateCompat.STATE_NONE;
    private String title = "";
    private String artist = "";
    private String album = "";
    private Bitmap artwork = null;
    private long duration = 0;
    private long position = 0;
    private float playbackSpeed = 1.0F;

    private boolean possibleActionsUpdate = true;
    private boolean playbackStateUpdate = false;
    private boolean mediaMetadataUpdate = false;
    private boolean notificationUpdate = false;

    private MediaSessionPlugin plugin;

    // TrinityOne: what this service holds, so destroy() can let go of all of it, once.
    private boolean foreground = false;
    private boolean noisyRegistered = false;
    private AudioFocusRequestCompat focusRequest = null;
    // TrinityOne (build audit #7): a started service that no plugin ever connects to (a 'playing' then 'none' faster
    // than the bind, or bindService() failing) would sit in the foreground with the minimal notification. Stopping it
    // BEFORE startForeground is itself a crash, so onStartCommand checks again later, after startForeground has run.
    private static final long SELF_CHECK_MS = 10000;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean selfCheckPosted = false;
    private boolean destroyed = false;
    private final Runnable selfCheck = new Runnable() {
        @Override
        public void run() {
            try { // TrinityOne (B1)
                if (destroyed) return;
                if (plugin == null || playbackState == PlaybackStateCompat.STATE_NONE) destroy();
            } catch (Exception e) {
                Log.e(TAG, "self-check failed", e);
            }
        }
    };

    private final IBinder binder = new LocalBinder();

    public final class LocalBinder extends Binder {
        MediaSessionService getService() {
            return MediaSessionService.this;
        }
    }

    // TrinityOne patch 7: headphones pulled out → pause, so a reading does not suddenly play through the loudspeaker
    // in church. Registered only while playing.
    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            try { // TrinityOne (B1)
                if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction()) && plugin != null) {
                    plugin.actionCallback("pause");
                }
            } catch (Exception e) {
                Log.e(TAG, "noisy receiver failed", e);
            }
        }
    };

    // TrinityOne patch 8: a phone call or another app taking the sound → pause. Regaining focus after a transient loss
    // does NOT resume (simple and predictable). A "duck" request lowers nothing: a no-op.
    // Mechanism (audit B6): pause → actionCallback("pause") → the JS pause handler → el.pause(); the WebView keeps
    // running in the background (Capacitor's shouldKeepRunning() defaults to true).
    private final AudioManager.OnAudioFocusChangeListener focusListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override
        public void onAudioFocusChange(int change) {
            try { // TrinityOne (B1)
                if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                    if (change == AudioManager.AUDIOFOCUS_LOSS) focusRequest = null;
                    if (plugin != null) plugin.actionCallback("pause");
                }
            } catch (Exception e) {
                Log.e(TAG, "focus listener failed", e);
            }
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        this.destroy();

        return super.onUnbind(intent);
    }

    // TrinityOne P4: the channel is created HERE, before any startForeground (upstream made it in
    // connectAndInitialize, so a startForeground before that named a missing channel: "Bad notification" crash on O+).
    @Override
    public void onCreate() {
        super.onCreate();
        try {
            ensureChannel();
        } catch (Exception e) {
            Log.e(TAG, "onCreate failed", e);
        }
    }

    private void ensureChannel() {
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && notificationManager != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
            notificationManager.createNotificationChannel(channel);
        }
    }

    private void goForeground(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        foreground = true;
    }

    public void connectAndInitialize(MediaSessionPlugin plugin, Intent intent) {
        this.plugin = plugin;

        mediaSession = new MediaSessionCompat(this, "WebViewMediaSession");
        mediaSession.setCallback(new MediaSessionCallback(plugin));
        mediaSession.setActive(true);

        playbackStateBuilder = new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY)
                .setState(PlaybackStateCompat.STATE_PAUSED, position, playbackSpeed);
        mediaSession.setPlaybackState(playbackStateBuilder.build());

        mediaMetadataBuilder = new MediaMetadataCompat.Builder()
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        mediaSession.setMetadata(mediaMetadataBuilder.build());

        ensureChannel();   // TrinityOne P4: already made in onCreate; creating it again is a no-op

        notificationStyle = new MediaStyle().setMediaSession(mediaSession.getSessionToken());
        notificationBuilder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setStyle(notificationStyle)
                .setSmallIcon(R.drawable.ic_baseline_volume_up_24)
                .setContentIntent(PendingIntent.getActivity(getApplicationContext(), 0, intent, PendingIntent.FLAG_IMMUTABLE))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        goForeground(notificationBuilder.build());   // replaces onStartCommand's minimal notification (same id)

        // TrinityOne patch 6: ONE action per intent. buildMediaButtonPendingIntent maps the action to a key code with
        // PlaybackStateCompat.toKeyCode, which matches single actions only; upstream's ACTION_PLAY_PAUSE | ACTION_PLAY
        // returned null, so Play/Pause were dead on Android 12 and lower (upstream #30). The seek buttons say 10 s,
        // which is what the app seeks (upstream: "Previous/Next Track" with 30 s icons).
        notificationActions.put("play", new NotificationCompat.Action(
                R.drawable.ic_baseline_play_arrow_24, "Play", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY)
        ));
        notificationActions.put("pause", new NotificationCompat.Action(
                R.drawable.ic_baseline_pause_24, "Pause", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE)
        ));
        notificationActions.put("seekbackward", new NotificationCompat.Action(
                R.drawable.ic_trinity_replay_10_24, "Back 10 seconds", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_REWIND)
        ));
        notificationActions.put("seekforward", new NotificationCompat.Action(
                R.drawable.ic_trinity_forward_10_24, "Forward 10 seconds", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_FAST_FORWARD)
        ));
        notificationActions.put("previoustrack", new NotificationCompat.Action(
                R.drawable.ic_baseline_skip_previous_24, "Previous Track", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
        ));
        notificationActions.put("nexttrack", new NotificationCompat.Action(
                R.drawable.ic_baseline_skip_next_24, "Next Track", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
        ));
        notificationActions.put("stop", new NotificationCompat.Action(
                R.drawable.ic_baseline_stop_24, "Stop", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP)
        ));

        playbackStateActions.put("previoustrack", PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS);
        playbackStateActions.put("seekbackward", PlaybackStateCompat.ACTION_REWIND);
        playbackStateActions.put("play", (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PLAY));
        playbackStateActions.put("pause", (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PAUSE));
        playbackStateActions.put("seekforward", PlaybackStateCompat.ACTION_FAST_FORWARD);
        playbackStateActions.put("nexttrack", PlaybackStateCompat.ACTION_SKIP_TO_NEXT);
        playbackStateActions.put("seekto", PlaybackStateCompat.ACTION_SEEK_TO);
        playbackStateActions.put("stop", PlaybackStateCompat.ACTION_STOP);
    }

    // TrinityOne patch 3: release the session (upstream never did, and every start made a new one, so sessions leaked
    // and stayed active), drop the noisy receiver and audio focus, then leave the foreground and stop. Idempotent:
    // it runs from 'none', from onUnbind, from a MEDIA_BUTTON with no plugin, and from onDestroy.
    public void destroy() {
        releaseAll();
        stopSelf();
    }

    private void releaseAll() {
        try { unregisterNoisy(); } catch (Exception e) { Log.e(TAG, "unregister noisy failed", e); }
        try { abandonFocus(); } catch (Exception e) { Log.e(TAG, "abandon focus failed", e); }
        try {
            if (mediaSession != null) {
                mediaSession.setActive(false);
                mediaSession.release();
            }
        } catch (Exception e) {
            Log.e(TAG, "session release failed", e);
        }
        mediaSession = null;
        plugin = null;
        try { if (foreground) stopForeground(true); } catch (Exception e) { Log.e(TAG, "stopForeground failed", e); }
        foreground = false;
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        try { handler.removeCallbacksAndMessages(null); } catch (Exception e) { Log.e(TAG, "remove callbacks failed", e); }
        releaseAll();
        super.onDestroy();
    }

    // TrinityOne (build audit #8): the app swiped away from recents. Activity.onDestroy (the plugin's handleOnDestroy)
    // is not guaranteed then while a foreground service keeps the process alive, so the service stops itself too:
    // out of the foreground, the session released, stopped. START_NOT_STICKY stays, so it does not come back.
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        try {
            destroy();
        } catch (Exception e) {
            Log.e(TAG, "onTaskRemoved failed", e);
        }
        super.onTaskRemoved(rootIntent);
    }

    // TrinityOne P4 (replaces upstream's onStartCommand, which never called startForeground: a Bluetooth/car Play
    // after Close or after process death came through MediaButtonReceiver → startForegroundService → here, and the app
    // died with ForegroundServiceDidNotStartInTimeException, upstream #24).
    //  · ALWAYS startForeground (a minimal notification) if not foreground yet: that meets the 5 s contract on every
    //    path. On the normal start this runs before onServiceConnected; connectAndInitialize then replaces it.
    //  · stopSelf ONLY for a MEDIA_BUTTON with no plugin connected (after Close, or a process restart).
    //  · START_NOT_STICKY: a sticky restart after process death would come back with a null intent and no plugin,
    //    and sit in the foreground with the minimal notification for ever.
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try { // TrinityOne (B1)
            if (!foreground) {
                goForeground(new NotificationCompat.Builder(this, CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_baseline_volume_up_24)
                        .setContentTitle("Audio")
                        .setSilent(true)
                        .build());
            }
            if (!selfCheckPosted) {
                selfCheckPosted = true;
                handler.postDelayed(selfCheck, SELF_CHECK_MS);
            }
            final boolean mediaButton = intent != null && Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction());
            if (mediaButton && plugin == null) {
                destroy();
                return START_NOT_STICKY;
            }
            if (mediaButton && mediaSession != null) {
                MediaButtonReceiver.handleIntent(mediaSession, intent);
            }
        } catch (Exception e) {
            Log.e(TAG, "onStartCommand failed", e);
        }
        return START_NOT_STICKY;
    }

    private void registerNoisy() {
        if (noisyRegistered) return;
        // TrinityOne (audit B5): targetSdk 34 throws on a runtime receiver registered without an export flag.
        ContextCompat.registerReceiver(this, noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
        noisyRegistered = true;
    }

    private void unregisterNoisy() {
        if (!noisyRegistered) return;
        noisyRegistered = false;
        unregisterReceiver(noisyReceiver);
    }

    // TrinityOne patch 8 (audit B6): the Compat classes, because minSdk is 22. A DENIED request (a call is in
    // progress) pauses.
    private void requestFocus() {
        if (focusRequest != null) return;
        AudioManager audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (audioManager == null) return;
        AudioFocusRequestCompat request = new AudioFocusRequestCompat.Builder(AudioManagerCompat.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributesCompat.Builder()
                        .setUsage(AudioAttributesCompat.USAGE_MEDIA)
                        .setContentType(AudioAttributesCompat.CONTENT_TYPE_SPEECH)
                        .build())
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(focusListener)
                .build();
        int result = AudioManagerCompat.requestAudioFocus(audioManager, request);
        if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            focusRequest = request;
        } else if (plugin != null) {
            plugin.actionCallback("pause");
        }
    }

    private void abandonFocus() {
        if (focusRequest == null) return;
        AudioManager audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (audioManager != null) AudioManagerCompat.abandonAudioFocusRequest(audioManager, focusRequest);
        focusRequest = null;
    }

    public void setPlaybackState(int playbackState) {
        if (this.playbackState != playbackState) {
            this.playbackState = playbackState;
            playbackStateUpdate = true;
            possibleActionsUpdate = true;
        }
        // TrinityOne patches 7 + 8: hold the noisy receiver and audio focus only while playing.
        try {
            if (playbackState == PlaybackStateCompat.STATE_PLAYING) {
                registerNoisy();
                requestFocus();
            } else {
                unregisterNoisy();
                abandonFocus();
            }
        } catch (Exception e) {
            Log.e(TAG, "noisy/focus update failed", e);
        }
    }

    public void setTitle(String title)  {
        if (!this.title.equals(title)) {
            this.title = title;
            mediaMetadataUpdate = true;
            notificationUpdate = true;
        }
    }

    public void setArtist(String artist) {
        if (!this.artist.equals(artist)) {
            this.artist = artist;
            mediaMetadataUpdate = true;
            notificationUpdate = true;
        }
    }

    public void setAlbum(String album) {
        if (!this.album.equals(album)) {
            this.album = album;
            mediaMetadataUpdate = true;
            notificationUpdate = true;
        }
    }

    public void setArtwork(Bitmap artwork) {
        this.artwork = artwork;
        mediaMetadataUpdate = true;
        notificationUpdate = true;
    }

    public void setDuration(long duration) {
        if (this.duration != duration) {
            this.duration = duration;
            mediaMetadataUpdate = true;
            notificationUpdate = true;
        }
    }

    public void setPosition(long position) {
        if (this.position != position) {
            this.position = position;
            playbackStateUpdate = true;
        }
    }

    public void setPlaybackSpeed(float playbackSpeed) {
        if (this.playbackSpeed != playbackSpeed) {
            this.playbackSpeed = playbackSpeed;
            playbackStateUpdate = true;
        }
    }

    @SuppressLint("RestrictedApi")
    public void update() {
        // TrinityOne: nothing to update once released (destroy() nulls these), or before connectAndInitialize.
        if (mediaSession == null || plugin == null || notificationBuilder == null) return;

        if (possibleActionsUpdate) {
            notificationBuilder.mActions.clear();

            long activePlaybackStateActions = 0;
            int[] activeCompactViewActionIndices = new int[3];

            int notificationActionIndex = 0;
            int compactNotificationActionIndicesIndex = 0;
            for (String actionName : possibleActions) {
                if (plugin.hasActionHandler(actionName)) {
                    if (actionName.equals("play") && playbackState != PlaybackStateCompat.STATE_PAUSED) {
                        continue;
                    }
                    if (actionName.equals("pause") && playbackState != PlaybackStateCompat.STATE_PLAYING) {
                        continue;
                    }

                    if (playbackStateActions.containsKey(actionName)) {
                        activePlaybackStateActions = activePlaybackStateActions | playbackStateActions.get(actionName);
                    }

                    if (notificationActions.containsKey(actionName)) {
                        notificationBuilder.addAction(notificationActions.get(actionName));
                        if (possibleCompactViewActions.contains(actionName) && compactNotificationActionIndicesIndex < 3) {
                            activeCompactViewActionIndices[compactNotificationActionIndicesIndex] = notificationActionIndex;
                            compactNotificationActionIndicesIndex++;
                        }
                        notificationActionIndex++;
                    }
                }
            }

            if (playbackStateBuilder != null) {
                playbackStateBuilder.setActions(activePlaybackStateActions);
            }
            if (notificationStyle != null) {
                if (compactNotificationActionIndicesIndex > 0) {
                    notificationStyle.setShowActionsInCompactView(Arrays.copyOfRange(activeCompactViewActionIndices, 0, compactNotificationActionIndicesIndex));
                } else {
                    notificationStyle.setShowActionsInCompactView();
                }
            }

            possibleActionsUpdate = false;
            playbackStateUpdate = true;
            notificationUpdate = true;
        }

        if (playbackStateUpdate && playbackStateBuilder != null) {
            playbackStateBuilder.setState(this.playbackState, this.position, this.playbackSpeed);
            mediaSession.setPlaybackState(playbackStateBuilder.build());
            playbackStateUpdate = false;
        }

        if (mediaMetadataUpdate && mediaMetadataBuilder != null) {
            mediaMetadataBuilder
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                    .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
            mediaSession.setMetadata(mediaMetadataBuilder.build());
            mediaMetadataUpdate = false;
        }

        if (notificationUpdate) {
            notificationBuilder
                    .setContentTitle(title)
                    .setContentText(artist + " - " + album)
                    .setLargeIcon(artwork);
            notificationManager.notify(NOTIFICATION_ID, notificationBuilder.build());
            notificationUpdate = false;
        }
    }

    public void updatePossibleActions() {
        this.possibleActionsUpdate = true;
        this.update();
    }
}
