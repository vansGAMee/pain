package dev.mono.local;
import org.junit.Test;
import static org.junit.Assert.*;

public class MixReductionTest {
 private double measure(double[] controls,double frequency,boolean opposite,int channels,int rate){
  MixReduction effect=new MixReduction();effect.configure(rate,controls);double energy=0;double[] frame=new double[channels];
  for(int i=0;i<rate*2;i++){
   double x=.25*Math.sin(2*Math.PI*frequency*i/rate);for(int ch=0;ch<channels;ch++)frame[ch]=opposite&&ch==1?-x:x;
   effect.frame(frame,channels);for(double value:frame)assertTrue(Double.isFinite(value));
   if(i>=rate)energy+=frame[0]*frame[0];
  }
  return Math.sqrt(energy/rate);
 }
 @Test public void zeroSettingsAreAnExactBypass(){
  MixReduction effect=new MixReduction();effect.configure(48000,new double[4]);assertFalse(effect.active());
  for(int i=0;i<1000;i++){double[] frame={Math.sin(i*.17)*.9,-.3};double[] expected=frame.clone();effect.frame(frame,2);assertArrayEquals(expected,frame,0);}
 }
 @Test public void centreCutsKeepStereoSides(){
  double baseline=.25/Math.sqrt(2);
  assertTrue(measure(new double[]{100,0,0,0},1000,false,2,48000)<baseline*.08);
  assertEquals(baseline,measure(new double[]{100,0,0,0},1000,true,2,48000),1e-8);
 }
 @Test public void controlsAttenuateTheirRangesWithoutModels(){
  double baseline=.25/Math.sqrt(2);
  assertTrue(measure(new double[]{0,100,0,0},60,false,2,48000)<baseline*.12);
  assertTrue(measure(new double[]{0,0,100,0},1100,false,2,48000)<baseline*.15);
  assertTrue(measure(new double[]{0,0,0,100},12000,false,2,48000)<baseline*.15);
 }
 @Test public void monoSurroundAndUnusualRatesStayFinite(){
  for(int channels:new int[]{1,2,8})for(int rate:new int[]{8000,44100,96000})assertTrue(measure(new double[]{100,100,100,100},440,false,channels,rate)>0);
  assertTrue(measure(new double[]{Double.NaN,Double.POSITIVE_INFINITY,-100,1000},440,false,2,48000)>0);
 }
 @Test public void resettingControlsReturnsToUnchangedPlayback(){
  MixReduction effect=new MixReduction();effect.configure(48000,new double[]{100,100,100,100});double[] frame={.2,-.1};
  for(int i=0;i<48000;i++){frame[0]=.2;frame[1]=-.1;effect.frame(frame,2);}
  effect.configure(48000,new double[4]);
  for(int i=0;i<48000;i++){frame[0]=.2;frame[1]=-.1;effect.frame(frame,2);}
  assertFalse(effect.active());assertArrayEquals(new double[]{.2,-.1},frame,0);
 }
}
