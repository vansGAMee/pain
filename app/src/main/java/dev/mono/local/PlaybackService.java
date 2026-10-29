package dev.mono.local;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.*;
import androidx.media3.common.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.audio.*;
import androidx.media3.common.audio.AudioProcessor;
import android.content.Context;
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
  private PlaybackAudio audioProcessor;
  private final List<String> smartScope = new ArrayList<>();
  private final List<String> pinnedNext = new ArrayList<>();
  private int smartRequest;
  private boolean arranging;
  private boolean wentBack;
  private boolean resetSmart;
  public String smartReason = "";
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
    audioProcessor=new PlaybackAudio(this,app);
    player = new ExoPlayer.Builder(this,new DefaultRenderersFactory(this){
      @Override protected AudioSink buildAudioSink(Context context,boolean enableFloatOutput,boolean enablePlaybackParameters){
        return new DefaultAudioSink.Builder(context).setAudioProcessors(new AudioProcessor[]{audioProcessor}).build();
      }
    }).build();
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
            if (!playing) {flush(false, false);app.music.call("boundary",new JSONObject(),null);app.refreshStats();}
          }

          @Override
          public void onPositionDiscontinuity(
              Player.PositionInfo old, Player.PositionInfo next, int reason) {
            sampleAt(old.positionMs, false);
            boolean changed =
                !Objects.equals(old.mediaItem==null?null:old.mediaItem.mediaId,next.mediaItem==null?null:next.mediaItem.mediaId)
                    || reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION;
            if (changed) {
              wentBack=reason==Player.DISCONTINUITY_REASON_SEEK&&next.mediaItemIndex<old.mediaItemIndex;
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
            pinnedNext.remove(id);
            refreshSmart(false);
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
            refreshSmart(false);
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
    player.setVolume(Math.max(25, Math.min(100, app.prefs.getInt("volumeLimit", 100))) / 100f);
    player.setSkipSilenceEnabled(app.prefs.getBoolean("skipSilence", false));
    player.setPlaybackSpeed(app.prefs.getFloat("speed", 1f));
    player.setRepeatMode(app.prefs.getInt("repeat", 0));
    player.setShuffleModeEnabled(app.prefs.getBoolean("shuffle", false));
    if(app.prefs.getBoolean("smartDj",false))player.setShuffleModeEnabled(false);
    audioProcessor.settings();
  }

  private void begin() {
    MediaItem item = player.getCurrentMediaItem();
    trackId = item == null ? "" : item.mediaId;
    audioProcessor.track(trackId);
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
    final boolean completed=(finished||skipped)&&ListeningMath.completed(totalMedia,dur);
    final boolean rejected=skipped&&!completed;
    pending = pendingMedia = 0;
    recorded = true;
    if(app.prefs.getBoolean("history",true))try{
      JSONObject feedback=new JSONObject().put("id",id).put("track",track).put("session",sid)
          .put("started",start).put("duration",dur).put("heard",total).put("media_heard",totalMedia)
          .put("finished",completed?1:0).put("skipped",rejected?1:0);
      app.music.call("feedback",feedback,null);
    }catch(Exception ignored){}
    app.io.execute(
        () -> app.repo.record(id, track, sid, start, dur, at, delta, media, completed, rejected));
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

  public String currentId(){MediaItem item=player.getCurrentMediaItem();return item==null?"":item.mediaId;}
  public boolean smartEnabled(){return app.prefs.getBoolean("smartDj",false);}
  public void setSmart(boolean enabled){
    app.prefs.edit().putBoolean("smartDj",enabled).apply();smartRequest++;
    if(enabled){player.setShuffleModeEnabled(false);captureScope();refreshSmart(true);}
    else smartReason="";
  }
  public void setScope(List<Track> tracks){
    smartScope.clear();for(Track t:tracks)if(!smartScope.contains(t.id))smartScope.add(t.id);
    pinnedNext.clear();smartRequest++;resetSmart=true;saveScope();
  }
  public void addScope(List<Track> tracks,boolean next){
    for(Track t:tracks){if(!smartScope.contains(t.id))smartScope.add(t.id);if(next)pinnedNext.add(t.id);}
    smartRequest++;saveScope();
  }
  private void saveScope(){app.prefs.edit().putString("djScope",new JSONArray(smartScope).toString()).apply();}
  public void removeScope(String id){smartScope.remove(id);pinnedNext.remove(id);smartRequest++;saveScope();}
  public void clearUpcoming(){
    smartScope.clear();if(!currentId().isEmpty())smartScope.add(currentId());pinnedNext.clear();smartRequest++;saveScope();
  }
  private void captureScope(){
    smartScope.clear();for(int i=0;i<player.getMediaItemCount();i++){String id=player.getMediaItemAt(i).mediaId;if(!smartScope.contains(id))smartScope.add(id);}saveScope();
  }
  public void refreshSmart(boolean reset){
    if(player==null||!smartEnabled()||arranging||currentId().isEmpty()||!app.music.isReady())return;
    if(smartScope.isEmpty())captureScope();
    final int request=++smartRequest;final String current=currentId();
    try{
      JSONObject data=new JSONObject().put("ids",new JSONArray(smartScope)).put("current",current).put("reset",reset||resetSmart)
          .put("back",wentBack)
          .put("loop",player.getRepeatMode()==Player.REPEAT_MODE_ONE?"one":player.getRepeatMode()==Player.REPEAT_MODE_ALL?"all":"off");
      wentBack=false;resetSmart=false;
      app.music.call("choose",data,(result,error) -> {
        if(result==null||request!=smartRequest||!smartEnabled()||!current.equals(currentId()))return;
        JSONArray reasons=result.optJSONArray("reasons");StringJoiner text=new StringJoiner(". ");
        if(reasons!=null)for(int i=0;i<reasons.length();i++)text.add(reasons.optString(i));smartReason=text.toString();
        if(!pinnedNext.isEmpty()||player.getRepeatMode()==Player.REPEAT_MODE_ONE)return;
        String next=result.optString("next","");if(next.equals(current))return;
        int index=player.getCurrentMediaItemIndex()+1,found=-1;
        for(int i=index;i<player.getMediaItemCount();i++)if(player.getMediaItemAt(i).mediaId.equals(next)){found=i;break;}
        arranging=true;
        try{
          if(next.isEmpty()||next.equals("null"))player.removeMediaItems(index,player.getMediaItemCount());
          else if(found>=0){if(found!=index)player.moveMediaItem(found,index);}
          else{Track t=app.track(next);if(t!=null)player.addMediaItem(index,t.mediaItem());}
          if(player.getCurrentMediaItemIndex()>100)player.removeMediaItems(0,player.getCurrentMediaItemIndex()-100);
        }finally{arranging=false;}
      });
    }catch(Exception ignored){}
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
      JSONArray scope=new JSONArray(app.prefs.getString("djScope","[]"));
      for(int i=0;i<scope.length();i++)if(app.track(scope.optString(i))!=null)smartScope.add(scope.optString(i));
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
    audioProcessor.close();
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
