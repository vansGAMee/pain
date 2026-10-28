package dev.mono.local;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.*;
import org.json.*;

/** Portable collections; called on MonoApp.io, independent of UI and audio. */
public final class CompanionStore {
  private final MonoApp app;
  public volatile int generation;
  private List<Track> indexedTracks;
  private final Map<String,Track> byId=new HashMap<>(),byKey=new HashMap<>();
  private final Set<String> ambiguous=new HashSet<>();
  public CompanionStore(MonoApp app){this.app=app;}
  private static String norm(String s){return Normalizer.normalize(s,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replace('ё','е').replaceAll("[^\\p{L}\\p{N}]","");}
  private static String hash(String s)throws Exception{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));char[] out=new char[bytes.length*2],hex="0123456789abcdef".toCharArray();for(int i=0;i<bytes.length;i++){out[i*2]=hex[(bytes[i]&255)>>>4];out[i*2+1]=hex[bytes[i]&15];}return new String(out);}
  public static JSONObject pack(Track t)throws Exception{return new JSONObject().put("id",t.id).put("title",t.title).put("artist",t.artist).put("album",t.album).put("duration",t.duration).put("bytes",t.bytes);}
  public static String trackKey(JSONObject t)throws Exception{return hash(norm(t.optString("title"))+"\0"+norm(t.optString("artist"))+"\0"+t.optLong("duration")+"\0"+t.optLong("bytes"));}
  private Track resolve(JSONObject p)throws Exception{
    if(indexedTracks!=app.tracks){byId.clear();byKey.clear();ambiguous.clear();for(Track t:app.tracks){byId.put(t.id,t);String key=trackKey(pack(t));if(byKey.put(key,t)!=null)ambiguous.add(key);}indexedTracks=app.tracks;}
    Track exact=byId.get(p.optString("id"));String key=trackKey(p);
    if(exact!=null&&trackKey(pack(exact)).equals(key))return exact;
    return ambiguous.contains(key)?null:byKey.get(key);
  }
  private static List<String> keys(JSONObject object){List<String> keys=new ArrayList<>();object.keys().forEachRemaining(keys::add);Collections.sort(keys);return keys;}
  private static String canonical(Object value)throws Exception{
    if(value instanceof JSONObject){JSONObject o=(JSONObject)value;StringJoiner j=new StringJoiner(",","{","}");for(String k:keys(o))j.add(JSONObject.quote(k)+":"+canonical(o.get(k)));return j.toString();}
    if(value instanceof JSONArray){JSONArray a=(JSONArray)value;StringJoiner j=new StringJoiner(",","[","]");for(int i=0;i<a.length();i++)j.add(canonical(a.get(i)));return j.toString();}
    return value instanceof String?JSONObject.quote((String)value):String.valueOf(value);
  }
  private void store(String key,String kind,Long local,JSONObject value)throws Exception{
    ContentValues v=new ContentValues();v.put("key",key);v.put("kind",kind);if(local!=null)v.put("local_id",local);v.put("value",value.toString());
    app.repo.getWritableDatabase().insertWithOnConflict("companion_entities",null,v,SQLiteDatabase.CONFLICT_REPLACE);
  }
  public JSONObject snapshot()throws Exception{
    SQLiteDatabase d=app.repo.getWritableDatabase();JSONObject entities=new JSONObject(),stored=new JSONObject();Map<Long,String> links=new HashMap<>();
    try(Cursor c=d.rawQuery("SELECT key,kind,local_id,value FROM companion_entities",null)){
      while(c.moveToNext()){String key=c.getString(0),kind=c.getString(1);JSONObject value=new JSONObject(c.getString(3));stored.put(key,value);
        if(kind.equals("playlist"))links.put(c.getLong(2),key);
        else if(!kind.equals("lyrics")&&!kind.equals("excluded"))entities.put(key,value);
        else{Track t=resolve(value.getJSONObject("track"));if(t==null)entities.put(key,value);
          else if(kind.equals("lyrics")&&!app.repo.hasLyrics(t.id))app.repo.saveLyrics(t.id,value.getString("body"),value.optInt("offset"));
          else if(kind.equals("excluded")&&!value.optBoolean("_resolved",true)){
            JSONArray exclusions=new JSONArray(app.prefs.getString("djExcluded","[]"));exclusions.put(t.id);app.prefs.edit().putString("djExcluded",exclusions.toString()).commit();value.put("_resolved",true);store(key,kind,null,value);
          }
        }
      }
    }
    for(var entry:app.repo.playlists().entrySet()){
      long local=entry.getKey();String key=links.get(local);if(key==null)key="playlist:phone_"+UUID.randomUUID();
      JSONArray songs=new JSONArray();Set<String> known=new HashSet<>();
      for(String id:app.repo.playlist(local)){Track t=app.repo.track(id);if(t!=null){JSONObject p=pack(t);if(known.add(trackKey(p)))songs.put(p);}}
      JSONObject prior=stored.optJSONObject(key);JSONArray manifest=prior==null?null:prior.optJSONArray("tracks");
      boolean arrived=false;
      if(manifest!=null){Map<String,List<JSONObject>> gaps=new HashMap<>();Set<String> anchors=new HashSet<>(known),previous=new HashSet<>();JSONArray priorResolved=prior.optJSONArray("_resolved");if(priorResolved!=null)for(int i=0;i<priorResolved.length();i++)previous.add(priorResolved.getString(i));else for(int i=0;i<manifest.length();i++){JSONObject p=manifest.getJSONObject(i);if(resolve(p)!=null)previous.add(trackKey(p));}String anchor="";
        for(int i=manifest.length()-1;i>=0;i--){JSONObject p=manifest.getJSONObject(i);String k=trackKey(p);
          if(anchors.contains(k))anchor=k;else if(!known.contains(k)){Track t=resolve(p);if(t==null||!previous.contains(k)){gaps.computeIfAbsent(anchor,unused->new ArrayList<>()).add(t==null?p:pack(t));known.add(k);if(t!=null)arrived=true;}}
        }
        JSONArray ordered=new JSONArray();for(int i=0;i<=songs.length();i++){String k=i==songs.length()?"":trackKey(songs.getJSONObject(i));List<JSONObject> gap=gaps.get(k);if(gap!=null)for(int j=gap.size()-1;j>=0;j--)ordered.put(gap.get(j));if(i<songs.length())ordered.put(songs.get(i));}songs=ordered;
      }
      if(arrived){d.delete("playlist_tracks","list=?",new String[]{String.valueOf(local)});for(int i=0;i<songs.length();i++){Track t=resolve(songs.getJSONObject(i));if(t!=null)app.repo.addToPlaylist(local,t.id);}}
      JSONObject value=new JSONObject().put("kind","playlist").put("name",entry.getValue()).put("tracks",songs);entities.put(key,value);store(key,"playlist",local,withResolved(value));
    }
    try(Cursor c=d.rawQuery("SELECT track,body,offset FROM lyrics",null)){
      while(c.moveToNext()){Track t=app.repo.track(c.getString(0));String body=c.getString(1);if(t==null||body==null||body.isBlank())continue;
        JSONObject song=pack(t);entities.put("lyrics:"+trackKey(song),new JSONObject().put("kind","lyrics").put("track",song).put("body",body).put("offset",c.getInt(2)));
      }
    }
    JSONArray excluded=new JSONArray(app.prefs.getString("djExcluded","[]"));
    for(int i=0;i<excluded.length();i++){Track t=app.repo.track(excluded.getString(i));if(t!=null){JSONObject song=pack(t);entities.put("excluded:"+trackKey(song),new JSONObject().put("kind","excluded").put("track",song));}}
    return new JSONObject().put("schema",1).put("entities",entities).put("revision",hash(canonical(entities)));
  }
  private JSONObject withResolved(JSONObject value)throws Exception{
    JSONObject stored=new JSONObject(value.toString());if(value.getString("kind").equals("playlist")){JSONArray songs=value.getJSONArray("tracks"),resolved=new JSONArray();for(int i=0;i<songs.length();i++)if(resolve(songs.getJSONObject(i))!=null)resolved.put(trackKey(songs.getJSONObject(i)));stored.put("_resolved",resolved);}
    else if(value.getString("kind").equals("excluded"))stored.put("_resolved",resolve(value.getJSONObject("track"))!=null);return stored;
  }
  private static void validate(JSONObject entities)throws Exception{
    if(entities.length()>12000)throw new IllegalArgumentException("Too many shared items");
    for(String key:keys(entities)){
      if(key.length()>256)throw new IllegalArgumentException("Invalid shared key");JSONObject v=entities.getJSONObject(key);String kind=v.getString("kind");
      if(!List.of("playlist","lyrics","genres","excluded","moment").contains(kind))throw new IllegalArgumentException("Unknown shared kind");
      JSONArray songs=kind.equals("playlist")?v.getJSONArray("tracks"):new JSONArray().put(v.getJSONObject("track"));
      if(songs.length()>10000)throw new IllegalArgumentException("Playlist too large");
      for(int i=0;i<songs.length();i++){JSONObject s=songs.getJSONObject(i);if(s.getString("title").length()>2000||s.getString("artist").length()>2000||s.getDouble("duration")<0||s.getDouble("bytes")<0)throw new IllegalArgumentException("Invalid shared song");}
      if(kind.equals("playlist")&&v.getString("name").length()>300)throw new IllegalArgumentException("Invalid playlist name");
      if(kind.equals("lyrics")&&(v.getString("body").length()>200000||Math.abs(v.optDouble("offset"))>86400000))throw new IllegalArgumentException("Invalid shared lyrics");
      if(kind.equals("moment")&&(!Double.isFinite(v.getDouble("seconds"))||v.getDouble("seconds")<0||v.getDouble("seconds")>=86400))throw new IllegalArgumentException("Invalid shared moment");
    }
  }
  /** Null means the user edited the phone after the PC fetched its snapshot. */
  public JSONObject apply(String expected,JSONObject entities)throws Exception{
    validate(entities);JSONObject current=snapshot();if(!current.getString("revision").equals(expected))return null;
    JSONObject previous=current.getJSONObject("entities");
    try(FileOutputStream out=new FileOutputStream(new File(app.getFilesDir(),"companion-before-sync.json"))){out.write(current.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
    SQLiteDatabase d=app.repo.getWritableDatabase();Set<String> excluded=new LinkedHashSet<>();JSONArray beforeExcluded=new JSONArray(app.prefs.getString("djExcluded","[]"));for(int i=0;i<beforeExcluded.length();i++)excluded.add(beforeExcluded.getString(i));
    d.beginTransaction();try{
      for(String key:keys(previous))if(!entities.has(key)){
        JSONObject old=previous.getJSONObject(key);String kind=old.getString("kind");
        if(kind.equals("playlist")){try(Cursor c=d.rawQuery("SELECT local_id FROM companion_entities WHERE key=?",new String[]{key})){if(c.moveToFirst())app.repo.deletePlaylist(c.getLong(0));}}
        else{Track t=resolve(old.getJSONObject("track"));if(t!=null){if(kind.equals("lyrics"))app.repo.saveLyrics(t.id,"",0);if(kind.equals("excluded"))excluded.remove(t.id);}}
        d.delete("companion_entities","key=?",new String[]{key});
      }
      for(String key:keys(entities)){
        JSONObject v=entities.getJSONObject(key);String kind=v.getString("kind");Long local=null;
        if(kind.equals("playlist")){
          try(Cursor c=d.rawQuery("SELECT local_id FROM companion_entities WHERE key=?",new String[]{key})){if(c.moveToFirst())local=c.getLong(0);}
          if(local==null||!app.repo.playlists().containsKey(local))local=app.repo.createPlaylist(v.getString("name"));
          ContentValues name=new ContentValues();name.put("name",v.getString("name"));d.update("playlists",name,"id=?",new String[]{String.valueOf(local)});d.delete("playlist_tracks","list=?",new String[]{String.valueOf(local)});
          JSONArray songs=v.getJSONArray("tracks");for(int i=0;i<songs.length();i++){Track t=resolve(songs.getJSONObject(i));if(t!=null)app.repo.addToPlaylist(local,t.id);}
        }else{
          Track t=resolve(v.getJSONObject("track"));if(t!=null){
            if(kind.equals("lyrics"))app.repo.saveLyrics(t.id,v.getString("body"),v.optInt("offset"));
            if(kind.equals("excluded"))excluded.add(t.id);
          }
        }
        store(key,kind,local,withResolved(v));
      }
      d.setTransactionSuccessful();
    }finally{d.endTransaction();}
    JSONArray exclusions=new JSONArray();for(String id:excluded)exclusions.put(id);if(!app.prefs.edit().putString("djExcluded",exclusions.toString()).commit())throw new IOException("Could not save shared exclusions");
    generation++;return snapshot();
  }
  public JSONObject info(Track track)throws Exception{
    String key="genres:"+trackKey(pack(track));try(Cursor c=app.repo.getReadableDatabase().rawQuery("SELECT value FROM companion_entities WHERE key=?",new String[]{key})){return c.moveToFirst()?new JSONObject(c.getString(0)):null;}
  }
  public void saveMoment(Track track,double seconds)throws Exception{
    if(!Double.isFinite(seconds)||seconds<0||seconds>=86400)throw new IllegalArgumentException("Invalid moment");
    JSONObject song=pack(track);store("moment:"+trackKey(song),"moment",null,new JSONObject().put("kind","moment").put("track",song).put("seconds",seconds));generation++;
  }
  public Double moment(Track track)throws Exception{
    String key="moment:"+trackKey(pack(track));try(Cursor c=app.repo.getReadableDatabase().rawQuery("SELECT value FROM companion_entities WHERE key=?",new String[]{key})){return c.moveToFirst()?new JSONObject(c.getString(0)).optDouble("seconds"):null;}
  }
  public void removeMoment(Track track)throws Exception{app.repo.getWritableDatabase().delete("companion_entities","key=?",new String[]{"moment:"+trackKey(pack(track))});generation++;}
}
