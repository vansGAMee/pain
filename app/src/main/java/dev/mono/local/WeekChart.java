package dev.mono.local;
import android.content.Context;
import android.graphics.*;
import android.view.View;
import java.time.*;
import java.time.format.TextStyle;
import java.util.*;

/** Seven bounded bars, drawn only when the report is visible. */
final class WeekChart extends View {
 private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final long[] values=new long[7];private final String[] labels=new String[7];private final int ink,accent;private final float density;
 WeekChart(Context c,Map<String,Long> days,LocalDate first,int ink,int accent){super(c);this.ink=ink;this.accent=accent;density=c.getResources().getDisplayMetrics().density;StringBuilder description=new StringBuilder();
  for(int i=0;i<7;i++){LocalDate day=first.plusDays(i);values[i]=days.getOrDefault(day.toString(),0L);labels[i]=day.getDayOfWeek().getDisplayName(TextStyle.SHORT,Locale.forLanguageTag(c.getSharedPreferences("mono",Context.MODE_PRIVATE).getString("lang","ru")));description.append(day).append(": ").append(Repository.formatTime(values[i])).append(". ");}setContentDescription(description);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
 }
 @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);long max=1;for(long value:values)max=Math.max(max,value);float cell=getWidth()/7f,baseline=getHeight()-30*density,height=getHeight()-58*density;
  paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));paint.setTextAlign(Paint.Align.CENTER);paint.setTextSize(10*density);
  for(int i=0;i<7;i++){float x=cell*(i+.5f),bar=values[i]==0?2*density:Math.max(3*density,height*values[i]/max);paint.setColor((accent&0xffffff)|0x22000000);canvas.drawRoundRect(x-cell*.28f,baseline-height,x+cell*.28f,baseline,5*density,5*density,paint);paint.setColor(accent);canvas.drawRoundRect(x-cell*.28f,baseline-bar,x+cell*.28f,baseline,5*density,5*density,paint);
   paint.setColor(ink);canvas.drawText(labels[i],x,baseline+20*density,paint);if(values[i]>0)canvas.drawText(Math.round(values[i]/60000f)+"m",x,baseline-bar-7*density,paint);
  }
 }
}
