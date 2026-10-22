package dev.mono.local;

import android.annotation.SuppressLint;
import android.os.*;
import android.util.AtomicFile;
import android.webkit.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BiConsumer;
import org.json.*;

/** A local worker runs the shared desktop algorithms, without changing the native UI. */
public final class MusicEngine {
  private final MonoApp app;
  private WebView view;
  private boolean ready;
  private int sequence;
  private final Map<Integer, BiConsumer<JSONObject,String>> callbacks = new HashMap<>();
  private final List<Runnable> waiting = new ArrayList<>();
  private JSONObject saved = new JSONObject();
  public String error = "";
  public JSONObject insights = new JSONObject();
  public JSONObject vibes = new JSONObject();
  private final AtomicFile file;

  public MusicEngine(MonoApp app) {
    this.app=app;file=new AtomicFile(new File(app.getFilesDir(),"dj-state.json"));
    app.io.execute(() -> {
      try { synchronized(this){saved=new JSONObject(new String(file.readFully(),StandardCharsets.UTF_8));} }
      catch(Exception ignored) {}
      try {
        String script=new String(Io.read(app.getAssets().open("music-engine.js"),2*1024*1024),StandardCharsets.UTF_8);
        app.main.post(() -> start(script));
      } catch(Exception e){app.main.post(() -> fail("Не удалось загрузить Smart DJ"));}
    });
  }

  @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
  private void start(String source) {
    try {
      view=new WebView(app);
      view.getSettings().setJavaScriptEnabled(true);
      view.getSettings().setAllowFileAccess(false);
      view.getSettings().setAllowContentAccess(false);
      view.getSettings().setBlockNetworkLoads(true);
      view.addJavascriptInterface(new Object(){
        @JavascriptInterface public void message(String text){app.main.post(() -> receive(text));}
      },"PainNative");
      view.setWebViewClient(new WebViewClient(){
        @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}
        @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){v.destroy();view=null;fail("Smart DJ недоступен. Перезапустите приложение.");return true;}
      });
      // Blob workers keep FFT and ranking off both the native and WebView UI threads.
      String script="const worker=new Worker(URL.createObjectURL(new Blob(["+JSONObject.quote(source).replace("<","\\u003c")+"],{type:'text/javascript'})));"
          +"worker.onmessage=e=>PainNative.message(JSON.stringify(e.data));"
          +"worker.onerror=e=>PainNative.message(JSON.stringify({fatal:e.message}));"
          +"window.deliver=data=>worker.postMessage(data);";
      view.loadDataWithBaseURL("https://pain.invalid/","<!doctype html><meta charset='utf-8'><script>"+script+"</script>","text/html","UTF-8",null);
      app.main.postDelayed(() -> {if(!ready&&error.isEmpty())fail("Обновите Android System WebView для Smart DJ.");},12000);
    } catch(Exception e){fail("На устройстве недоступен движок Smart DJ.");}
  }

  private void fail(String text){
    ready=false;error=text;
    for(var callback:new ArrayList<>(callbacks.values()))callback.accept(null,text);
    callbacks.clear();waiting.clear();
  }
  private void receive(String text){
    try {
      JSONObject data=new JSONObject(text);
      if(data.has("fatal")){fail("Smart DJ: "+data.optString("fatal"));return;}
      if(data.optBoolean("ready")){
        ready=true;error="";
        List<Runnable> tasks=new ArrayList<>(waiting);waiting.clear();for(Runnable r:tasks)r.run();return;
      }
      JSONObject event=data.optJSONObject("event");
      if(event!=null&&"profile".equals(event.optString("type"))){
        final JSONObject profile=event.getJSONObject("profile");final String id=event.getString("track");
        app.io.execute(() -> {synchronized(this){try{JSONObject profiles=saved.optJSONObject("profiles");if(profiles==null){profiles=new JSONObject();saved.put("profiles",profiles);}profiles.put(id,profile);persist();}catch(Exception ignored){}}});
        if(app.service!=null&&id.equals(app.service.currentId()))app.service.refreshSmart(false);
        return;
      }
      var callback=callbacks.remove(data.optInt("id"));
      if(callback!=null)callback.accept(data.optJSONObject("result"),data.optString("error",null));
    } catch(Exception ignored) {}
  }
  public boolean isReady(){return ready;}
  public void call(String method,JSONObject args,BiConsumer<JSONObject,String> callback){
    if(Looper.myLooper()!=Looper.getMainLooper()){app.main.post(() -> call(method,args,callback));return;}
    if(!error.isEmpty()){if(callback!=null)callback.accept(null,error);return;}
    int id=++sequence;
    if(callback!=null)callbacks.put(id,callback);
    Runnable send=() -> {
      try{JSONObject request=new JSONObject().put("id",id).put("method",method).put("args",args);
        view.evaluateJavascript("window.deliver("+request+")",null);
      }catch(Exception e){var cb=callbacks.remove(id);if(cb!=null)cb.accept(null,"Smart DJ недоступен");}
    };
    if(ready)send.run();else waiting.add(send);
    if(callback!=null)app.main.postDelayed(() -> {var cb=callbacks.remove(id);if(cb!=null)cb.accept(null,"Smart DJ не ответил вовремя");},15000);
  }
  public void refresh(){
    app.io.execute(() -> {
      try {
        JSONObject data=new JSONObject(app.repo.exportLibraryJson()).put("stats",new JSONObject(app.repo.exportStatsJson()));
        synchronized(this){data.put("profiles",saved.optJSONObject("profiles"));}
        data.put("vibes",new JSONObject(app.prefs.getString("djVibes","{}")));
        data.put("excluded",new JSONArray(app.prefs.getString("djExcluded","[]")));
        call("update",data,(result,failure) -> {if(failure==null){refreshInsights();if(app.service!=null)app.service.refreshSmart(false);}});
      }catch(Exception ignored){}
    });
  }
  public void refreshInsights(){call("insights",new JSONObject(),(data,failure) -> {if(data!=null)insights=data;});}
  public void saveVibes(JSONObject data){
    app.prefs.edit().putString("djVibes",data.toString()).apply();
    app.io.execute(() -> {synchronized(this){try{saved.put("vibes",data);persist();}catch(Exception ignored){}}});
  }
  public synchronized String exportState(){return saved.toString();}
  public String mergeState(String raw) throws Exception {
    CompletableFuture<String> result=new CompletableFuture<>();
    call("state",new JSONObject(raw),(data,failure) -> {
      if(failure!=null){result.completeExceptionally(new IOException(failure));return;}
      if(data.optJSONObject("vibes")!=null)app.prefs.edit().putString("djVibes",data.optJSONObject("vibes").toString()).apply();
      if(app.service!=null)app.service.refreshSmart(false);
      app.io.execute(() -> {synchronized(this){saved=data;persist();result.complete(saved.toString());}});
    });
    return result.get(15,TimeUnit.SECONDS); // Only called on a sync server thread.
  }
  private void persist(){
    FileOutputStream out=null;
    try{
      JSONObject profiles=saved.optJSONObject("profiles");
      if(profiles!=null&&profiles.length()>750){List<String> ids=new ArrayList<>();profiles.keys().forEachRemaining(ids::add);ids.sort((a,b)->Long.compare(profiles.optJSONObject(b).optLong("updatedAt"),profiles.optJSONObject(a).optLong("updatedAt")));for(String id:ids.subList(750,ids.size()))profiles.remove(id);}
      out=file.startWrite();out.write(saved.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(out);}
    catch(Exception e){if(out!=null)file.failWrite(out);}
  }
}
