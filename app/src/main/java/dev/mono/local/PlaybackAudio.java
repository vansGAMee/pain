package dev.mono.local;

import android.os.SystemClock;
import androidx.media3.common.C;
import androidx.media3.common.audio.*;
import java.nio.*;
import org.json.*;

/** Observes native decoded sound before EQ; never opens or decodes another track. */
@androidx.annotation.OptIn(markerClass=androidx.media3.common.util.UnstableApi.class)
public final class PlaybackAudio extends BaseAudioProcessor {
  private final PlaybackService service;
  private final MonoApp app;
  private final AudioDsp dsp=new AudioDsp();
  private final float[][] ring=new float[2][2048];
  private final double[] frame=new double[8];
  private int offset,count;
  private long lastCapture;
  private volatile long captureAfter;
  private volatile String track="";
  private volatile boolean busy,smartVolume,eqEnabled;
  private volatile boolean closed;
  private volatile double[] bands=new double[8];
  private volatile double[] manualBands=new double[8];
  private volatile double preamp,volumeDb;
  public PlaybackAudio(PlaybackService service,MonoApp app){this.service=service;this.app=app;}
  public void close(){closed=true;captureAfter=Long.MAX_VALUE;}
  public void track(String id){track=id;captureAfter=0;volumeDb=0;if(app.prefs.getBoolean("autoEq",false))applyCurve(null);}
  private void applyCurve(JSONArray correction){
    double[] base=manualBands,next=base.clone();double boost=0;
    for(int i=0;i<next.length;i++){
      double delta=correction==null?0:correction.optDouble(i,0);
      next[i]=Math.max(-12,Math.min(12,base[i]+(Double.isFinite(delta)?delta:0)));
      boost+=Math.max(0,next[i]);
    }
    preamp=-boost;bands=next;
  }
  public void settings(){
    captureAfter=0;
    smartVolume=app.prefs.getBoolean("smartVolume",false);
    eqEnabled=app.prefs.getBoolean("autoEq",false)||app.prefs.getBoolean("equalizer",false);
    if(!smartVolume)volumeDb=0;
    double[] next=new double[8];
    try{JSONArray a=new JSONArray(app.prefs.getString("eqBands","[]"));for(int i=0;i<8;i++){double value=a.optDouble(i,0);next[i]=app.prefs.getBoolean("equalizer",false)&&Double.isFinite(value)?Math.max(-12,Math.min(12,value)):0;}}catch(Exception ignored){}
    manualBands=next;applyCurve(null);
  }
  @Override protected AudioFormat onConfigure(AudioFormat format){
    return format.encoding==C.ENCODING_PCM_16BIT&&format.channelCount>0&&format.channelCount<=8?format:AudioFormat.NOT_SET;
  }
  @Override protected void onFlush(){offset=count=0;lastCapture=0;dsp.reset();}
  @Override public void queueInput(ByteBuffer input){
    int channels=inputAudioFormat.channelCount,rate=inputAudioFormat.sampleRate;
    ByteBuffer output=replaceOutputBuffer(input.remaining());input.order(ByteOrder.LITTLE_ENDIAN);output.order(ByteOrder.LITTLE_ENDIAN);
    boolean process=eqEnabled||smartVolume;
    if(process)dsp.configure(rate,input.remaining()/(2*channels),eqEnabled?bands:null,eqEnabled?preamp:0);
    long now=SystemClock.elapsedRealtime();boolean observe=!closed&&!busy&&(smartVolume||now>=captureAfter);
    double power=0,peak=0;int measured=0;
    while(input.remaining()>=channels*2){
      for(int ch=0;ch<channels;ch++)frame[ch]=input.getShort()/32768.0;
      if(observe){ring[0][offset]=(float)frame[0];ring[1][offset]=(float)frame[Math.min(1,channels-1)];offset=(offset+1)%2048;count=Math.min(2048,count+1);}
      if(process)dsp.frame(frame,channels,rate,smartVolume?volumeDb:0,smartVolume||eqEnabled);
      if(smartVolume){power+=dsp.rms*dsp.rms;peak=Math.max(peak,dsp.peak);measured++;}
      for(int ch=0;ch<channels;ch++)output.putShort((short)Math.max(-32768,Math.min(32767,Math.round(frame[ch]*32768))));
    }
    while(input.hasRemaining())output.put(input.get());
    output.flip();
    if(observe&&count==2048&&now-lastCapture>=500){
      busy=true;long elapsed=lastCapture==0?0:now-lastCapture;lastCapture=now;String id=track;
      float[][] copy=new float[2][2048];for(int ch=0;ch<2;ch++)for(int i=0;i<2048;i++)copy[ch][i]=ring[ch][(offset+i)%2048];
      double rms=measured>0?Math.sqrt(power/measured):0,maximum=peak;
      app.main.post(() -> {
        if(closed||!id.equals(service.currentId())||!service.player.isPlaying()||!app.music.isReady()){busy=false;return;}
        long position=service.player.getCurrentPosition();float speed=service.player.getPlaybackParameters().speed;
        // Serialization and FFT stay off the playback and UI threads.
        app.io.execute(() -> {
          try{
            JSONArray rows=new JSONArray();for(float[] channel:copy){JSONArray values=new JSONArray();for(float x:channel)values.put((double)x);rows.put(values);}
            JSONObject data=new JSONObject().put("track",id).put("rate",rate).put("wall",now).put("position",position)
                .put("playing",true).put("autoEq",app.prefs.getBoolean("autoEq",false)).put("speed",speed).put("channels",rows).put("smartVolume",smartVolume)
                .put("rms",rms).put("peak",maximum).put("elapsed",elapsed/1000.0);
            app.music.call("audio",data,(result,error) -> {
              busy=false;if(closed||result==null||!id.equals(service.currentId()))return;
              volumeDb=smartVolume?result.optDouble("volumeDb",0):0;
              if(app.prefs.getBoolean("autoEq",false)){
                JSONObject eq=result.optJSONObject("eq");if(eq!=null)applyCurve(eq.optJSONArray("bands"));
              }
              if(result.has("sampleAfter")){long after=result.optLong("sampleAfter",Long.MAX_VALUE);captureAfter=after==Long.MAX_VALUE?Long.MAX_VALUE:SystemClock.elapsedRealtime()+Math.max(0,after-service.player.getCurrentPosition());}
            });
          }catch(Exception e){busy=false;}
        });
      });
    }
  }
}
