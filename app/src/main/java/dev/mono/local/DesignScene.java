package dev.mono.local;

import android.content.*;
import android.graphics.*;
import android.graphics.drawable.*;
import android.util.*;
import android.view.*;
import android.widget.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/**
 * Direct Figma geometry + accessible native text/controls. Soft shadows rasterize once off-thread.
 */
public final class DesignScene extends FrameLayout {
  private static JSONArray scenes;
  private static Typeface face;
  private static final ExecutorService render =
      Executors.newFixedThreadPool(2);
  private static final int CACHE_SIZE =
      (int) Math.min(128 * 1024 * 1024L, Math.max(32 * 1024 * 1024L, Runtime.getRuntime().maxMemory() / 3));
  private static final LruCache<String, Bitmap> cache =
      new LruCache<>(CACHE_SIZE) {
        protected int sizeOf(String k, Bitmap b) {
          return b.getAllocationByteCount();
        }
      };
  public final Map<String, TextView> texts = new HashMap<>();
  public final float scale, from, to;
  public final int page;
  private final MonoApp app;
  private final Set<String> hidden;
  private final Background background;

  public DesignScene(
      Context context, int page, float scale, float from, float to, Set<String> hidden) {
    super(context);
    this.page = page;
    this.scale = scale;
    this.from = from;
    this.to = to;
    this.hidden = new HashSet<>(hidden);
    app = (MonoApp) context.getApplicationContext();
    setClipChildren(false);
    setClipToPadding(false);
    try {
      if (scenes == null) {
        scenes =
            new JSONArray(
                new String(
                    Io.read(context.getAssets().open("scenes.json"), 4 * 1024 * 1024),
                    java.nio.charset.StandardCharsets.UTF_8));
        face = Typeface.createFromAsset(context.getAssets(), "Geist.ttf");
      }
      JSONArray nodes = scenes.getJSONObject(page).getJSONArray("children");
      background = new Background(context);
      addView(background, new LayoutParams(Math.round(390 * scale), Math.round((to - from) * scale)));
      for (int i = 0; i < nodes.length(); i++) {
        JSONObject n = nodes.getJSONObject(i);
        String id = n.getString("id");
        float y = (float) n.getJSONObject("transform").optDouble("m12");
        if (!n.optBoolean("visible", true)
            || y < from
            || y >= to
            || hidden.contains(id)
            || !n.getString("type").equals("TEXT")) continue;
        JSONObject size = n.getJSONObject("size");
        float x = (float) n.getJSONObject("transform").optDouble("m02"),
            w = (float) size.optDouble("x"),
            h = (float) size.optDouble("y");
        TextView t = new TextView(context);
        String content = n.optString("text");
        t.setText(localized(content));
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setIncludeFontPadding(false);
        t.setPadding(0, 0, 0, 0);
        t.setTextSize(
            TypedValue.COMPLEX_UNIT_PX,
            (float) n.optDouble("fontSize", 12) * scale * app.prefs.getFloat("textScale", 1));
        String style =
            n.optJSONObject("fontName") == null
                ? ""
                : n.getJSONObject("fontName").optString("style");
        t.setTypeface(font(context, style));
        JSONArray fills = n.optJSONArray("fillPaints");
        int color =
            fills != null && fills.length() > 0 ? paintColor(fills.getJSONObject(0)) : 0xff11110f;
        t.setTextColor(themed(color));
        t.setAlpha((float) n.optDouble("opacity", 1));
        if (n.optString("textAlignHorizontal").equals("CENTER"))
          t.setGravity(Gravity.CENTER_HORIZONTAL);
        t.setLineSpacing(0, 1);
        JSONObject lh = n.optJSONObject("lineHeight");
        if (lh != null && lh.optString("units").equals("PIXELS"))
          t.setLineSpacing(
              (float) lh.optDouble("value") * scale * app.prefs.getFloat("textScale", 1)
                  - t.getPaint().getFontSpacing(),
              1);
        t.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        texts.put(id, t);
        float maxW = 390 - x - 16;
        float defaultW = n.optString("textAlignHorizontal").equals("CENTER")
            ? (w + 10)
            : Math.max(w + 10, Math.min(maxW, w * 1.8f));
        put(t, x, y, Math.min(maxW, defaultW), h + 6);
      }
      requestRaster(nodes);
    } catch (Exception e) {
      throw new IllegalStateException("Cannot read original Figma design", e);
    }
  }

