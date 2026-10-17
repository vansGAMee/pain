package dev.mono.local;
import android.content.Context;
import android.graphics.*;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.*;
import android.util.*;
import android.widget.ImageView;
import java.lang.ref.WeakReference;
import java.util.*;
import java.util.concurrent.*;

/** Bounded, coalesced artwork decoding. View ownership is checked before delivery. */
public final class Art {
 private static final ExecutorService worker=Executors.newFixedThreadPool(2);
 private static final Handler main=new Handler(Looper.getMainLooper());
 private static final LruCache<String,Bitmap> cache=new LruCache<>(16*1024*1024){protected int sizeOf(String k,Bitmap b){return b.getAllocationByteCount();}};
 private static final Map<String,List<WeakReference<ImageView>>> pending=new HashMap<>();
 private static final LruCache<String,Boolean> missing=new LruCache<>(512);
 private static volatile int generation;
 public static void invalidate(){generation++;synchronized(pending){missing.evictAll();cache.evictAll();}}
 public static void load(Context context,ImageView view,Track track){load(context,view,track,true);}
 public static void load(Context context,ImageView view,Track track,boolean placeholder){
   String key=track==null?"":generation+":"+track.uri+":"+track.bytes+":"+track.added;
   if(key.equals(view.getTag()))return;
   view.setTag(key);if(placeholder)view.setImageResource(R.drawable.ic_maple);else view.setImageDrawable(null);
   if(track==null)return;
   synchronized(pending){
     Bitmap hit=cache.get(key);if(hit!=null){view.setImageBitmap(hit);return;}
     if(missing.get(key)!=null)return;
     List<WeakReference<ImageView>> waiting=pending.get(key);
     if(waiting!=null){waiting.add(new WeakReference<>(view));return;}
     waiting=new ArrayList<>();waiting.add(new WeakReference<>(view));pending.put(key,waiting);
   }
   Context app=context.getApplicationContext();
   worker.execute(()->{
     Bitmap result=decode(app,track);
     synchronized(pending){if(result!=null)cache.put(key,result);else missing.put(key,true);}
     main.post(()->{
       List<WeakReference<ImageView>> waiters;
       synchronized(pending){waiters=pending.remove(key);}
       if(waiters!=null&&result!=null)for(var ref:waiters){ImageView v=ref.get();if(v!=null&&key.equals(v.getTag()))v.setImageBitmap(result);}
     });
   });
 }
 private static Bitmap bytes(byte[] data){
   BitmapFactory.Options o=new BitmapFactory.Options();o.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(data,0,data.length,o);
   o.inSampleSize=1;while(Math.max(o.outWidth,o.outHeight)/o.inSampleSize>768)o.inSampleSize*=2;
   o.inJustDecodeBounds=false;return BitmapFactory.decodeByteArray(data,0,data.length,o);
 }
 private static Bitmap decode(Context app,Track t){
   // Embedded covers are specific to the file, unlike shared album thumbnails.
   try(MediaMetadataRetriever m=new MediaMetadataRetriever()){
     m.setDataSource(app,Uri.parse(t.uri));byte[] data=m.getEmbeddedPicture();
     if(data!=null){Bitmap b=bytes(data);if(b!=null)return b;}
   }catch(Exception ignored){}
   if(Build.VERSION.SDK_INT>=29)try{return app.getContentResolver().loadThumbnail(Uri.parse(t.uri),new Size(384,384),null);}catch(Exception ignored){}
   if(t.albumId>0)try(java.io.InputStream in=app.getContentResolver().openInputStream(Uri.parse("content://media/external/audio/albumart/"+t.albumId))){
     byte[] data=Io.read(in,16*1024*1024);return bytes(data);
   }catch(Exception ignored){}
   return null;
 }
}
