package dev.mono.local;
import android.annotation.SuppressLint;
import android.app.*;
import android.graphics.Color;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Desktop's 20 charts, calculated by the shared worker and mounted only on demand. */
final class ChartGallery {
 @SuppressLint({"SetJavaScriptEnabled","JavascriptInterface"})
 static void open(Activity activity,MonoApp app){
  boolean ru=app.prefs.getString("lang","ru").equals("ru"),dark=java.util.List.of("sakura","night","dark").contains(app.prefs.getString("theme","sakura"));
  Dialog dialog=new Dialog(activity);dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
  LinearLayout layout=new LinearLayout(activity);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(dark?0xff0c0911:0xffefede6);
  TextView close=new TextView(activity);close.setText(ru?"‹  Статистика · 20 графиков":"‹  Statistics · 20 charts");close.setTextColor(dark?0xfff4edf8:0xff11110f);close.setTextSize(18);int pad=(int)(20*activity.getResources().getDisplayMetrics().density);close.setPadding(pad,pad,pad,pad);close.setOnClickListener(v->dialog.dismiss());layout.addView(close);
  WebView web=new WebView(activity);web.setBackgroundColor(Color.TRANSPARENT);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setBlockNetworkLoads(true);
  final int[] request={0};web.addJavascriptInterface(new Object(){@JavascriptInterface public void request(String range){app.main.post(()->{int id=++request[0];if(!dialog.isShowing())return;JSONObject args=new JSONObject();try{args.put("range",range);}catch(JSONException invalid){return;}app.music.call("charts",args,(data,error)->{if(!dialog.isShowing()||id!=request[0])return;web.evaluateJavascript(data==null?"PainMobileChartGallery.error("+JSONObject.quote(error==null?(ru?"Движок ещё запускается. Нажмите период для повторной попытки.":"Engine is starting. Tap a period to retry."):error)+")":"PainMobileChartGallery.render("+data+")",null);});});}},"PainMobileCharts");
  web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}});
  layout.addView(web,new LinearLayout.LayoutParams(-1,0,1));dialog.setContentView(layout);dialog.setOnDismissListener(d->{request[0]++;web.removeJavascriptInterface("PainMobileCharts");web.destroy();});dialog.show();dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);dialog.getWindow().setLayout(-1,(int)(activity.getResources().getDisplayMetrics().heightPixels*.92f));
  app.music.refresh();app.io.execute(()->{
   try{
    String css=new String(Io.read(app.getAssets().open("insight-charts.css"),512000),StandardCharsets.UTF_8),js=new String(Io.read(app.getAssets().open("insight-charts.js"),512000),StandardCharsets.UTF_8);
    String colors=dark?"--bg:#0c0911;--card-bg:#100d16;--ink:#f4edf8;--ink-muted:#b3a1c3;--ink-secondary:#d3c6df;--accent:#d5b5f3;--border:#c0a3df29;--border-strong:#c0a3df4a;":"--bg:#efede6;--card-bg:#e8e3dc;--ink:#11110f;--ink-muted:#5e5364;--ink-secondary:#453b4a;--accent:#76539a;--border:#76539a30;--border-strong:#76539a50;";
    String html="<!doctype html><html"+(!app.prefs.getBoolean("motion",true)?" data-reduced-motion":"")+"><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>:root{"+colors+"--chart-1:#b798dc;--chart-2:#78b6a7;--chart-3:#dfb378;--chart-4:#91a7e8;--chart-5:#dea3c4;--chart-6:#acb989}body{margin:0;padding:16px;font:15px system-ui;color:var(--ink);background:var(--bg)}button{min-height:44px}button,summary{touch-action:manipulation}"+css+".insight-gallery-grid{grid-template-columns:1fr}.insight-gallery{margin:0}.insight-figure{padding:18px 12px}.insight-figure-heading{min-height:0;margin-bottom:16px}.insight-gallery-controls{flex-wrap:wrap}.insight-plot{min-height:150px}</style><div id='view-insights' class='active'><section id='insightGallery' class='insight-gallery'><div class='insight-gallery-controls'><button data-insight-range='7'>"+(ru?"7 дней":"7 days")+"</button><button data-insight-range='28'>"+(ru?"28 дней":"28 days")+"</button><button data-insight-range='all' aria-pressed='true'>"+(ru?"Всё время":"All time")+"</button><button data-insight-replay>"+(ru?"Повторить анимацию":"Replay animation")+"</button></div><p id='insightGalleryStatus' role='status'></p><div id='insightGalleryGrid' class='insight-gallery-grid'></div></section></div><script>localStorage.setItem('pain_lang',"+JSONObject.quote(ru?"ru":"en")+");"+js.replace("</script","<\\/script")+"</script></html>";
    app.main.post(()->{if(dialog.isShowing())web.loadDataWithBaseURL("https://pain.invalid/",html,"text/html","UTF-8",null);});
   }catch(Exception error){app.main.post(()->{if(dialog.isShowing())close.setText(ru?"‹  Не удалось открыть графики":"‹  Could not open charts");});}
  });
 }
}
