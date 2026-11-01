package dev.mono.local;
import org.json.*;

/** Explicit resume request; receiving it never interrupts phone playback. */
final class PlaybackHandoff {
 static JSONObject receive(MonoApp app,JSONObject input)throws Exception{
  JSONObject track=input.getJSONObject("track");double position=input.getDouble("positionMs");
  if(!Double.isFinite(position)||position<0||position>86400000||track.getDouble("duration")<=0||position>=track.getDouble("duration"))throw new IllegalArgumentException("Invalid playback position");
  if(app.repo.removals.blocked(track))throw new IllegalArgumentException("Recording removed from library");
  Track resolved=resolve(app,track);if(resolved==null)throw new IllegalArgumentException("Sync this recording first");
  JSONObject saved=new JSONObject().put("track",CompanionStore.pack(resolved)).put("positionMs",Math.round(position)).put("receivedAt",System.currentTimeMillis());
  if(!app.prefs.edit().putString("playbackHandoff",saved.toString()).commit())throw new java.io.IOException("Could not save playback position");
  app.main.post(app::changed);return new JSONObject().put("status","ok");
 }
 static Track resolve(MonoApp app,JSONObject portable)throws Exception{
  String key=CompanionStore.trackKey(portable);Track match=null;
  for(Track track:app.repo.tracks())if(CompanionStore.trackKey(CompanionStore.pack(track)).equals(key)){
   if(track.id.equals(portable.optString("id")))return track;if(match!=null)return null;match=track;
  }return match;
 }
}