  private String localized(String text) {
    if(!app.prefs.getString("lang","ru").equals("ru"))return text;
    switch(text) {
      case "TODAY": return "Сегодня";
      case "CURRENT OBSESSION": return "На повторе";
      case "completion": return "до конца";
      case "SCRUB": return "";
      case "INSIGHTS / 2026": return "Инсайты / 2026";
      case "Your listening.": return "Твоя музыка.";
      case "minutes": return "минут";
      case "LOCAL HISTORY": return "Локальная история";
      case "LISTENING CLOCK": return "Время слушать";
      case "peak": return "пик";
      case "STREAK": return "Серия";
      case "days": return "дней";
      case "longest": return "рекорд";
      case "DISCOVERY / COMFORT": return "Новое и знакомое";
      case "new": return "новое";
      case "familiar": return "знакомое";
      case "SKIP PROFILE": return "Как вы слушаете";
      case "completed": return "до конца";
      case "< 30 sec": return "< 30 сек";
      case "replayed": return "повтор";
      case "other": return "другое";
      case "DEVICES": return "Устройства";
      case "No account. Same library.": return "Коллекция на устройстве.";
      case "SMART STORAGE": return "Хранилище";
      case "LOCAL ONLY  ·  NO CLOUD ACCOUNT": return "На устройстве. Без облака.";
      case "STATISTICS": return "Статистика";
      case "Your patterns.": return "Твои привычки.";
      case "YEAR": return "Год";
      case "ALL TIME": return "Всё время";
      case "LISTENED": return "Прослушано";
      case "min": return "мин";
      case "SESSIONS": return "Сессии";
      case "local": return "локально";
      case "TRACKS": return "Треки";
      case "unique": return "уникальных";
      case "TOP ARTISTS": return "Любимые исполнители";
      case "YOUR ROUTINE": return "Твой ритм";
      case "peak hour": return "час пик";
      case "avg session": return "средняя сессия";
      case "ON THIS DAY": return "В этот день";
      case "KARAOKE · LOCAL": return "Караоке";
      case "LYRIC OFFSET": return "Сдвиг текста";
      case "NEXT": return "Далее";
      case "LOCAL FILE · NO NETWORK": return "На устройстве. Без интернета.";
      case "LINE FOCUS": return "Фокус строки";
      default:return text;
    }
  }
  public static Typeface font(Context c) {
    if (face == null) face = Typeface.createFromAsset(c.getAssets(), "Geist.ttf");
    return face;
  }

  private static final Map<String, Typeface> fontFaces = new HashMap<>();

  public static synchronized Typeface font(Context context, String style) {
    String name = "Bold".equals(style) ? "Bold"
        : "SemiBold".equals(style) ? "SemiBold"
        : "Medium".equals(style) ? "Medium" : "Regular";
    if (name.equals("Regular")) return font(context);
    Typeface loaded = fontFaces.get(name);
    if (loaded == null) {
      loaded = Typeface.createFromAsset(context.getAssets(), "Geist-" + name + ".ttf");
      fontFaces.put(name, loaded);
    }
    return loaded;
  }

  public int paper() {
    return themed(0xffefede6);
  }

  public int ink() {
    return themed(0xff11110f);
  }

  private int themed(int color) {
    String theme = app.prefs.getString("theme", "paper");
    int a = Color.alpha(color);
    float lum =
        (Color.red(color) * .2126f + Color.green(color) * .7152f + Color.blue(color) * .0722f)
            / 255;
    if (theme.equals("night")) {
      int v=(int)(8+(1-lum)*224);return Color.argb(a,v,v,v);
    }
    if (theme.equals("dark")) {
      int v = (int) (27 + (1 - lum) * 208);
      return Color.argb(a, v, v, (int) (v * .96));
    }
    if (theme.equals("mist")) {
      int v = (int) (lum * 255);
      return Color.argb(a, v, v, Math.min(255, v + 2));
    }
    return color;
  }

