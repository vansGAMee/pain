package dev.mono.local;
import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CompanionStoreTest {
 MonoApp app;Repository previous,repo;List<Track> previousTracks;CompanionStore store;Track a,b;
 <T>T io(Callable<T> action)throws Exception{return app.io.submit(action).get(20,TimeUnit.SECONDS);}
 @Before public void setup()throws Exception{
  app=(MonoApp)InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
  io(()->{previous=app.repo;previousTracks=app.tracks;app.deleteDatabase("companion-test.db");repo=new Repository(app,"companion-test.db");app.repo=repo;
   JSONArray songs=new JSONArray();for(String id:new String[]{"native-a","native-b"})songs.put(new JSONObject().put("id",id).put("uri","file:///fixture/"+id).put("title",id).put("artist","Fixture").put("album","Album").put("duration",180000).put("bytes",123456));
   repo.importJson(new JSONObject().put("tracks",songs).toString());app.tracks=repo.tracks();a=app.tracks.get(0);b=app.tracks.get(1);store=new CompanionStore(app);return null;});
 }
 @After public void cleanup()throws Exception{io(()->{app.repo=previous;app.tracks=previousTracks;repo.close();app.deleteDatabase("companion-test.db");return null;});}
 @Test public void playlistsAndLyricsKeepStableIdsAndRejectStalePhoneRevision()throws Exception{io(()->{
  long list=repo.createPlaylist("Phone list");repo.addToPlaylist(list,a.id);JSONObject first=store.snapshot(),entities=new JSONObject(first.getJSONObject("entities").toString());
  String key=entities.keys().next();assertEquals(first.getString("revision"),store.snapshot().getString("revision"));
  JSONObject song=CompanionStore.pack(b).put("id","old-media-id"),lyrics=new JSONObject().put("kind","lyrics").put("track",song).put("body","[00:01.00]Shared words").put("offset",150);
  entities.put("lyrics:"+CompanionStore.trackKey(song),lyrics);entities.getJSONObject(key).put("name","Renamed on PC").getJSONArray("tracks").put(song);
  JSONObject result=store.apply(first.getString("revision"),entities);assertNotNull(result);assertEquals(1,repo.playlists().size());assertEquals(List.of(a.id,b.id),repo.playlist(list));assertEquals(150,repo.offset(b.id));
  repo.removeFromPlaylist(list,a.id);assertNull(store.apply(result.getString("revision"),entities));assertFalse(repo.playlist(list).contains(a.id));return null;
 });}
 @Test public void metadataUnavailableSongsAndMomentsSurviveRoundTrips()throws Exception{io(()->{
  JSONObject first=store.snapshot(),song=CompanionStore.pack(a),missing=CompanionStore.pack(b).put("title","Absent recording").put("id","absent");
  JSONObject entities=new JSONObject().put("playlist:pc",new JSONObject().put("kind","playlist").put("name","Portable").put("tracks",new JSONArray().put(missing).put(song)));
  String missingKey="lyrics:"+CompanionStore.trackKey(missing);entities.put(missingKey,new JSONObject().put("kind","lyrics").put("track",missing).put("body","Keep unavailable words").put("offset",0));
  entities.put("genres:"+CompanionStore.trackKey(song),new JSONObject().put("kind","genres").put("track",song).put("data",new JSONObject().put("names",new JSONArray().put("rock"))));
  JSONObject result=store.apply(first.getString("revision"),entities);assertNotNull(result);JSONArray portable=result.getJSONObject("entities").getJSONObject("playlist:pc").getJSONArray("tracks");assertEquals(2,portable.length());assertEquals("absent",portable.getJSONObject(0).getString("id"));assertEquals("Keep unavailable words",result.getJSONObject("entities").getJSONObject(missingKey).getString("body"));assertEquals("rock",store.info(a).getJSONObject("data").getJSONArray("names").getString(0));
  store.saveMoment(a,24.5);assertEquals(24.5,store.moment(a),0);store.removeMoment(a);assertNull(store.moment(a));
  repo.importJson(new JSONObject().put("tracks",new JSONArray().put(new JSONObject(missing.toString()).put("id","now-present").put("uri","file:///fixture/arrived"))).toString());app.tracks=repo.tracks();
  store.snapshot();long list=repo.playlists().keySet().iterator().next();assertEquals(List.of("now-present",a.id),repo.playlist(list));assertEquals("Keep unavailable words",repo.lyrics("now-present"));
  repo.removeFromPlaylist(list,"now-present");store.snapshot();assertEquals(List.of(a.id),repo.playlist(list));
  repo.saveLyrics(a.id,"Local edit while syncing",0);String id=result.getString("revision");assertNull(store.apply(id,entities));return null;
 });}
 @Test public void actualHttpEndpointRejectsConcurrentEdits()throws Exception{
  JSONObject first=http(null);assertEquals(1,first.getInt("schema"));JSONObject entities=first.getJSONObject("entities");
  entities.put("playlist:wire",new JSONObject().put("kind","playlist").put("name","Over local HTTP").put("tracks",new JSONArray().put(CompanionStore.pack(a))));
  JSONObject reply=http(new JSONObject().put("revision",first.getString("revision")).put("entities",entities));assertEquals("Over local HTTP",io(()->repo.playlists().values().iterator().next()));
  io(()->{repo.saveLyrics(a.id,"Concurrent phone edit",0);return null;});
  assertEquals(409,http(new JSONObject().put("revision",reply.getString("revision")).put("entities",entities)).getInt("http"));
  InstrumentationRegistry.getInstrumentation().waitForIdleSync();io(()->null);
 }
 JSONObject http(JSONObject body)throws Exception{
  java.net.HttpURLConnection c=(java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:8865/api/companion").openConnection();c.setConnectTimeout(5000);c.setReadTimeout(15000);
  try{if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(var out=c.getOutputStream()){out.write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
   int status=c.getResponseCode();if(status!=200)return new JSONObject().put("http",status);try(var in=c.getInputStream()){return new JSONObject(new String(Io.read(in,4*1024*1024),java.nio.charset.StandardCharsets.UTF_8));}
  }finally{c.disconnect();}
 }
 @Test public void streamedUploadPreservesCompleteAudioAndRejectsInterruptedReplacement()throws Exception{
  java.io.File fixture=new java.io.File(app.getCacheDir(),"upload-fixture.wav");RepositoryTest.writeWav(fixture,3);byte[] bytes=java.nio.file.Files.readAllBytes(fixture.toPath());String name="sync-check-"+UUID.randomUUID()+".wav";
  java.net.HttpURLConnection c=(java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:8865/api/upload-track?filename="+name).openConnection();java.io.File saved=null;
  try{c.setRequestMethod("POST");c.setDoOutput(true);c.setFixedLengthStreamingMode(bytes.length);c.setConnectTimeout(5000);c.setReadTimeout(15000);c.setRequestProperty("Content-Type","audio/wav");try(var out=c.getOutputStream()){out.write(bytes);}assertEquals(200,c.getResponseCode());
   JSONObject result;try(var in=c.getInputStream()){result=new JSONObject(new String(Io.read(in,1024*1024),java.nio.charset.StandardCharsets.UTF_8));}saved=new java.io.File(android.net.Uri.parse(result.getString("uri")).getPath());assertArrayEquals(bytes,java.nio.file.Files.readAllBytes(saved.toPath()));
   try(java.net.Socket socket=new java.net.Socket("127.0.0.1",8865)){var out=socket.getOutputStream();out.write(("POST /api/upload-track?filename="+name+" HTTP/1.1\r\nContent-Length: "+bytes.length+"\r\nContent-Type: audio/wav\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));out.write(bytes,0,512);out.flush();}
   Thread.sleep(150);assertArrayEquals(bytes,java.nio.file.Files.readAllBytes(saved.toPath()));assertEquals(0,app.getCacheDir().listFiles((dir,file)->file.startsWith("sync-upload-")).length);io(()->null);InstrumentationRegistry.getInstrumentation().waitForIdleSync();
  }finally{c.disconnect();fixture.delete();if(saved!=null)saved.delete();}
 }
}
