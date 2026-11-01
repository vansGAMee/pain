package dev.mono.local;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.widget.*;
import java.time.*;
import java.util.*;
import java.util.function.*;

/** Scrollable statistics with explicit labels and real stored listening data. */
final class InsightsPanel extends LinearLayout {
 private final int ink,accent,surface;private final boolean ru;private final MonoApp app;
 private int dp(float v){return Math.round(v*getResources().getDisplayMetrics().density);}
 private TextView text(String value,int size){TextView t=new TextView(getContext());t.setText(value);t.setTextSize(size);t.setTextColor(ink);t.setPadding(0,dp(6),0,dp(6));t.setFontFeatureSettings("tnum");return t;}
 private LinearLayout section(String title){LinearLayout box=new LinearLayout(getContext());box.setOrientation(VERTICAL);box.setPadding(dp(18),dp(14),dp(18),dp(16));GradientDrawable bg=new GradientDrawable();bg.setColor(surface);bg.setCornerRadius(dp(20));box.setBackground(bg);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(16);addView(box,lp);box.addView(text(title,18));return box;}
 private void button(LinearLayout parent,String title,Runnable click){TextView t=text(title,15);t.setTextColor(accent);t.setPadding(dp(8),dp(13),dp(8),dp(13));t.setMinHeight(dp(48));t.setFocusable(true);t.setOnClickListener(v->click.run());parent.addView(t,new LinearLayout.LayoutParams(-1,-2));}
 InsightsPanel(Context context,MonoApp app,Repository.Stats stats,int period,int paper,int ink,boolean dark,IntConsumer changePeriod,Runnable weekly,Runnable tools,Consumer<String> playTrack,Runnable more){
  super(context);this.app=app;this.ink=ink;ru=app.prefs.getString("lang","ru").equals("ru");accent=dark?0xffd5b5f3:0xff76539a;surface=dark?0xff100d16:0xffe8e3dc;setOrientation(VERTICAL);setPadding(dp(24),dp(18),dp(24),dp(16));
  TextView heading=text(ru?"Ваша музыка\nв цифрах":"Your music,\nin numbers",30);heading.setTypeface(android.graphics.Typeface.create("sans-serif-medium",Typeface.NORMAL));addView(heading);
  LinearLayout periods=new LinearLayout(context);addView(periods,new LinearLayout.LayoutParams(-1,dp(54)));
  int[] spans={7,30,0};String[] names=ru?new String[]{"7 дней","30 дней","Всё время"}:new String[]{"7 days","30 days","All time"};
  for(int i=0;i<3;i++){final int days=spans[i];TextView b=text(names[i],14);b.setGravity(Gravity.CENTER);b.setTextColor(period==days?paper:ink);GradientDrawable bg=new GradientDrawable();bg.setColor(period==days?accent:surface);bg.setCornerRadius(dp(12));b.setBackground(bg);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,dp(42),1);lp.setMargins(dp(3),dp(2),dp(3),0);periods.addView(b,lp);b.setOnClickListener(v->changePeriod.accept(days));b.setSelected(period==days);}
  LinearLayout summary=section(ru?"Время с музыкой":"Time with music");summary.addView(text(Repository.formatTime(stats.heard),34));summary.addView(text(ru?stats.unique+" треков · "+stats.artists.size()+" исполнителей":stats.unique+" songs · "+stats.artists.size()+" artists",15));
  if(stats.heard==0)summary.addView(text(ru?"Начните слушать — здесь появятся ваши привычки.":"Start listening to see your music habits here.",14));
  button(summary,ru?"20 подробных графиков как на ПК  ›":"20 detailed desktop charts  ›",()->ChartGallery.open((android.app.Activity)context,app));
  button(summary,ru?"Открыть отчёт за неделю  ›":"Open weekly report  ›",weekly);
  LinearLayout week=section(ru?"Последние семь дней":"Last seven days");week.addView(new WeekChart(context,stats.days,LocalDate.now().minusDays(6),ink,accent),new LinearLayout.LayoutParams(-1,dp(185)));
  LinearLayout hours=section(ru?"Когда вы слушаете":"When you listen");hours.addView(new HoursChart(context,stats.hours,ink,accent),new LinearLayout.LayoutParams(-1,dp(150)));hours.addView(text(stats.peak<0?(ru?"Пик появится после прослушивания":"A peak appears after listening"):(ru?"Любимый час: ":"Favorite hour: ")+String.format(Locale.ROOT,"%02d:00",stats.peak),14));
  LinearLayout habits=section(ru?"Как вы слушаете":"How you listen");
  String[] labels=ru?new String[]{"Прослушивания","Дослушано","Ранние пропуски","Повторы","Новые треки","Сессии","Средняя сессия","Самая длинная сессия","Дней подряд · всё время","Рекорд серии · всё время"}:new String[]{"Listens","Completed","Early skips","Replays","New songs","Sessions","Average session","Longest session","Current streak · all time","Best streak · all time"};
  String[] values={""+stats.qualified,""+stats.completed,""+stats.early,""+stats.replayed,""+stats.newPlays,""+stats.sessionCount,Repository.formatTime(stats.average),Repository.formatTime(stats.longest),""+app.stats.streak,""+app.stats.longestStreak};
  for(int i=0;i<labels.length;i++){LinearLayout row=new LinearLayout(context);TextView label=text(labels[i],14),value=text(values[i],15);value.setTextColor(accent);value.setGravity(Gravity.END);row.addView(label,new LinearLayout.LayoutParams(0,-2,1));row.addView(value,new LinearLayout.LayoutParams(-2,-2));habits.addView(row);}
  LinearLayout songs=section(ru?"Любимые треки":"Most played songs");
  stats.trackMs.entrySet().stream().filter(e->app.track(e.getKey())!=null).sorted(Map.Entry.<String,Long>comparingByValue().reversed()).limit(10).forEach(e->{Track t=app.track(e.getKey());button(songs,t.title+"\n"+t.artist+" · "+Repository.formatTime(e.getValue()),()->playTrack.accept(t.id));});
  LinearLayout artists=section(ru?"Любимые исполнители":"Most played artists");stats.artists.entrySet().stream().sorted(Map.Entry.<String,Long>comparingByValue().reversed()).limit(10).forEach(e->artists.addView(text(e.getKey()+"  ·  "+Repository.formatTime(e.getValue()),15)));
  button(this,ru?"Все метрики и выбор периода  ›":"More metrics & date range  ›",more);button(this,ru?"Инструменты и настройки  ›":"Tools & settings  ›",tools);
 }
 static final class HoursChart extends View {
  private final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);private final long[] values;private final int ink,accent;private final float density;
  HoursChart(Context c,long[] values,int ink,int accent){super(c);this.values=values.clone();this.ink=ink;this.accent=accent;density=c.getResources().getDisplayMetrics().density;StringBuilder a=new StringBuilder();for(int i=0;i<24;i++)a.append(i).append(":00 — ").append(Repository.formatTime(values[i])).append(". ");setContentDescription(a);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);}
  @Override protected void onDraw(Canvas c){long max=1;for(long value:values)max=Math.max(max,value);float step=getWidth()/24f,base=getHeight()-25*density,height=base-8*density;p.setTextSize(11*density);p.setTextAlign(Paint.Align.CENTER);for(int i=0;i<24;i++){p.setColor(accent);float h=values[i]==0?density:Math.max(2*density,height*values[i]/max);c.drawRoundRect(i*step+step*.14f,base-h,(i+1)*step-step*.14f,base,2*density,2*density,p);if(i%6==0){p.setColor(ink);c.drawText(String.format(Locale.ROOT,"%02d",i),step*(i+.5f),base+19*density,p);}}}
 }
}
