package dev.mono.local;
import static org.junit.Assert.*;
import org.junit.Test;

public class AudioDspTest {
 @Test public void flatSettingsPreserveStereoAndSilence(){
  AudioDsp dsp=new AudioDsp();dsp.configure(48000,2048,new double[8],0);
  for(int i=0;i<5000;i++){double sample=Math.sin(i*.17)*.3;double[] pair={sample,-sample};dsp.frame(pair,2,48000,0,false);assertEquals(sample,pair[0],1e-10);assertEquals(-sample,pair[1],1e-10);}
  dsp.reset();double[] silence={0,0};dsp.frame(silence,2,48000,0,true);assertArrayEquals(new double[2],silence,0);
 }
 @Test public void combinedBoostAndLevelMatchingStayFiniteAndProtectBothChannels(){
  AudioDsp dsp=new AudioDsp();double[] bands={12,12,-12,12,-12,12,12,12};
  for(int block=0;block<20;block++){
   dsp.configure(48000,1024,bands,-12);
   for(int i=0;i<1024;i++){double x=Math.sin(i*.37)*.99;double[] pair={x,-x};dsp.frame(pair,2,48000,3,true);assertTrue(Double.isFinite(pair[0]));assertTrue(Math.abs(pair[0])<=.970001);assertEquals(-pair[0],pair[1],1e-9);}
  }
 }
}
