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
  private final String origin,backup;
  private final ExecutorService network=Executors.newSingleThreadExecutor();
  private final Set<String> pending=new HashSet<>();
  private final Map<String,Long> nextRequest=new HashMap<>();
  private volatile int generation;
  private volatile HttpURLConnection active;
  public LyricsLookup(MonoApp app){this(app,"https://lrclib.net");}
  LyricsLookup(MonoApp app,String origin){this(app,origin,"https://lyrics.kugou.com");}
  LyricsLookup(MonoApp app,String origin,String backup){this.app=app;this.origin=origin;this.backup=backup;}
  public void enabled(boolean value){app.prefs.edit().putBoolean("onlineLyrics",value).apply();generation++;if(active!=null)active.disconnect();}
  public String mode(){String m=app.prefs.getString("lyricsSourceMode","auto");return m.equals("regional")||m.equals("primary")?m:"auto";}
  public void mode(String value){if(!Arrays.asList("auto","regional","primary").contains(value))return;app.prefs.edit().putString("lyricsSourceMode",value).apply();generation++;if(active!=null)active.disconnect();}
  private static String norm(String s){return Normalizer.normalize(s,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replace('ё','е').replaceAll("[^\\p{L}\\p{N}]","");}
  private static String encode(String s)throws Exception{return URLEncoder.encode(s,StandardCharsets.UTF_8.name());}
  private String request(String provider,String endpoint,String query)throws Exception{
    long wait=nextRequest.getOrDefault(provider,0L)-System.currentTimeMillis();if(wait>1000)throw new IOException("Lyrics provider is busy");if(wait>0)Thread.sleep(wait);
    if(!app.prefs.getBoolean("onlineLyrics",true))throw new IOException("Lyrics search disabled");
    HttpURLConnection c=(HttpURLConnection)new URL((provider.equals("primary")?origin+"/api/":backup+"/")+endpoint+"?"+query).openConnection();active=c;
    c.setConnectTimeout(6000);c.setReadTimeout(8000);c.setRequestProperty("User-Agent","PAIN/"+BuildConfig.VERSION_NAME+" (https://github.com/vansGAMee/pain)");c.setRequestProperty("Accept","application/json");
    try{
      int status=c.getResponseCode();nextRequest.put(provider,System.currentTimeMillis()+350);
      if(status==429||status==503){long retry=60000;try{retry=Math.max(1,Long.parseLong(c.getHeaderField("Retry-After")))*1000;}catch(Exception ignored){}nextRequest.put(provider,System.currentTimeMillis()+retry);throw new IOException("Lyrics provider is busy");}
      if(status==404)return "";if(status!=200)throw new IOException("Lyrics HTTP "+status);
      String text;try(InputStream in=c.getInputStream()){text=new String(Io.read(in,2*1024*1024),StandardCharsets.UTF_8);}
      return text;
    }finally{active=null;c.disconnect();}
  }
  private String primary(Track track)throws Exception{
    String query="track_name="+encode(track.title)+"&artist_name="+encode(track.artist);
    String exact=query;if(!track.album.isBlank()&&!track.album.equalsIgnoreCase("Download"))exact+="&album_name="+encode(track.album);
    if(track.duration>=1000&&track.duration<=3600000)exact+="&duration="+Math.round(track.duration/1000.0);
    // A failed connection switches hosts immediately, instead of repeating the same timeout.
    String body=request("primary","get",exact),found=body.isEmpty()?null:choose(track,new JSONArray().put(new JSONObject(body)));
    if(found!=null&&!Lrc.parse(found).isEmpty())return found;
    try{body=request("primary","search",query);String other=body.isEmpty()?null:choose(track,new JSONArray(body));return other!=null?other:found;}catch(Exception e){if(found!=null)return found;throw e;}
  }
  private String regional(Track track)throws Exception{
    String body=request("regional","search","ver=1&man=yes&client=pc&keyword="+encode(track.artist+" "+track.title)+"&duration="+track.duration);
    JSONArray candidates=body.isEmpty()?new JSONArray():new JSONObject(body).optJSONArray("candidates");JSONObject best=null;
    for(int i=0;candidates!=null&&i<candidates.length();i++){
      JSONObject r=candidates.optJSONObject(i);if(r==null||!norm(r.optString("song")).equals(norm(track.title))||!norm(r.optString("singer")).equals(norm(track.artist))||!r.optString("id").matches("[0-9]+")||!r.optString("accesskey").matches("[A-Za-z0-9]+"))continue;
      if(best==null||Math.abs(r.optLong("duration")-track.duration)<Math.abs(best.optLong("duration")-track.duration))best=r;
    }
    if(best==null)return null;
    body=request("regional","download","ver=1&client=pc&fmt=lrc&charset=utf8&id="+encode(best.getString("id"))+"&accesskey="+encode(best.getString("accesskey")));
    String encoded=body.isEmpty()?"":new JSONObject(body).optString("content");if(encoded.length()>300000)return null;
    String lrc=new String(android.util.Base64.decode(encoded,android.util.Base64.DEFAULT),StandardCharsets.UTF_8);
    return choose(track,new JSONArray().put(new JSONObject().put("trackName",best.optString("song")).put("artistName",best.optString("singer")).put("duration",best.optDouble("duration")/1000).put("syncedLyrics",lrc)));
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
    String sourceMode=mode();int run=generation;String pendingKey=track.id+":"+sourceMode+":"+run;
    String key="lyricsMiss:2:"+sourceMode+":"+track.id+":"+track.duration+":"+track.bytes;
    if(!force&&System.currentTimeMillis()-app.prefs.getLong(key,0)<86400000)return;
    synchronized(pending){if(!pending.add(pendingKey))return;}
    network.execute(()->{
      String found=null;boolean answered=false;
      try{
        if(track.title.isBlank()||track.artist.isBlank()||track.artist.equals("<unknown>")||track.artist.equals("Неизвестный исполнитель"))return;
        String[] providers=sourceMode.equals("primary")?new String[]{"primary"}:sourceMode.equals("regional")?new String[]{"regional","primary"}:new String[]{"primary","regional"};
        for(String provider:providers){
          if(run!=generation||!app.prefs.getBoolean("onlineLyrics",true))return;
          try{String other=provider.equals("primary")?primary(track):regional(track);answered=true;if(other!=null){if(found==null||!Lrc.parse(other).isEmpty())found=other;if(!Lrc.parse(other).isEmpty())break;}}catch(Exception ignored){}
        }
        if(found==null&&answered&&run==generation)app.prefs.edit().putLong(key,System.currentTimeMillis()).apply();
      }catch(Exception ignored){}
      finally{
        synchronized(pending){pending.remove(pendingKey);}
        String body=found;
        app.io.execute(()->{
          boolean changed=false;
          if(body!=null&&!body.isBlank()&&run==generation&&app.prefs.getBoolean("onlineLyrics",true)&&!app.repo.hasLyrics(track.id)){
            app.repo.saveLyrics(track.id,body,0);app.companion.generation++;changed=true;
          }
          boolean saved=changed;app.main.post(()->{if(callback!=null)callback.accept(saved);});
        });
      }
    });
  }
}
