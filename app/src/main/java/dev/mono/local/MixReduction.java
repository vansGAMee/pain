package dev.mono.local;

/** Attenuates frequency ranges and the stereo centre. No stem separation or AI. */
public final class MixReduction {
  private static final double[] CENTRE_FREQUENCIES={350,1000,2800};
  private final Filter[] tone={new Filter(),new Filter(),new Filter()};
  private final Filter[] centre={new Filter(),new Filter(),new Filter()};
  private final double[] saved=new double[4];
  private int sampleRate;
  private boolean requested;
  private double wet,smooth;

  public void configure(int rate,double[] settings){
    boolean changed=rate!=sampleRate;
    for(int i=0;i<4;i++){
      double v=settings!=null&&settings.length==4&&Double.isFinite(settings[i])?Math.max(0,Math.min(100,settings[i])):0;
      changed|=saved[i]!=v;saved[i]=v;
    }
    requested=false;for(double v:saved)requested|=v>0;
    if(!changed)return;
    sampleRate=rate;smooth=1-Math.exp(-1/(rate*.025));
    tone[0].target(rate,180,1,-24*saved[1]/100,-1);
    tone[1].target(rate,1100,.55,-18*saved[2]/100,0);
    tone[2].target(rate,6500,1,-24*saved[3]/100,1);
    for(int i=0;i<3;i++)centre[i].target(rate,CENTRE_FREQUENCIES[i],.8,-18*saved[0]/100,0);
  }
  public boolean active(){return requested||wet>1e-6;}
  public void reset(){wet=0;for(Filter f:tone)f.reset();for(Filter f:centre)f.reset();}
  public void frame(double[] samples,int channels){
    if(!active())return;
    wet+=((requested?1:0)-wet)*smooth;
    if(!requested&&wet<1e-6){reset();return;}
    for(Filter f:tone)f.glide(smooth);for(Filter f:centre)f.glide(smooth);
    double middle=channels>=2?(samples[0]+samples[1])*.5:samples[0];
    double side=channels>=2?(samples[0]-samples[1])*.5:0;
    for(Filter f:centre)middle=f.sample(middle,0);
    for(int ch=0;ch<channels;ch++){
      double dry=samples[ch],value=ch==0?middle+side:ch==1?middle-side:dry;
      for(Filter f:tone)value=f.sample(value,ch);
      samples[ch]=dry+(value-dry)*wet;
      if(!Double.isFinite(samples[ch]))samples[ch]=0;
    }
  }
  private static final class Filter {
    final double[] c={1,0,0,0,0},next={1,0,0,0,0};
    final double[][] delay=new double[8][2];
    void reset(){for(double[] z:delay)java.util.Arrays.fill(z,0);}
    void glide(double speed){for(int i=0;i<5;i++)c[i]+=(next[i]-c[i])*speed;}
    double sample(double x,int ch){double[] z=delay[ch];double y=c[0]*x+z[0];z[0]=c[1]*x-c[3]*y+z[1];z[1]=c[2]*x-c[4]*y;return y;}
    void target(int rate,double frequency,double q,double db,int shelf){
      double a=Math.pow(10,db/40),w=2*Math.PI*Math.min(frequency,rate*.45)/rate,cos=Math.cos(w),sin=Math.sin(w);
      double alpha=sin/(2*q),b0,b1,b2,a0,a1,a2;
      if(shelf!=0){
        double x=2*Math.sqrt(a)*sin/2*Math.sqrt(2);
        if(shelf<0){b0=a*((a+1)-(a-1)*cos+x);b1=2*a*((a-1)-(a+1)*cos);b2=a*((a+1)-(a-1)*cos-x);a0=(a+1)+(a-1)*cos+x;a1=-2*((a-1)+(a+1)*cos);a2=(a+1)+(a-1)*cos-x;}
        else{b0=a*((a+1)+(a-1)*cos+x);b1=-2*a*((a-1)+(a+1)*cos);b2=a*((a+1)+(a-1)*cos-x);a0=(a+1)-(a-1)*cos+x;a1=2*((a-1)-(a+1)*cos);a2=(a+1)-(a-1)*cos-x;}
      }else{b0=1+alpha*a;b1=-2*cos;b2=1-alpha*a;a0=1+alpha/a;a1=-2*cos;a2=1-alpha/a;}
      next[0]=b0/a0;next[1]=b1/a0;next[2]=b2/a0;next[3]=a1/a0;next[4]=a2/a0;
    }
  }
}
