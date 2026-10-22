package dev.mono.local;

/** Small PCM equalizer. Controls are smoothed; stereo peak protection is linked. */
public final class AudioDsp {
  public static final double[] FREQUENCIES={60,170,310,600,1000,3000,6000,12000};
  private final double[][] coefficients=new double[8][5];
  private final double[][][] delay=new double[8][8][2];
  private final double[] bands=new double[8];
  private double gain=1,limiter=1,preamp=1;
  public double rms,peak;
  public void reset(){for(double[][] band:delay)for(double[] channel:band)java.util.Arrays.fill(channel,0);limiter=1;}
  public void configure(int rate,int frames,double[] target,double targetPreamp){
    if(!Double.isFinite(targetPreamp))targetPreamp=0;
    double smooth=1-Math.exp(-frames/(rate*.15));
    preamp+=(Math.pow(10,Math.min(0,targetPreamp)/20)-preamp)*smooth;
    for(int i=0;i<8;i++){
      double db=target!=null&&target.length==8&&Double.isFinite(target[i])?Math.max(-12,Math.min(12,target[i])):0;
      bands[i]+=(db-bands[i])*smooth;
      double a=Math.pow(10,bands[i]/40),w=2*Math.PI*Math.min(FREQUENCIES[i],rate*.45)/rate,c=Math.cos(w),s=Math.sin(w);
      double alpha=s/(2*1.2),b0,b1,b2,a0,a1,a2;
      if(i==0||i==7){
        alpha=s/2*Math.sqrt(2);double x=2*Math.sqrt(a)*alpha;
        if(i==0){b0=a*((a+1)-(a-1)*c+x);b1=2*a*((a-1)-(a+1)*c);b2=a*((a+1)-(a-1)*c-x);a0=(a+1)+(a-1)*c+x;a1=-2*((a-1)+(a+1)*c);a2=(a+1)+(a-1)*c-x;}
        else{b0=a*((a+1)+(a-1)*c+x);b1=-2*a*((a-1)+(a+1)*c);b2=a*((a+1)+(a-1)*c-x);a0=(a+1)-(a-1)*c+x;a1=2*((a-1)-(a+1)*c);a2=(a+1)-(a-1)*c-x;}
      }else{b0=1+alpha*a;b1=-2*c;b2=1-alpha*a;a0=1+alpha/a;a1=-2*c;a2=1-alpha/a;}
      coefficients[i]=new double[]{b0/a0,b1/a0,b2/a0,a1/a0,a2/a0};
    }
  }
  public void frame(double[] samples,int channels,int rate,double gainDb,boolean protect){
    double power=0,p=0;
    for(int ch=0;ch<channels;ch++){
      double value=samples[ch];
      for(int i=0;i<8;i++){
        if(Math.abs(bands[i])<.001){delay[i][ch][0]=delay[i][ch][1]=0;continue;}
        double[] c=coefficients[i],z=delay[i][ch];
        double y=c[0]*value+z[0];z[0]=c[1]*value-c[3]*y+z[1];z[1]=c[2]*value-c[4]*y;value=y;
      }
      value*=preamp;samples[ch]=Double.isFinite(value)?value:0;
      power+=samples[ch]*samples[ch];p=Math.max(p,Math.abs(samples[ch]));
    }
    rms=Math.sqrt(power/channels);peak=p;
    double target=Math.pow(10,Double.isFinite(gainDb)?Math.max(-18,Math.min(3,gainDb))/20:0);
    gain+=(target-gain)*(1-Math.exp(-1/(rate*(target<gain?.12:1))));
    double wanted=protect&&p*gain>.97?.97/(p*gain):1;
    limiter=wanted<limiter?wanted:limiter+(wanted-limiter)*(1-Math.exp(-1/(rate*.3)));
    for(int ch=0;ch<channels;ch++)samples[ch]*=gain*limiter;
  }
}
