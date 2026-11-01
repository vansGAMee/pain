package dev.mono.local;
import android.app.*;
import android.app.job.*;
import android.content.*;
import android.os.Build;
import java.time.*;

/** One deferred job per week. No exact alarms, polling, server, or wake lock. */
public final class WeeklyReportJob extends JobService {
 private static final int JOB=7301,NOTICE=7302;
 public static void schedule(MonoApp app){
  JobScheduler scheduler=(JobScheduler)app.getSystemService(JOB_SCHEDULER_SERVICE);
  if(!app.prefs.getBoolean("weeklyReport",false)){scheduler.cancel(JOB);return;}
  if(scheduler.getPendingJob(JOB)!=null)return;
  ZonedDateTime now=ZonedDateTime.now(),next=now.with(java.time.temporal.TemporalAdjusters.next(DayOfWeek.MONDAY)).withHour(10).withMinute(0).withSecond(0).withNano(0);
  if(now.getDayOfWeek()==DayOfWeek.MONDAY&&now.getHour()<10)next=now.withHour(10).withMinute(0).withSecond(0).withNano(0);
  long delay=Duration.between(now,next).toMillis();
  scheduler.schedule(new JobInfo.Builder(JOB,new ComponentName(app,WeeklyReportJob.class)).setMinimumLatency(delay).setOverrideDeadline(delay+6*3600000L).setPersisted(true).build());
 }
 @Override public boolean onStartJob(JobParameters parameters){
  MonoApp app=(MonoApp)getApplication();if(!app.prefs.getBoolean("weeklyReport",false))return false;
  LocalDate week=LocalDate.now().with(java.time.temporal.TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));String key=week.toString();
  if(!key.equals(app.prefs.getString("lastWeeklyReport",""))&&(Build.VERSION.SDK_INT<33||checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED)){
   NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);manager.createNotificationChannel(new NotificationChannel("weekly-report","Музыкальная неделя",NotificationManager.IMPORTANCE_DEFAULT));
   Intent intent=new Intent(this,MainActivity.class).putExtra("weeklyReport",true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
   PendingIntent open=PendingIntent.getActivity(this,JOB,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
   manager.notify(NOTICE,new Notification.Builder(this,"weekly-report").setSmallIcon(R.drawable.ic_maple).setContentTitle("Ваша неделя в музыке").setContentText("Посмотрите время прослушивания и любимые треки в PAIN.").setContentIntent(open).setAutoCancel(true).build());
   app.prefs.edit().putString("lastWeeklyReport",key).apply();
  }
  ((JobScheduler)getSystemService(JOB_SCHEDULER_SERVICE)).cancel(JOB);schedule(app);return false;
 }
 @Override public boolean onStopJob(JobParameters parameters){return false;}
}
