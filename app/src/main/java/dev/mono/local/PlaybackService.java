package dev.mono.local;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.*;
import androidx.media3.common.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.*;
import java.util.*;
import org.json.*;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class PlaybackService extends MediaSessionService {
  public ExoPlayer player;
  private MediaSession session;
  private MonoApp app;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private String playId = "", trackId = "", sessionId = "";
  private long started,
      duration,
      lastElapsed,
      lastPosition,
      lastWall,
      pending,
      pendingMedia,
      total,
      totalMedia,
      lastAudible,
      sessionLast;
  private boolean wasPlaying, recorded;
  private int pulses;
  public long sleepDeadline;
  public boolean sleepAtEnd;
  private Runnable restore;
  private final Coverage coverage = new Coverage();
  private final Runnable tick =
      new Runnable() {
        @Override
        public void run() {
          sample(false);
          if (++pulses % 5 == 0) {
            flush(false, false);
            saveQueue();
          }
          if (sleepDeadline > 0 && SystemClock.elapsedRealtime() >= sleepDeadline) {
            sleepDeadline = 0;
            player.pause();
          }
          handler.postDelayed(this, 1000);
        }
      };

  @Override
  public void onCreate() {
    super.onCreate();
    app = (MonoApp) getApplication();
    app.service = this;
    sessionId = app.prefs.getString("listeningSession", "");
    sessionLast = app.prefs.getLong("lastAudible", 0);
    player = new ExoPlayer.Builder(this).build();
    player.setAudioAttributes(
        new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build(),
        true);
    player.setHandleAudioBecomingNoisy(true);
    player.setWakeMode(C.WAKE_MODE_LOCAL);
    applyPreferences();
    PendingIntent activity =
        PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    session = new MediaSession.Builder(this, player).setSessionActivity(activity).build();
    player.addListener(
        new Player.Listener() {
          @Override
          public void onIsPlayingChanged(boolean playing) {
            if (playing && trackId.isEmpty()) begin();
            sample(false);
            wasPlaying = playing;
            lastElapsed = SystemClock.elapsedRealtime();
            lastWall = System.currentTimeMillis();
            lastPosition = player.getCurrentPosition();
            if (!playing) flush(false, false);
          }

          @Override
          public void onPositionDiscontinuity(
              Player.PositionInfo old, Player.PositionInfo next, int reason) {
            sampleAt(old.positionMs, false);
            boolean changed =
                old.mediaItemIndex != next.mediaItemIndex
                    || reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION
                    || reason == Player.DISCONTINUITY_REASON_REMOVE;
            if (changed) {
              boolean automatic = reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION;
              finish(automatic, !automatic);
              if (sleepAtEnd && automatic) {
                sleepAtEnd = false;
                player.pause();
              }
              begin();
            }
            lastPosition = next.positionMs;
            lastElapsed = SystemClock.elapsedRealtime();
            lastWall = System.currentTimeMillis();
          }

          @Override
          public void onMediaItemTransition(MediaItem item, int reason) {
            String id = item == null ? "" : item.mediaId;
            if (!id.equals(trackId)) {
              finish(false, false);
              begin();
            }
            saveQueue();
          }

          @Override
          public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_ENDED) {
              sample(false);
              finish(true, false);
              if (sleepAtEnd) sleepAtEnd = false;
            }
          }

          @Override
          public void onPlayerError(PlaybackException error) {
            sample(false);
            flush(false, false);
            app.scanMessage = "Не удалось воспроизвести файл: " + error.getErrorCodeName();
            app.changed();
          }

          @Override
          public void onTimelineChanged(Timeline timeline, int reason) {
            saveQueue();
          }

          @Override
          public void onRepeatModeChanged(int mode) {
            app.prefs.edit().putInt("repeat", mode).apply();
          }

          @Override
          public void onShuffleModeEnabledChanged(boolean enabled) {
            app.prefs.edit().putBoolean("shuffle", enabled).apply();
          }
        });
    restore =
        () -> {
          if (!app.ready) return;
          app.listeners.remove(restore);
          restoreQueue();
        };
    app.listeners.add(restore);
    if (app.ready) restore.run();
    handler.post(tick);
  }

  public void applyPreferences() {
    if (player == null) return;
    player.setSkipSilenceEnabled(app.prefs.getBoolean("skipSilence", false));
    player.setPlaybackSpeed(app.prefs.getFloat("speed", 1f));
    player.setRepeatMode(app.prefs.getInt("repeat", 0));
    player.setShuffleModeEnabled(app.prefs.getBoolean("shuffle", false));
  }

  private void begin() {
    MediaItem item = player.getCurrentMediaItem();
    trackId = item == null ? "" : item.mediaId;
    playId = UUID.randomUUID().toString();
    started = System.currentTimeMillis();
    duration = player.getDuration();
    Track t = app.track(trackId);
    if (duration <= 0 && t != null) duration = t.duration;
    pending = pendingMedia = total = totalMedia = 0;
    coverage.clear();
    recorded = false;
    lastElapsed = SystemClock.elapsedRealtime();
    lastPosition = player.getCurrentPosition();
    lastWall = System.currentTimeMillis();
    wasPlaying = player.isPlaying();
  }

  private void sample(boolean discontinuity) {
    sampleAt(player.getCurrentPosition(), discontinuity);
  }

  private void sampleAt(long position, boolean discontinuity) {
    long now = SystemClock.elapsedRealtime(), wall = System.currentTimeMillis();
    long delta =
        ListeningMath.audibleDelta(
            now - lastElapsed,
            position - lastPosition,
            player.getPlaybackParameters().speed,
            wasPlaying,
            discontinuity);
    if (!trackId.isEmpty() && delta > 0 && app.prefs.getBoolean("history", true)) {
      if (total == 0) {
        started = wall - delta;
        if (sessionId.isEmpty() || wall - sessionLast > 30 * 60 * 1000) {
          sessionId = UUID.randomUUID().toString();
        }
        if (duration <= 0) duration = player.getDuration();
      }
      pending += delta;
      long media =
          Math.min(
              position - lastPosition, Math.round(delta * player.getPlaybackParameters().speed));
      long newlyHeard = coverage.add(Math.max(0, position - media), position);
      pendingMedia += newlyHeard;
      total += delta;
      totalMedia += newlyHeard;
      lastAudible = wall;
      sessionLast = wall;
    }
    lastElapsed = now;
    lastPosition = position;
    lastWall = wall;
    wasPlaying = player.isPlaying();
  }

  private void flush(boolean finished, boolean skipped) {
    if (total == 0 || trackId.isEmpty() || (!recorded && pending == 0)) return;
    if (pending == 0 && !finished && !skipped) return;
    final String id = playId, track = trackId, sid = sessionId;
    final long start = started,
        dur = Math.max(0, duration),
        delta = pending,
        media = pendingMedia,
        at = lastAudible - pending;
    pending = pendingMedia = 0;
    recorded = true;
    app.io.execute(
        () -> app.repo.record(id, track, sid, start, dur, at, delta, media, finished, skipped));
  }

  private void finish(boolean finished, boolean skipped) {
    flush(finished, skipped);
    total = 0;
    trackId = "";
  }

  public void checkpoint() {
    sample(false);
    flush(false, false);
    saveQueue();
  }

  public void resetTracking() {
    checkpoint();
    begin();
  }

  public void sleep(int minutes) {
    sleepAtEnd = minutes == -1;
    sleepDeadline = minutes > 0 ? SystemClock.elapsedRealtime() + minutes * 60000L : 0;
  }

  private void saveQueue() {
    if (!app.ready) return;
    JSONArray a = new JSONArray();
    for (int i = 0; i < player.getMediaItemCount(); i++) a.put(player.getMediaItemAt(i).mediaId);
    app.prefs
        .edit()
        .putString("listeningSession", sessionId)
        .putLong("lastAudible", sessionLast)
        .putString("queue", a.toString())
        .putInt("queueIndex", Math.max(0, player.getCurrentMediaItemIndex()))
        .putLong("position", Math.max(0, player.getCurrentPosition()))
        .apply();
  }

  private void restoreQueue() {
    if (player.getMediaItemCount() > 0) return;
    try {
      JSONArray a = new JSONArray(app.prefs.getString("queue", "[]"));
      List<MediaItem> items = new ArrayList<>();
      int index = 0;
      int oldIndex = app.prefs.getInt("queueIndex", 0);
      for (int i = 0; i < a.length(); i++) {
        Track t = app.track(a.getString(i));
        if (t != null) {
          if (i < oldIndex) index++;
          items.add(t.mediaItem());
        }
      }
      if (!items.isEmpty()) {
        player.setMediaItems(
            items, Math.min(index, items.size() - 1), app.prefs.getLong("position", 0));
        player.prepare();
      }
    } catch (Exception ignored) {
      app.scanMessage = "Сохранённая очередь недоступна. Выберите музыку в библиотеке.";
    }
  }

  @Override
  public MediaSession onGetSession(MediaSession.ControllerInfo info) {
    return session;
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    checkpoint();
    if (!player.getPlayWhenReady() || player.getMediaItemCount() == 0) stopSelf();
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    app.listeners.remove(restore);
    checkpoint();
    finish(false, false);
    session.release();
    player.release();
    app.service = null;
    super.onDestroy();
  }
}
