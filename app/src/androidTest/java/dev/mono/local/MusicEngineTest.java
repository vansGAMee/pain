package dev.mono.local;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MusicEngineTest {
  private JSONObject call(String method,JSONObject args) throws Exception {
    MonoApp app=(MonoApp)InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
    CompletableFuture<JSONObject> result=new CompletableFuture<>();
    app.music.call(method,args,(data,error)->{if(error!=null)result.completeExceptionally(new AssertionError(error));else result.complete(data);});
    return result.get(20,TimeUnit.SECONDS);
  }
  @Test public void sharedWorkerRunsOfflineAndProducesSoundProfilesAndVibes() throws Exception {
    JSONArray tracks=new JSONArray();for(String id:new String[]{"test-a","test-b","test-c"})tracks.put(new JSONObject().put("id",id).put("uri","file:///"+id).put("duration",180000).put("title",id).put("artist",id));
    assertTrue(call("update",new JSONObject().put("tracks",tracks).put("stats",new JSONObject().put("plays",new JSONArray()))).optBoolean("ready"));
    JSONArray wave=new JSONArray();for(int i=0;i<2048;i++)wave.put(.25*Math.sin(2*Math.PI*700*i/48000));
    for(int i=0;i<25;i++)call("audio",new JSONObject().put("track","test-a").put("rate",48000).put("wall",i*500)
        .put("position",i*500).put("speed",1).put("playing",true).put("channels",new JSONArray().put(wave).put(wave)));
    JSONObject state=call("state",new JSONObject());assertTrue(state.getJSONObject("profiles").getJSONObject("test-a").getInt("frames")>=20);
    JSONObject vibe=call("vibe",new JSONObject().put("action","save").put("track","test-a").put("name","Тест"));
    assertEquals(1,vibe.getJSONArray("items").length());
    JSONObject selection=call("choose",new JSONObject().put("ids",new JSONArray().put("test-a").put("test-b").put("test-c")).put("current","test-a").put("seed",123));
    assertTrue(selection.getString("next").startsWith("test-"));assertNotEquals("test-a",selection.getString("next"));
    assertEquals(0,call("insights",new JSONObject()).getLong("totalMs"));
  }
  @Test public void decodedPlaybackBuildsProfilesInBackgroundWithBothSoundModes() throws Exception {
    var inst=InstrumentationRegistry.getInstrumentation();var context=inst.getTargetContext();
    MonoApp app=(MonoApp)context.getApplicationContext();
    java.io.File wav=new java.io.File(context.getFilesDir(),"native-profile-test.wav");RepositoryTest.writeWav(wav,30);
    app.io.submit(()->{try{app.repo.importUri(android.net.Uri.fromFile(wav));}catch(Exception e){throw new RuntimeException(e);}}).get();app.refresh();
    android.app.Activity activity=inst.startActivitySync(new android.content.Intent(context,MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
    long until=android.os.SystemClock.elapsedRealtime()+10000;
    while((app.service==null||app.tracks.stream().noneMatch(t->t.uri.equals(android.net.Uri.fromFile(wav).toString())))&&android.os.SystemClock.elapsedRealtime()<until)Thread.sleep(50);
    Track track=app.tracks.stream().filter(t->t.uri.equals(android.net.Uri.fromFile(wav).toString())).findFirst().orElseThrow();
    inst.runOnMainSync(()->{
      app.prefs.edit().putBoolean("autoEq",true).putBoolean("smartVolume",true).apply();app.service.applyPreferences();
      app.service.setScope(java.util.List.of(track));app.service.player.setMediaItem(track.mediaItem());app.service.player.prepare();app.service.player.play();activity.moveTaskToBack(true);
    });
    try {
      Thread.sleep(14000);
      inst.runOnMainSync(()->{assertTrue(app.service.player.isPlaying());assertTrue(app.service.player.getCurrentPosition()>10000);app.service.player.pause();});
      call("boundary",new JSONObject());
      JSONObject state=call("state",new JSONObject());JSONObject profile=state.getJSONObject("profiles").optJSONObject(track.id);
      assertNotNull("Native PCM must reach the shared analyser",profile);
      assertTrue("A usable sound profile: "+profile,profile.getInt("frames")>=20);assertTrue(profile.getDouble("seconds")>=10);
    } finally {
      inst.runOnMainSync(()->{app.prefs.edit().putBoolean("autoEq",false).putBoolean("smartVolume",false).apply();app.service.applyPreferences();app.service.player.clearMediaItems();activity.finish();});wav.delete();
    }
  }
}