  public TextView text(String id, String value) {
    TextView t = texts.get(id);
    if (t != null && !t.getText().toString().equals(value)) t.setText(value);
    return t;
  }

  public void bounds(String id, float x, float y, float w, float h) {
    TextView t = texts.get(id);
    if (t != null) {
      LayoutParams p = params(x, y, w, h);
      if(p.width!=t.getLayoutParams().width||p.height!=t.getLayoutParams().height||p.leftMargin!=((LayoutParams)t.getLayoutParams()).leftMargin||p.topMargin!=((LayoutParams)t.getLayoutParams()).topMargin)t.setLayoutParams(p);
      t.setMaxLines(Math.max(1,(int)(h*scale/Math.max(1,t.getLineHeight()))));
    }
  }

  public void size(String id, float size) {
    TextView t = texts.get(id);
    if (t != null)
      t.setTextSize(TypedValue.COMPLEX_UNIT_PX, size * scale * app.prefs.getFloat("textScale", 1));
  }

  public void removeText(String id) {
    TextView t = texts.remove(id);
    if (t != null) removeView(t);
  }

  public LayoutParams params(float x, float y, float w, float h) {
    LayoutParams p = new LayoutParams(Math.round(w * scale), Math.round(h * scale));
    p.leftMargin = Math.round(x * scale);
    p.topMargin = Math.round((y - from) * scale);
    return p;
  }

  public void put(View v, float x, float y, float w, float h) {
    addView(v, params(x, y, w, h));
  }

  public View action(String label, float x, float y, float w, float h, Runnable click) {
    View b = new View(getContext());
    b.setContentDescription(label);
    b.setFocusable(true);
    b.setBackground(
        new RippleDrawable(
            android.content.res.ColorStateList.valueOf(themed(0x18747468)),
            null,
            new ColorDrawable(Color.WHITE)));
    b.setOnClickListener(
        v -> {
          if (app.prefs.getBoolean("haptic", true))
            v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
          click.run();
        });
    put(b, x, y, w, h);
    return b;
  }

