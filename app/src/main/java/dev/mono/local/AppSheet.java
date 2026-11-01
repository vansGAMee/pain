package dev.mono.local;

import android.app.Dialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.widget.*;

/** Shared, accessible PAIN panel; no platform list menus. */
final class AppSheet {
  final Dialog dialog;final LinearLayout content;final Context context;final int ink,paper;final boolean dark;final MobilePalette palette;
  private int dp(float v){return Math.round(v*context.getResources().getDisplayMetrics().density);}
  AppSheet(Context context,String title,int paper,int ink,boolean dark){
    this.context=context;this.ink=ink;this.paper=paper;this.dark=dark;this.palette=new MobilePalette((MonoApp)context.getApplicationContext());
    dialog=new Dialog(context);dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
    content=new LinearLayout(context);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(22),dp(18),dp(22),dp(22));
    GradientDrawable bg=new GradientDrawable();bg.setColor(paper);bg.setCornerRadii(new float[]{dp(26),dp(26),dp(26),dp(26),0,0,0,0});content.setBackground(bg);
    ScrollView scroll=new ScrollView(context);scroll.setFillViewport(false);scroll.setVerticalScrollBarEnabled(false);scroll.addView(content);
    dialog.setContentView(scroll);text(title,25);button(context.getSharedPreferences("mono",Context.MODE_PRIVATE).getString("lang","ru").equals("ru")?"Закрыть":"Close",null,()->dialog.dismiss(),false,false);
  }
  TextView text(String value,int size){TextView t=new TextView(context);t.setText(value);t.setTextColor(ink);t.setTextSize(size*context.getSharedPreferences("mono",Context.MODE_PRIVATE).getFloat("textScale",1));t.setTypeface(DesignScene.font(context));t.setPadding(0,dp(8),0,dp(8));t.setFontFeatureSettings("tnum");content.addView(t,new LinearLayout.LayoutParams(-1,-2));return t;}
  void button(String title,String subtitle,Runnable action){button(title,subtitle,action,true,false);}
  void button(String title,String subtitle,Runnable action,boolean dismiss,boolean danger){
    TextView t=new TextView(context);t.setText(title+(subtitle==null?"":"\n"+subtitle));t.setTextSize(15*context.getSharedPreferences("mono",Context.MODE_PRIVATE).getFloat("textScale",1));t.setTypeface(DesignScene.font(context));t.setTextColor(danger?(dark?0xffffb5ce:0xff9d244e):ink);t.setGravity(Gravity.CENTER_VERTICAL);t.setPadding(dp(16),dp(14),dp(16),dp(14));t.setMinHeight(dp(52));
    GradientDrawable bg=new GradientDrawable();bg.setColor(palette.surface);bg.setCornerRadius(dp(15));t.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf((palette.accent&0xffffff)|0x30000000),bg,null));
    LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(8);content.addView(t,lp);t.setFocusable(true);t.setOnClickListener(v->{if(dismiss)dialog.dismiss();action.run();});
  }
  void show(){dialog.show();Window w=dialog.getWindow();w.setBackgroundDrawableResource(android.R.color.transparent);w.setGravity(Gravity.BOTTOM);w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);w.setDimAmount(.5f);w.setLayout(-1,Math.min(dp(760),(int)(context.getResources().getDisplayMetrics().heightPixels*.88f)));}
}
