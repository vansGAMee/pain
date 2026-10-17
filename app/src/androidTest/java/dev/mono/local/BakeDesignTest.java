package dev.mono.local;
import android.graphics.Bitmap;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
/** Reproducible build-time export of the original design's static layers. */
public class BakeDesignTest {
 @Test public void exportOriginalSurfaces() throws Exception {
  org.junit.Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("bakeDesign")));
  var instrumentation=InstrumentationRegistry.getInstrumentation();
  MonoApp app=(MonoApp)instrumentation.getTargetContext().getApplicationContext();
  String previous=app.prefs.getString("theme","paper");int depth=app.prefs.getInt("depth",72);
  java.io.File dir=new java.io.File(app.getFilesDir(),"surfaces");dir.mkdirs();
  DesignScene.baking=true;
  try {
   for(String theme:new String[]{"paper","mist","dark"})for(int page=0;page<8;page++){
    app.prefs.edit().putString("theme",theme).putInt("depth",72).commit();
    int index=page;DesignScene[] holder=new DesignScene[1];
    instrumentation.runOnMainSync(()->holder[0]=new DesignScene(app,index,2,0,854,MainActivity.hidden(index)));
    long deadline=System.currentTimeMillis()+15000;
    while(holder[0].exportBitmap()==null&&System.currentTimeMillis()<deadline)Thread.sleep(20);
    assertNotNull(holder[0].exportBitmap());
    try(var out=new java.io.FileOutputStream(new java.io.File(dir,theme+"-"+page+".png"))){holder[0].exportBitmap().compress(Bitmap.CompressFormat.PNG,100,out);}
   }
  }finally{DesignScene.baking=false;app.prefs.edit().putString("theme",previous).putInt("depth",depth).commit();}
 }
}