  static boolean baking;
  Bitmap exportBitmap() { return background.bitmap; }
  private void requestRaster(JSONArray nodes) {
    if(!baking) {
      String asset="surfaces/"+app.prefs.getString("theme","paper")+"-"+page+".png";
      Bitmap baked=cache.get(asset);
      if(baked==null) try(java.io.InputStream input=getContext().getAssets().open(asset)) {
        baked=BitmapFactory.decodeStream(input);if(baked!=null)cache.put(asset,baked);
      }catch(java.io.IOException ignored){}
      if(baked!=null){background.bitmap=baked;background.whole=true;
        if(app.prefs.getInt("depth",72)==72)return;
      }
    }

    String key =
        page
            + ":"
            + scale
            + ":"
            + from
            + ":"
            + to
            + ":"
            + hidden
            + ":"
            + app.prefs.getString("theme", "paper")
            + ":"
            + app.prefs.getInt("depth", 72);
    Bitmap ready = cache.get(key);
    if (ready != null) {
      background.whole = false;
      background.bitmap = ready;
      return;
    }
    render.execute(
        () -> {
          try {
            long t0 = System.currentTimeMillis();
            Bitmap b =
                Bitmap.createBitmap(
                    Math.max(1, Math.round(390 * scale)),
                    Math.max(1, Math.round((to - from) * scale)),
                    Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            c.scale(scale, scale);
            c.translate(0, -from);
            for (int i = 0; i < nodes.length(); i++) {
              JSONObject n = nodes.getJSONObject(i);
              if (n.optBoolean("visible", true)
                  && n.getJSONObject("transform").optDouble("m12") >= from
                  && n.getJSONObject("transform").optDouble("m12") < to
                  && !hidden.contains(n.getString("id"))
                  && !n.getString("type").equals("TEXT")) drawNode(c, n);
            }
            cache.put(key, b);
            long elapsed = System.currentTimeMillis() - t0;
            android.util.Log.d("DesignScene", "Raster key=" + key + " took " + elapsed + "ms");
            new android.os.Handler(android.os.Looper.getMainLooper()).post(
                () -> {
                  background.whole = false;
                  background.bitmap = b;
                  background.invalidate();
                });
          } catch (Exception e) {
            android.util.Log.e("DesignScene", "Rasterization", e);
          }
        });
  }

  private class Background extends View {
    volatile Bitmap bitmap;
    boolean whole;
    Paint p = new Paint(Paint.FILTER_BITMAP_FLAG);

    Background(Context c) {
      super(c);
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    @Override
    protected void onDraw(Canvas c) {
      super.onDraw(c);
      if(bitmap!=null) {
        if(whole) c.drawBitmap(bitmap,new Rect(0,Math.round(from*2),bitmap.getWidth(),Math.min(bitmap.getHeight(),Math.round(to*2))),new Rect(0,0,getWidth(),getHeight()),p);
        else c.drawBitmap(bitmap,0,0,p);
      }
    }
  }

  private static int color(JSONObject c) {
    return Color.argb(
        (int) Math.round(c.optDouble("a", 1) * 255),
        (int) Math.round(c.optDouble("r") * 255),
        (int) Math.round(c.optDouble("g") * 255),
        (int) Math.round(c.optDouble("b") * 255));
  }

  private static int paintColor(JSONObject p) {
    JSONObject c = p.optJSONObject("color");
    int base = c == null ? Color.BLACK : color(c);
    return (base & 0xffffff) | ((int) (Color.alpha(base) * p.optDouble("opacity", 1)) << 24);
  }

  private Path geometry(JSONArray geometry) throws JSONException {
    Path p = new Path();
    if (geometry == null) return p;
    for (int i = 0; i < geometry.length(); i++) {
      JSONObject g = geometry.getJSONObject(i);
      p.setFillType(
          g.optString("rule").equals("ODD") ? Path.FillType.EVEN_ODD : Path.FillType.WINDING);
      JSONArray commands = g.getJSONArray("path");
      for (int j = 0; j < commands.length(); j++) {
        JSONArray a = commands.getJSONArray(j);
        switch (a.getInt(0)) {
          case 0:
            p.close();
            break;
          case 1:
            p.moveTo((float) a.getDouble(1), (float) a.getDouble(2));
            break;
          case 2:
            p.lineTo((float) a.getDouble(1), (float) a.getDouble(2));
            break;
          case 3:
            p.quadTo(
                (float) a.getDouble(1),
                (float) a.getDouble(2),
                (float) a.getDouble(3),
                (float) a.getDouble(4));
            break;
          case 4:
            p.cubicTo(
                (float) a.getDouble(1),
                (float) a.getDouble(2),
                (float) a.getDouble(3),
                (float) a.getDouble(4),
                (float) a.getDouble(5),
                (float) a.getDouble(6));
            break;
        }
      }
    }
    return p;
  }

  private void drawNode(Canvas c, JSONObject n) throws JSONException {
    String nid = n.optString("id");
    if (n.optString("name").equals("NavIcon / Home Roof L")) {
      Paint rp = new Paint(Paint.ANTI_ALIAS_FLAG);
      rp.setStyle(Paint.Style.STROKE);
      rp.setStrokeWidth(1.25f);
      rp.setStrokeCap(Paint.Cap.ROUND);
      rp.setStrokeJoin(Paint.Join.ROUND);
      rp.setColor(themed(0xff11110f));
      Path roof = new Path();
      roof.moveTo(39.5f, 803f);
      roof.lineTo(46f, 797f);
      roof.lineTo(52.5f, 803f);
      c.drawPath(roof, rp);
      return;
    }
    if (n.optString("name").equals("NavIcon / Home Roof R")) {
      return;
    }
    JSONObject t = n.getJSONObject("transform");
    Matrix m = new Matrix();
    m.setValues(
        new float[] {
          (float) t.optDouble("m00", 1),
          (float) t.optDouble("m01"),
          (float) t.optDouble("m02"),
          (float) t.optDouble("m10"),
          (float) t.optDouble("m11", 1),
          (float) t.optDouble("m12"),
          0,
          0,
          1
        });
    c.save();
    c.concat(m);
    Path fill = geometry(n.optJSONArray("fillGeometry")),
        stroke = geometry(n.optJSONArray("strokeGeometry"));
    Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    float opacity = (float) n.optDouble("opacity", 1), depth = app.prefs.getInt("depth", 72) / 72f;
    JSONArray effects = n.optJSONArray("effects");
    if (effects != null && depth > 0)
      for (int i = 0; i < effects.length(); i++) {
        JSONObject e = effects.getJSONObject(i);
        if (!e.optBoolean("visible", true) || !e.optString("type").equals("DROP_SHADOW")) continue;
        JSONObject off = e.getJSONObject("offset");
        p.setColor(Color.BLACK);
        int col = color(e.getJSONObject("color"));
        if (app.prefs.getString("theme", "paper").equals("dark"))
          col = (col & 0xffffff) == 0xffffff ? 0x164f4f49 : 0x66000000;
        if (app.prefs.getString("theme", "paper").equals("night"))
          col = (col & 0xffffff) == 0xffffff ? 0x182f2d32 : 0x99000000;
        p.setShadowLayer(
            (float) e.optDouble("radius") / 2 * depth,
            (float) off.optDouble("x") * depth,
            (float) off.optDouble("y") * depth,
            col);
        c.save();
        c.clipOutPath(fill);
        c.drawPath(fill, p);
        c.restore();
        p.clearShadowLayer();
      }
    drawPaints(c, fill, n.optJSONArray("fillPaints"), p, n, opacity);
    if (effects != null && depth > 0)
      for (int i = 0; i < effects.length(); i++) {
        JSONObject e = effects.getJSONObject(i);
        if (!e.optBoolean("visible", true) || !e.optString("type").equals("INNER_SHADOW")) continue;
        JSONObject off = e.getJSONObject("offset");
        c.save();
        c.clipPath(fill);
        RectF b = new RectF();
        fill.computeBounds(b, true);
        float pad = Math.max(16f, (float) e.optDouble("radius") * depth * 2f + 16f);
        b.inset(-pad, -pad);
        Path inv = new Path();
        inv.addRect(b, Path.Direction.CW);
        inv.op(fill, Path.Op.DIFFERENCE);
        p.setColor(Color.BLACK);
        p.setShadowLayer(
            Math.max(.2f, (float) e.optDouble("radius") / 2 * depth),
            (float) off.optDouble("x") * depth,
            (float) off.optDouble("y") * depth,
            app.prefs.getString("theme","paper").equals("night")
                ? ((color(e.getJSONObject("color"))&0xffffff)==0xffffff?0x182f2d32:0x99000000)
                : themed(color(e.getJSONObject("color"))));
        c.drawPath(inv, p);
        p.clearShadowLayer();
        c.restore();
      }
    drawPaints(c, stroke, n.optJSONArray("strokePaints"), p, n, opacity);
    c.restore();
  }

  private void drawPaints(
      Canvas c, Path path, JSONArray paints, Paint p, JSONObject n, float opacity)
      throws JSONException {
    if (paints == null) return;
    for (int i = 0; i < paints.length(); i++) {
      JSONObject paint = paints.getJSONObject(i);
      if (!paint.optBoolean("visible", true)) continue;
      p.setShader(null);
      p.setColor(themed(paintColor(paint)));
      p.setAlpha((int) (Color.alpha(p.getColor()) * opacity));
      if (paint.optString("type").equals("GRADIENT_LINEAR")) {
        JSONArray stops = paint.getJSONArray("stops");
        int[] colors = new int[stops.length()];
        float[] pos = new float[stops.length()];
        for (int j = 0; j < stops.length(); j++) {
          colors[j] = themed(color(stops.getJSONObject(j).getJSONObject("color")));
          pos[j] = (float) stops.getJSONObject(j).getDouble("position");
        }
        JSONObject size = n.getJSONObject("size");
        p.setShader(
            new LinearGradient(
                0,
                0,
                (float) size.optDouble("x", 1),
                (float) size.optDouble("y", 1),
                colors,
                pos,
                Shader.TileMode.CLAMP));
      }
      c.drawPath(path, p);
    }
    p.setShader(null);
  }
}
