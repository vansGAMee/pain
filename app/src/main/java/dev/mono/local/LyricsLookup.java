package dev.mono.local;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.json.*;

/** Current-song lookup, a separate network thread, and a durable local result.
 * LRCLIB's documented ±2s duration match is required for synchronized lyrics. */
public final class LyricsLookup {
  private final MonoApp app;
  private final String origin;
  private final ExecutorService network=Executors.newSingleThreadExecutor();
  private final Set<String> pending=new HashSet<>();
  private long nextRequest;
  private volatile HttpURLConnection active;
  public LyricsLookup(MonoApp app){this(app,"https://lrclib.net");}
  LyricsLookup(MonoApp app,String origin){this.app=app;this.origin=origin;}
  public void enabled(boolean value){app.prefs.edit().putBoolean("onlineLyrics",value).apply();if(!value&&active!=null)active.disconnect();}
  private static String norm(String s){return Normalizer.normalize(s,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replace('ё','е').replaceAll("[^\\p{L}\\p{N}]","");}
  private static String encode(String s)throws Exception{return URLEncoder.encode(s,StandardCharsets.UTF_8.name());}
  private JSONObject request(String endpoint,String query)throws Exception{
    long wait=nextRequest-System.currentTimeMillis();if(wait>1000)throw new IOException("Lyrics provider is busy");if(wait>0)Thread.sleep(wait);
    if(!app.prefs.getBoolean("onlineLyrics",true))throw new IOException("Lyrics search disabled");
    HttpURLConnection c=(HttpURLConnection)new URL(origin+"/api/"+endpoint+"?"+query).openConnection();active=c;
    c.setConnectTimeout(6000);c.setReadTimeout(8000);c.setRequestProperty("User-Agent","PAIN/"+BuildConfig.VERSION_NAME+" (https://github.com/vansGAMee/pain)");c.setRequestProperty("Accept","application/json");
    try{
      int status=c.getResponseCode();nextRequest=System.currentTimeMillis()+350;
      if(status==429||status==503){long retry=60000;try{retry=Math.max(1,Long.parseLong(c.getHeaderField("Retry-After")))*1000;}catch(Exception ignored){}nextRequest=System.currentTimeMillis()+retry;throw new IOException("Lyrics provider is busy");}
      if(status==404)return new JSONObject();if(status!=200)throw new IOException("Lyrics HTTP "+status);
      String text;try(InputStream in=c.getInputStream()){text=new String(Io.read(in,2*1024*1024),StandardCharsets.UTF_8);}
      return endpoint.equals("search")?new JSONObject().put("records",new JSONArray(text)):new JSONObject().put("records",new JSONArray().put(new JSONObject(text)));
    }finally{active=null;c.disconnect();}
  }
  static String choose(Track track,JSONArray records)throws Exception{
    String plain=null;
    for(int i=0;i<records.length();i++){
      JSONObject r=records.getJSONObject(i);if(!norm(r.optString("trackName")).equals(norm(track.title))||!norm(r.optString("artistName")).equals(norm(track.artist)))continue;
      String timed=r.isNull("syncedLyrics")?"":r.optString("syncedLyrics"),text=r.isNull("plainLyrics")?"":r.optString("plainLyrics");
      boolean matches=track.duration>0&&Math.abs(r.optDouble("duration",-10000)-track.duration/1000.0)<=2;
      if(matches&&!timed.isBlank()&&timed.length()<=200000&&!Lrc.parse(timed).isEmpty())return timed;
      if(plain==null&&!text.isBlank()&&text.length()<=200000)plain=text;
      if(plain==null&&!timed.isBlank()&&timed.length()<=200000)plain=String.join("\n",Lrc.parse(timed).stream().map(l->l.text).filter(s->!s.isBlank()).toArray(String[]::new));
    }
    return plain;
  }
  public void fetch(Track track,boolean force,Consumer<Boolean> callback){
    if(track==null||!app.prefs.getBoolean("onlineLyrics",true))return;
    String key="lyricsMiss:"+track.id+":"+track.duration+":"+track.bytes;
    if(!force&&System.currentTimeMillis()-app.prefs.getLong(key,0)<86400000)return;
    synchronized(pending){if(!pending.add(track.id))return;}
    network.execute(()->{
      String found=null;boolean answered=false;
      try{
        if(track.title.isBlank()||track.artist.isBlank()||track.artist.equals("<unknown>")||track.artist.equals("Неизвестный исполнитель"))return;
        String query="track_name="+encode(track.title)+"&artist_name="+encode(track.artist);
        String exact=query;if(!track.album.isBlank()&&!track.album.equalsIgnoreCase("Download"))exact+="&album_name="+encode(track.album);
        if(track.duration>=1000&&track.duration<=3600000)exact+="&duration="+Math.round(track.duration/1000.0);
        try{JSONObject data=request("get",exact);answered=true;found=choose(track,data.optJSONArray("records")==null?new JSONArray():data.getJSONArray("records"));}catch(IOException ignored){}
        if(found==null||Lrc.parse(found).isEmpty()){
          answered=false;
          try{JSONObject data=request("search",query);answered=true;String other=choose(track,data.optJSONArray("records")==null?new JSONArray():data.getJSONArray("records"));if(other!=null)found=other;}catch(IOException ignored){}
        }
        if(found==null&&answered)app.prefs.edit().putLong(key,System.currentTimeMillis()).apply();
      }catch(Exception ignored){}
      finally{
        synchronized(pending){pending.remove(track.id);}
        String body=found;
        app.io.execute(()->{
          boolean changed=false;
          if(body!=null&&!body.isBlank()&&app.prefs.getBoolean("onlineLyrics",true)&&!app.repo.hasLyrics(track.id)){
            app.repo.saveLyrics(track.id,body,0);app.companion.generation++;changed=true;
          }
          boolean saved=changed;app.main.post(()->{if(callback!=null)callback.accept(saved);});
        });
      }
    });
  }
}
