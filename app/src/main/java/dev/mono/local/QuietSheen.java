package dev.mono.local;
import android.animation.*;
import android.content.Context;
import android.graphics.*;
import android.view.View;
import android.view.animation.LinearInterpolator;

/** One short, rare highlight; no idle frame loop, touch handling, or layout work. */
final class QuietSheen extends View {
 private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final Matrix matrix=new Matrix();private ValueAnimator animator;private float offset;
 private final Runnable begin=()->{
  if(!isAttachedToWindow()||getWindowVisibility()!=VISIBLE)return;
  if(MicroMotion.enabled(this)&&!((MonoApp)getContext().getApplicationContext()).prefs.getBoolean("batterySaver",false)&&getWidth()>0){
   animator=ValueAnimator.ofFloat(-getWidth()*.4f,getWidth()*1.4f);animator.setDuration(1800);animator.setInterpolator(new LinearInterpolator());
   animator.addUpdateListener(value->{offset=(float)value.getAnimatedValue();invalidate();});animator.addListener(new AnimatorListenerAdapter(){@Override public void onAnimationEnd(Animator a){offset=-getWidth();invalidate();schedule();}});animator.start();
  }else schedule();
 };
 QuietSheen(Context context){super(context);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);setFocusable(false);setClickable(false);}
 private void schedule(){removeCallbacks(begin);if(isAttachedToWindow()&&getWindowVisibility()==VISIBLE)postDelayed(begin,45000+(long)(Math.random()*25000));}
 @Override protected void onAttachedToWindow(){super.onAttachedToWindow();offset=-getWidth();schedule();}
 @Override protected void onDetachedFromWindow(){removeCallbacks(begin);if(animator!=null){animator.removeAllListeners();animator.cancel();}super.onDetachedFromWindow();}
 @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);removeCallbacks(begin);if(visibility==VISIBLE)schedule();else if(animator!=null){animator.removeAllListeners();animator.cancel();offset=-getWidth();}}
 @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){paint.setShader(new LinearGradient(0,0,w*.33f,h*.4f,new int[]{0x00d5b5f3,0x16eea6ce,0x00d5b5f3},null,Shader.TileMode.CLAMP));offset=-w;}
 @Override protected void onDraw(Canvas canvas){if(animator==null||!animator.isRunning())return;matrix.setTranslate(offset,0);paint.getShader().setLocalMatrix(matrix);float radius=24*getResources().getDisplayMetrics().density;canvas.drawRoundRect(0,0,getWidth(),getHeight(),radius,radius,paint);}
}
