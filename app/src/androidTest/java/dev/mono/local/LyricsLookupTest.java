package dev.mono.local;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LyricsLookupTest {
 MonoApp app;Repository previous,repo;Track song;boolean enabled;String mode;
 <T>T io(Callable<T> task)throws Exception{return app.io.submit(task).get(15,TimeUnit.SECONDS);}
 @Before public void setup()throws Exception{
  app=(MonoApp)InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();enabled=app.prefs.getBoolean("onlineLyrics",true);mode=app.prefs.getString("lyricsSourceMode","auto");app.prefs.edit().putBoolean("onlineLyrics",true).putString("lyricsSourceMode","auto").commit();
  io(()->{previous=app.repo;app.deleteDatabase("lyrics-lookup-test.db");repo=new Repository(app,"lyrics-lookup-test.db");app.repo=repo;
   repo.importJson(new JSONObject().put("tracks",new JSONArray().put(new JSONObject().put("id","lyrics-fixture").put("uri","file:///fixture").put("title","Example song").put("artist","Example artist").put("duration",180000))).toString());song=repo.tracks().get(0);return null;});
 }
 @After public void cleanup()throws Exception{io(()->{app.repo=previous;repo.close();app.deleteDatabase("lyrics-lookup-test.db");return null;});app.prefs.edit().putBoolean("onlineLyrics",enabled).putString("lyricsSourceMode",mode).commit();}
 JSONObject record(double duration)throws Exception{return new JSONObject().put("trackName",song.title).put("artistName",song.artist).put("duration",duration).put("syncedLyrics","[00:01.00]Published words").put("plainLyrics","Published words");}
 @Test public void timingRequiresMatchingRecordingAndNeverInventsSync()throws Exception{
  assertTrue(LyricsLookup.choose(song,new JSONArray().put(record(181.9))).startsWith("["));
  assertEquals("Published words",LyricsLookup.choose(song,new JSONArray().put(record(210))));
  assertNull(LyricsLookup.choose(song,new JSONArray().put(record(180).put("trackName","Different song"))));
 }
 @Test public void httpLookupCachesTimedLyricsAndPreservesManualEdits()throws Exception{
  try(ServerSocket server=new ServerSocket(0,2,InetAddress.getByName("127.0.0.1"))){
   ExecutorService responder=Executors.newSingleThreadExecutor();
   Future<?> requests=responder.submit(()->{try{for(int i=0;i<2;i++)try(Socket socket=server.accept()){
    BufferedReader in=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));String request=in.readLine();assertTrue(request.startsWith("GET /api/get?"));for(String line;(line=in.readLine())!=null&&!line.isEmpty();){ }
    byte[] bytes=record(180).toString().getBytes(StandardCharsets.UTF_8);OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();
   }}catch(Exception e){throw new RuntimeException(e);}});
   try{
    LyricsLookup lookup=new LyricsLookup(app,"http://127.0.0.1:"+server.getLocalPort());CountDownLatch first=new CountDownLatch(1);boolean[] saved={false};lookup.fetch(song,true,value->{saved[0]=value;first.countDown();});assertTrue(first.await(12,TimeUnit.SECONDS));assertTrue(saved[0]);assertEquals("[00:01.00]Published words",io(()->repo.lyrics(song.id)));
    io(()->{repo.saveLyrics(song.id,"My edited words",250);return null;});CountDownLatch second=new CountDownLatch(1);lookup.fetch(song,true,value->{saved[0]=value;second.countDown();});assertTrue(second.await(12,TimeUnit.SECONDS));assertFalse(saved[0]);assertEquals("My edited words",io(()->repo.lyrics(song.id)));assertEquals(250,(int)io(()->repo.offset(song.id)));requests.get(5,TimeUnit.SECONDS);
   }finally{responder.shutdownNow();}
  }
 }
 @Test public void primaryFailureUsesIndependentTimedFallback()throws Exception{
  try(ServerSocket server=new ServerSocket(0,4,InetAddress.getByName("127.0.0.1"))){
   ExecutorService responder=Executors.newSingleThreadExecutor();List<String> paths=new ArrayList<>();
   Future<?> requests=responder.submit(()->{try{for(int i=0;i<3;i++)try(Socket socket=server.accept()){
    BufferedReader in=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));String request=in.readLine();paths.add(request);for(String line;(line=in.readLine())!=null&&!line.isEmpty();){ }
    int status=request.contains("/api/get?")?503:200;String body;
    if(request.contains("/download?"))body=new JSONObject().put("content",android.util.Base64.encodeToString("[00:01.00]Published backup words".getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP)).toString();
    else body=new JSONObject().put("candidates",new JSONArray().put(new JSONObject().put("id","123").put("accesskey","ABC123").put("song",song.title).put("singer",song.artist).put("duration",180000))).toString();
    byte[] bytes=body.getBytes(StandardCharsets.UTF_8);OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 "+status+" Result\r\nContent-Type: application/json\r\nRetry-After: 90\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();
   }}catch(Exception e){throw new RuntimeException(e);}});
   try{String base="http://127.0.0.1:"+server.getLocalPort();LyricsLookup lookup=new LyricsLookup(app,base,base);CountDownLatch done=new CountDownLatch(1);boolean[] saved={false};lookup.fetch(song,true,value->{saved[0]=value;done.countDown();});assertTrue(done.await(12,TimeUnit.SECONDS));assertTrue(saved[0]);assertEquals("[00:01.00]Published backup words",io(()->repo.lyrics(song.id)));requests.get(5,TimeUnit.SECONDS);assertEquals(3,paths.size());assertTrue(paths.get(1).startsWith("GET /search?"));assertTrue(paths.get(2).startsWith("GET /download?"));lookup.mode("regional");assertEquals("regional",lookup.mode());}finally{responder.shutdownNow();}
  }
 }
}
