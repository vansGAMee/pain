package dev.mono.local;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.util.*;
import org.json.*;

/** Durable, recording-specific removals. Never delete user-owned MediaStore files. */
public final class LibraryRemovals {
  private final Repository repo;
  LibraryRemovals(Repository repo){this.repo=repo;}
  public JSONObject entries()throws Exception{
    JSONObject result=new JSONObject();
    try(Cursor c=repo.getReadableDatabase().rawQuery("SELECT key,value FROM library_removals",null)){
      while(c.moveToNext())result.put(c.getString(0),new JSONObject(c.getString(1)));
    }return result;
  }
  public boolean blocked(JSONObject track){
    try(Cursor c=repo.getReadableDatabase().rawQuery("SELECT 1 FROM library_removals WHERE key=?",new String[]{CompanionStore.trackKey(track)})){return c.moveToFirst();}
    catch(RuntimeException e){throw e;}catch(Exception e){throw new IllegalArgumentException(e);}
  }
  public boolean blocked(Track track){try{return blocked(CompanionStore.pack(track));}catch(Exception e){throw new IllegalArgumentException(e);}}
  public void rememberId(String id){ContentValues v=new ContentValues();v.put("id",id);repo.getWritableDatabase().insertWithOnConflict("removed_track_ids",null,v,SQLiteDatabase.CONFLICT_IGNORE);}
  public boolean blockedId(String id){try(Cursor c=repo.getReadableDatabase().rawQuery("SELECT 1 FROM removed_track_ids WHERE id=?",new String[]{id})){return c.moveToFirst();}}
  public JSONObject collections(JSONObject entities)throws Exception{
    JSONObject result=new JSONObject();Iterator<String> keys=entities.keys();
    while(keys.hasNext()){
      String key=keys.next();JSONObject v=entities.getJSONObject(key);
      if(v.getString("kind").equals("playlist")){
        v=new JSONObject(v.toString());JSONArray kept=new JSONArray(),songs=v.getJSONArray("tracks");
        for(int i=0;i<songs.length();i++)if(!blocked(songs.getJSONObject(i)))kept.put(songs.getJSONObject(i));v.put("tracks",kept);result.put(key,v);
      }else if(!blocked(v.getJSONObject("track")))result.put(key,v);
    }return result;
  }
  public void remove(Track track)throws Exception{JSONObject song=CompanionStore.pack(track);merge(new JSONObject().put(CompanionStore.trackKey(song),song));}
  public JSONObject merge(JSONObject incoming)throws Exception{
    if(incoming.length()>12000)throw new IllegalArgumentException("Too many removals");
    List<String> keys=new ArrayList<>();incoming.keys().forEachRemaining(keys::add);
    for(String key:keys){JSONObject song=incoming.getJSONObject(key);
      if(!key.equals(CompanionStore.trackKey(song))||song.getString("title").length()>2000||song.getString("artist").length()>2000||!Double.isFinite(song.getDouble("duration"))||!Double.isFinite(song.getDouble("bytes"))||song.getDouble("duration")<0||song.getDouble("bytes")<0)throw new IllegalArgumentException("Invalid removed recording");
    }
    List<Track> managed=new ArrayList<>();
    SQLiteDatabase d=repo.getWritableDatabase();d.beginTransaction();try{
      for(String key:keys){ContentValues v=new ContentValues();v.put("key",key);v.put("value",incoming.getJSONObject(key).toString());d.insertWithOnConflict("library_removals",null,v,SQLiteDatabase.CONFLICT_IGNORE);}
      List<String> removed=new ArrayList<>();
      try(Cursor c=d.rawQuery("SELECT id,title,artist,duration,bytes FROM tracks",null)){
        while(c.moveToNext()){
          JSONObject song=new JSONObject().put("title",c.getString(1)).put("artist",c.getString(2)).put("duration",c.getLong(3)).put("bytes",c.getLong(4));
          if(blocked(song))removed.add(c.getString(0));
        }
      }
      for(String id:removed){managed.add(repo.track(id));ContentValues v=new ContentValues();v.put("id",id);d.insertWithOnConflict("removed_track_ids",null,v,SQLiteDatabase.CONFLICT_IGNORE);
        d.execSQL("DELETE FROM slices WHERE play IN (SELECT id FROM plays WHERE track=?)",new Object[]{id});
        for(String table:new String[]{"plays","lyrics","playlist_tracks"})d.delete(table,"track=?",new String[]{id});d.delete("tracks","id=?",new String[]{id});
      }
      List<String[]> updates=new ArrayList<>();List<String> deletes=new ArrayList<>();
      try(Cursor c=d.rawQuery("SELECT key,value FROM companion_entities",null)){
        while(c.moveToNext()){JSONObject one=new JSONObject().put(c.getString(0),new JSONObject(c.getString(1))),clean=collections(one);
          if(clean.length()==0)deletes.add(c.getString(0));else updates.add(new String[]{c.getString(0),clean.getJSONObject(c.getString(0)).toString()});}
      }
      for(String key:deletes)d.delete("companion_entities","key=?",new String[]{key});
      for(String[] row:updates){ContentValues v=new ContentValues();v.put("value",row[1]);d.update("companion_entities",v,"key=?",new String[]{row[0]});}
      d.setTransactionSuccessful();
    }finally{d.endTransaction();}
    for(Track track:managed)repo.deleteManagedCopy(track);
    SharedPreferences prefs=repo.appPreferences();SharedPreferences.Editor editor=prefs.edit();
    for(String name:new String[]{"djExcluded","queue","djScope"}){JSONArray before=new JSONArray(prefs.getString(name,"[]")),after=new JSONArray();for(int i=0;i<before.length();i++)if(!blockedId(before.getString(i)))after.put(before.getString(i));editor.putString(name,after.toString());if(name.equals("queue")){int old=prefs.getInt("queueIndex",0),next=0;for(int i=0;i<Math.min(old,before.length());i++)if(!blockedId(before.getString(i)))next++;editor.putInt("queueIndex",Math.min(next,Math.max(0,after.length()-1)));if(old<before.length()&&old>=0&&blockedId(before.getString(old)))editor.putLong("position",0);}}
    if(blockedId(prefs.getString("lastTrack","")))editor.remove("lastTrack").remove("position");
    if(!editor.commit())throw new java.io.IOException("Could not save cleaned queue");return entries();
  }
}
