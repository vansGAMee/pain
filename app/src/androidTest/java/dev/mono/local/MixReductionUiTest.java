package dev.mono.local;

import static org.junit.Assert.*;
import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.view.*;
import android.view.inspector.WindowInspector;
import android.widget.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.lang.reflect.Method;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs on a dedicated emulator; never imports or plays library files. */
@RunWith(AndroidJUnit4.class)
public class MixReductionUiTest {
  private final Instrumentation inst=InstrumentationRegistry.getInstrumentation();
  private final List<SeekBar> sliders=new ArrayList<>();
  private View dialog;

  private void collect(View view){
    if(view instanceof SeekBar)sliders.add((SeekBar)view);
    if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)collect(((ViewGroup)view).getChildAt(i));
  }
  private void open(MainActivity activity) throws Exception {
    inst.runOnMainSync(()->{
      try{Method method=MainActivity.class.getDeclaredMethod("manualEqualizer");method.setAccessible(true);method.invoke(activity);}
      catch(Exception error){throw new AssertionError(error);}
    });
    inst.waitForIdleSync();
    inst.runOnMainSync(()->{
      dialog=null;sliders.clear();
      for(View root:WindowInspector.getGlobalWindowViews())if(root.findViewById(android.R.id.button1)!=null)dialog=root;
      assertNotNull(dialog);collect(dialog);assertEquals(12,sliders.size());
      assertTrue(dialog.getWidth()<=activity.getResources().getDisplayMetrics().widthPixels);
      assertTrue(dialog.getHeight()<=activity.getResources().getDisplayMetrics().heightPixels);
      assertEquals("Вокал / центр",sliders.get(8).getContentDescription());
    });
  }
  private void press(int id){inst.runOnMainSync(()->dialog.findViewById(id).performClick());inst.waitForIdleSync();}

  @Test public void reductionsApplyCancelAndResetInsideTheExistingEqualizer() throws Exception {
    Context context=inst.getTargetContext();MonoApp app=(MonoApp)context.getApplicationContext();
    String[] keys={"theme","lang","eqBands","mixReduction"};Map<String,String> saved=new HashMap<>();
    for(String key:keys)saved.put(key,app.prefs.contains(key)?app.prefs.getString(key,""):null);
    boolean eq=app.prefs.getBoolean("equalizer",false),auto=app.prefs.getBoolean("autoEq",false),scan=app.prefs.getBoolean("autoScan",true),history=app.prefs.getBoolean("history",true);
    app.prefs.edit().putString("theme","carbon").putString("lang","ru").putBoolean("autoScan",false).putBoolean("history",false).remove("mixReduction").commit();
    MainActivity activity=(MainActivity)inst.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    try{
      open(activity);inst.runOnMainSync(()->sliders.get(8).setProgress(80));press(android.R.id.button2);
      assertFalse("Cancel must not save",app.prefs.contains("mixReduction"));
      open(activity);inst.runOnMainSync(()->{sliders.get(8).setProgress(65);sliders.get(9).setProgress(40);sliders.get(10).setProgress(25);sliders.get(11).setProgress(10);});press(android.R.id.button1);
      assertEquals("[65,40,25,10]",app.prefs.getString("mixReduction",""));assertTrue(app.prefs.getBoolean("equalizer",false));
      open(activity);inst.runOnMainSync(()->{assertEquals(65,sliders.get(8).getProgress());sliders.get(11).requestRectangleOnScreen(new android.graphics.Rect(0,0,sliders.get(11).getWidth(),sliders.get(11).getHeight()),true);});inst.waitForIdleSync();
      if("true".equals(InstrumentationRegistry.getArguments().getString("mixScreenshots")))try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"mix-reduction-carbon.png"))){inst.getUiAutomation().takeScreenshot().compress(Bitmap.CompressFormat.PNG,100,out);}
      press(android.R.id.button3);assertFalse(app.prefs.contains("mixReduction"));assertFalse(app.prefs.getBoolean("equalizer",true));
    }finally{
      inst.runOnMainSync(activity::finish);
      SharedPreferences.Editor editor=app.prefs.edit();for(String key:keys){if(saved.get(key)==null)editor.remove(key);else editor.putString(key,saved.get(key));}
      editor.putBoolean("equalizer",eq).putBoolean("autoEq",auto).putBoolean("autoScan",scan).putBoolean("history",history).commit();
      inst.runOnMainSync(()->{if(app.service!=null)app.service.applyPreferences();});
    }
  }
}
