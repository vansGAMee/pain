package dev.mono.local;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.*;
import android.graphics.drawable.*;
import android.media.audiofx.AudioEffect;
import android.net.Uri;
import android.os.*;
import android.text.*;
import android.util.TypedValue;
import android.view.*;
import android.widget.*;
import androidx.media3.common.*;
import androidx.media3.session.*;
import androidx.media3.session.MediaController;
import com.google.common.util.concurrent.ListenableFuture;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class MainActivity extends Activity {
  private MonoApp app;
  private MediaController player;
  private ListenableFuture<MediaController> controllerFuture;
  private LinearLayout root, body;
  private DesignScene scene, dock;
  private int page = 0;
  private float scale;
  private boolean resumed;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Runnable dataListener = this::onData;
  private final List<InstrumentView> plays = new ArrayList<>(), progressViews = new ArrayList<>();
  private InstrumentView dial, clock, pulse, discovery, repeatView, heartView;
  private TextView message;
  private ImageView playerArt,miniArt,homeArt;
  private ListView libraryList;
  private LibraryAdapter adapter;
  private String libraryTitle = "";
  private String libraryMode = "Albums", group = "", search = "", sort = "Title";

  private String state(String key,boolean value){return app.prefs.getBoolean(key,value)?"включено":"выключено";}
  private String themeName() {
    return switch(app.prefs.getString("theme","paper")){case "dark"->"Графит";case "mist"->"Туман";default->"Тёплая бумага";};
  }
  private boolean isRu() {
    return app.prefs.getString("lang", "ru").equals("ru");
  }

  private String localizedLibraryMode() {
    if (!isRu()) return libraryMode;
    switch (libraryMode) {
      case "Albums": return "Альбомы";
      case "Artists": return "Исполнители";
      case "Genres": return "Жанры";
      case "Tracks": return "Все треки";
      case "Years": return "Годы";
      case "Formats": return "Форматы";
      case "Folders": return "Папки";
      case "Composers": return "Композиторы";
      case "Playlists": return "Плейлисты";
      case "Favorites": return "Избранное";
      default: return libraryMode;
    }
  }
  private int libraryGeneration;
  private List<Track> lastTracks;
  private long rangeStart = 0;
  private Repository.Stats detail;
  private List<Lrc.Line> lyrics = List.of();
  private String lyricTrack = "", lyricBody = "";
  private int lyricOffset, lyricIndex = -2;
  private boolean lyricLoading;
  private static final int AUDIO_FILES = 10, LRC_FILE = 11, EXPORT = 12, EXPORT_LRC = 13;
  private String importLyricTrack = "", exportBody = "";
  private int statsTicks;
  private final Runnable ticker =
      new Runnable() {
        public void run() {
          if (!resumed) return;
          updatePlayback();
          if (page == 7) updateLyrics();
          if (++statsTicks % 60 == 0 && (page == 0 || page == 3 || page == 5)) app.refreshStats();
          handler.postDelayed(this, 250);
        }
      };
  private final Player.Listener playerListener =
      new Player.Listener() {
        @Override
        public void onEvents(Player p, Player.Events events) {
          updatePlayback();
          if (events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)) {
            bind();
            if (page == 7) loadLyrics();
          }
          if (events.contains(Player.EVENT_PLAYER_ERROR))
            toast("Файл недоступен или формат не поддерживается");
        }
      };

  @Override
  public void onCreate(Bundle saved) {
    app = (MonoApp) getApplication();
    if (app.prefs.getString("theme", "paper").equals("dark")) setTheme(R.style.DarkAppTheme);
    super.onCreate(saved);
    if (saved != null) page = saved.getInt("page", 0);
    root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER_HORIZONTAL);
    root.setBackgroundColor(paper());
    setContentView(root);
    androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    root.setOnApplyWindowInsetsListener(
        (v, insets) -> {
          if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets i =
                insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            v.setPadding(i.left, i.top, i.right, i.bottom);
          } else
            v.setPadding(
                insets.getSystemWindowInsetLeft(),
                insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(),
                insets.getSystemWindowInsetBottom());
          return insets;
        });
    root.post(
        () -> {
          scale = Math.min(root.getWidth() - root.getPaddingLeft() - root.getPaddingRight(), dp(440)) / 390f;

          show(page, false);
        });
    app.listeners.add(dataListener);
    SessionToken token = new SessionToken(this, new ComponentName(this, PlaybackService.class));
    controllerFuture = new MediaController.Builder(this, token).buildAsync();
    controllerFuture.addListener(
        () -> {
          try {
            player = controllerFuture.get();
            player.addListener(playerListener);
            updatePlayback();
            bind();
          } catch (Exception e) {
            toast("Не удалось подключить плеер");
          }
        },
        command -> handler.post(command));
    if (app.hasPermission() && app.prefs.getBoolean("autoScan", true)) app.scan();
    requestRefreshRate();
  }

  @Override
  protected void onResume() {
    super.onResume();
    resumed = true;
    handler.removeCallbacks(ticker);
    handler.post(ticker);
    app.refreshStats();
  }

  @Override
  protected void onPause() {
    super.onPause();
    resumed = false;
    updatePlayback();
    handler.removeCallbacks(ticker);
    if (app.service != null) app.service.checkpoint();
  }

  @Override
  protected void onDestroy() {
    app.listeners.remove(dataListener);
    handler.removeCallbacksAndMessages(null);
    if (player != null) player.removeListener(playerListener);
    if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
    super.onDestroy();
  }

  @Override
  public void onConfigurationChanged(Configuration c) {
    super.onConfigurationChanged(c);
    root.post(
        () -> {
          scale = Math.min(root.getWidth() - root.getPaddingLeft() - root.getPaddingRight(), dp(440)) / 390f;
          show(page, false);
        });
  }

  @Override
  public void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    out.putInt("page", page);
  }

  @Override
  public void onBackPressed() {
    if (page == 7) show(1, true);
    else if (page == 5) show(3, true);
    else if (page == 6) show(0, true);
    else if (page == 2 && !group.isEmpty()) {
      group = "";
      show(2, true);
    } else if (page != 0) show(0, true);
    else super.onBackPressed();
  }

  private void requestRefreshRate() {
    if (!app.prefs.getBoolean("highRefresh", true)) return;
    Display display = getWindowManager().getDefaultDisplay();
    Display.Mode current = display.getMode(), best = current;
    for (Display.Mode m : display.getSupportedModes())
      if (m.getPhysicalWidth() == current.getPhysicalWidth()
          && m.getPhysicalHeight() == current.getPhysicalHeight()
          && m.getRefreshRate() > best.getRefreshRate()) best = m;
    WindowManager.LayoutParams p = getWindow().getAttributes();
    p.preferredDisplayModeId = best.getModeId();
    getWindow().setAttributes(p);
  }

  private int dp(float v) {
    return Math.round(v * getResources().getDisplayMetrics().density);
  }

  private int sx(float v) {
    return Math.round(v * scale);
  }

  private int paper() {
    String t = app.prefs.getString("theme", "paper");
    return t.equals("dark") ? 0xff292928 : t.equals("mist") ? 0xffeeeeF0 : 0xffefede6;
  }

  private int ink() {
    return app.prefs.getString("theme", "paper").equals("dark") ? 0xffdeded5 : 0xff11110f;
  }

  private void onData() {
    if (isFinishing() || scene == null) return;
    bind();
    if (page == 2 && lastTracks != app.tracks) {
      lastTracks = app.tracks;
      rebuildLibrary();
    }
    if (page == 5) loadDetail();
  }

  static Set<String> hidden(int p) {
    Set<String> h = new HashSet<>();
    switch (p) {
      case 0:
        Collections.addAll(h, "3:35", "16:2", "16:3", "16:4");
        break;
      case 1:
        Collections.addAll(
            h, "3:68", "3:67", "3:72", "3:73", "3:74", "3:78", "10:2", "10:3", "16:5", "16:6");
        break;
      case 2:
        Collections.addAll(h, "3:128", "12:13", "12:14");
        break;
      case 3:
        Collections.addAll(
            h, "3:201", "9:51", "9:65", "9:66", "9:67", "9:68", "9:69", "9:70", "9:71");
        for (int i = 12; i <= 35; i++) h.add("9:" + i);
        for (int i = 21; i <= 27; i++) h.add("12:" + i);
        break;
      case 4:
        Collections.addAll(h, "3:235", "3:236", "3:237", "16:10", "16:11");
        break;
      case 5:
        Collections.addAll(h, "9:98", "9:102", "9:106", "9:110");
        break;
      case 6:
        Collections.addAll(h, "22:17", "22:18", "22:21", "22:22", "22:23", "22:24", "22:25", "22:28", "22:29");
        break;
      case 7:
        Collections.addAll(h, "22:61", "22:62", "22:63", "22:71", "22:72", "22:84", "22:85");
        break;
    }
    int navStart = p==0?2:p==2?13:p==3?24:p==4?35:p==5?46:-1;
    if(navStart>=0)for(int i=navStart;i<navStart+11;i++)h.add("13:"+i);
    return h;
  }

  private void show(int next, boolean animate) {
    if (scale <= 0) return;
    page = next;
    detailBars.clear();
    summary = null;
    plays.clear();
    progressViews.clear();
    dial = clock = pulse = discovery = repeatView = heartView = null;
    scene = dock = null;
    playerArt=miniArt=homeArt=null;
    libraryList = null;
    message = null;
    root.removeAllViews();
    root.setBackgroundColor(paper());
    getWindow().setStatusBarColor(paper());
    getWindow().setNavigationBarColor(paper());
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | (app.prefs.getString("theme", "paper").equals("dark")
                    ? 0
                    : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                        | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR));
    body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    root.addView(body, new LinearLayout.LayoutParams(sx(390), 0, 1));
    if (page == 2) {
      buildLibrary();
    } else {
      float end = (page == 0 || page == 3) ? 710 : (page == 4 || page == 5) ? 774 : 854;
      ScrollView scroll = new ScrollView(this);
      scroll.setFillViewport(false);
      scroll.setClipToPadding(false);
      scroll.setVerticalScrollBarEnabled(false);
      scene = new DesignScene(this, page, scale, 40, end, hidden(page));
      scroll.addView(scene, new ScrollView.LayoutParams(-1, sx(end - 40)));
      body.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
    }
    if (page == 0 || page == 2 || page == 3 || page == 4 || page == 5) {
      float start = (page == 4 || page == 5) ? 774 : 706;
      dock = new DesignScene(this, page, scale, start, 844, hidden(page));
      root.addView(dock, new LinearLayout.LayoutParams(sx(390), sx(844 - start)));
      setupDock(start);
    }
    setupActions();
    bind();
    updatePlayback();
    if (page == 0 || page == 3 || page == 5) {
      if (app.service != null) app.service.checkpoint();
      app.refreshStats();
    }
    if (page == 7) loadLyrics();
    if (page == 5) loadDetail();
    if (animate && MicroMotion.enabled(body)) {
      body.setAlpha(.94f);
      body.setTranslationY(dp(2));
      body.animate().alpha(1).translationY(0).setDuration(220).setInterpolator(MicroMotion.EASE).start();
    }
  }

  private ImageView cover(DesignScene target,float x,float y,float w,float h,int radius) {
    ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);
    GradientDrawable outline=new GradientDrawable();outline.setColor(Color.TRANSPARENT);outline.setCornerRadius(sx(radius));image.setBackground(outline);image.setClipToOutline(true);
    image.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    target.put(image,x,y,w,h);return image;
  }
  private void setupDock(float start) {
    // The original relief capsule stays; icon and caption share one measured column.
    for(String id:new String[]{"3:37","3:38","3:39","3:40","3:41","3:42","3:43","3:44",
        "3:130","3:131","3:132","3:133","3:134","3:135","3:136","3:137",
        "3:203","3:204","3:205","3:206","3:207","3:208","3:209","3:210",
        "3:240","3:241","3:242","3:243","3:244","3:245","3:246","3:247",
        "9:125","9:126","9:127","9:128","9:129","9:130","9:131","9:132"})dock.removeText(id);
    String[] names=isRu()?new String[]{"Главная","Библиотека","Инсайты","Устройства"}:new String[]{"Home","Library","Insights","Devices"};
    String[] icons={"home","library","stats","device"};int[] targets={0,2,3,4};
    LinearLayout nav=new LinearLayout(this);nav.setGravity(Gravity.CENTER_VERTICAL);
    dock.put(nav,18,780,354,54);
    for(int i=0;i<4;i++){
      final int target=targets[i];boolean selected=page==target||(page==5&&target==3);
      LinearLayout item=new LinearLayout(this);item.setOrientation(LinearLayout.VERTICAL);item.setGravity(Gravity.CENTER);
      item.setPadding(0,sx(4),0,sx(3));
      IconView icon=new IconView(this,icons[i],ink());icon.setAlpha(selected?1f:.62f);
      icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
      item.addView(icon,new LinearLayout.LayoutParams(sx(23),sx(23)));
      TextView caption=label(names[i],10);caption.setGravity(Gravity.CENTER);caption.setSingleLine(true);
      caption.setTypeface(DesignScene.font(this,selected?"SemiBold":"Medium"));
      caption.setTextSize(TypedValue.COMPLEX_UNIT_PX,10*scale*app.prefs.getFloat("textScale",1));
      caption.setAlpha(selected?1f:.7f);caption.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
      caption.setEllipsize(android.text.TextUtils.TruncateAt.END);
      LinearLayout.LayoutParams textParams=new LinearLayout.LayoutParams(-1,sx(17));textParams.topMargin=sx(2);item.addView(caption,textParams);
      item.setContentDescription(names[i]);item.setSelected(selected);item.setFocusable(true);
      item.setOnClickListener(v->{if(page!=target)show(target,true);});
      MicroMotion.press(item,icon,.965f);
      nav.addView(item,new LinearLayout.LayoutParams(0,-1,1));
    }
    if (start < 712) {
      miniArt=cover(dock,33,724,30,36,4);
      dock.action("Открыть плеер", 18, 712, 288, 56, () -> show(1, true));
      addPlay(dock, 326, 724, 28, 30, true);
    }
  }

  private InstrumentView addPlay(
      DesignScene s, float x, float y, float w, float h, boolean inverse) {
    InstrumentView v = new InstrumentView(this, "play");
    v.ink = inverse ? paper() : ink();
    v.setContentDescription("Воспроизвести / пауза");
    s.put(v, x, y, w, h);
    View touch = s.action("Воспроизвести / пауза", x - 10, y - 10, w + 20, h + 20, this::toggle);
    MicroMotion.press(touch, v, .965f);
    plays.add(v);
    return v;
  }

  private void setupActions() {
    if (scene == null) return;
    switch (page) {
      case 0:
        homeArt=cover(scene,266,271,42,42,21);
        scene.action("Настройки", 320, 48, 48, 48, () -> show(6, true));
        TextView gear = label("☷", 23);
        scene.put(gear, 338, 60, 26, 28);
        gear.setOnClickListener(v -> show(6, true));
        MicroMotion.press(gear,gear,.97f);
        scene.action(
            "Продолжить слушать",
            24,
            214,
            342,
            194,
            () -> {
              if (current() == null) openLibrary();
              else {
                show(1, true);
                toggleIfPaused();
              }
            });
        scene.action("Статистика за сегодня", 24, 433, 342, 73, () -> show(3, true));
        scene.action(
            "Любимая песня недели",
            24,
            516,
            342,
            124,
            () -> {
              Track t = app.track(app.stats.obsession);
              if (t != null) play(List.of(t), 0);
              else openLibrary();
            });
        message = label("", 12);
        scene.put(message, 24, 658, 342, 48);
        break;
      case 1:
        playerArt=cover(scene,151,332,88,88,8);
        scene.action("Назад", 12, 48, 48, 50, this::onBackPressed);
        scene.action("Меню плеера", 320, 48, 58, 48, this::playerMenu);

        repeatView = new InstrumentView(this, "repeat");
        repeatView.ink = ink();
        repeatView.active = player != null && player.getRepeatMode() == Player.REPEAT_MODE_ONE;
        repeatView.setContentDescription("Повтор трека");
        scene.put(repeatView, 20, 658, 36, 36);
        scene.action("Повтор трека", 14, 650, 48, 52, this::toggleRepeat);

        scene.action("Предыдущий трек", 63, 643, 66, 66, this::previous);
        addPlay(scene, 177, 650, 36, 44, true);
        scene.action("Следующий трек", 260, 643, 66, 66, this::next);

        heartView = new InstrumentView(this, "heart");
        heartView.ink = ink();
        Track curT = current();
        heartView.active = curT != null && curT.favorite;
        heartView.setContentDescription("В избранное");
        scene.put(heartView, 334, 658, 36, 36);
        scene.action("В избранное", 328, 650, 48, 52, this::toggleFavoriteCurrent);

        scene.action("Очередь", 12, 748, 176, 55, this::queue);
        scene.action("Караоке", 252, 748, 126, 55, () -> show(7, true));
        InstrumentView seek = new InstrumentView(this, "progress");
        seek.ink = ink();
        seek.seek = f -> seek(f);
        seek.setContentDescription("Позиция воспроизведения");
        scene.put(seek, 24, 575, 342, 42);
        progressViews.add(seek);
        dial = new InstrumentView(this, "dial");
        dial.ink = ink();
        dial.seek = f -> seek(f);
        dial.setContentDescription("Круговая перемотка");
        scene.put(dial, 48, 229, 294, 294);
        break;
      case 3:
        scene.action("Подробная статистика", 24, 140, 342, 104, () -> show(5, true));
        scene.action("Период и подробности", 24, 270, 342, 434, () -> show(5, true));
        clock = new InstrumentView(this, "clock");
        clock.ink = ink();
        scene.put(clock, 50, 303, 106, 106);
        pulse = new InstrumentView(this, "bars");
        pulse.ink = ink();
        scene.put(pulse, 198, 672, 148, 32);
        discovery = new InstrumentView(this, "ratio");
        discovery.ink = ink();
        scene.put(discovery, 24, 503, 342, 6);
        break;
      case 4:
        scene.action("Текущее устройство", 24, 224, 342, 136, () -> scanOptions());
        scene.action("Синхронизация", 24, 382, 342, 136, this::syncOptions);
        scene.action("Настройки хранилища", 24, 558, 342, 132, this::scanOptions);
        break;
      case 5:
        scene.action("Назад", 12, 48, 48, 50, this::onBackPressed);
        scene.action("Выбрать период", 222, 92, 152, 52, this::rangeDialog);
        scene.action("Ещё метрики", 24, 670, 342, 90, this::moreStats);
        break;
      case 6:
        scene.action("Назад", 12, 48, 48, 50, this::onBackPressed);
        scene.action(
            "Непрерывное воспроизведение",
            24,
            289,
            342,
            50,
            () ->
                info(
                    "Gapless",
                    "Media3 автоматически воспроизводит альбом без добавленной паузы, если формат и"
                        + " кодек содержат данные для gapless. На этом экране сохранены элементы"
                        + " исходного дизайна."));
        scene.action(
            "Кроссфейд",
            24,
            342,
            342,
            59,
            () ->
                info(
                    "Кроссфейд",
                    "Перекрытие двух треков появится позже. Сейчас работает"
                        + " один аудиодвижок, без искусственной паузы."));
        scene.action(
            "ReplayGain",
            24,
            407,
            342,
            48,
            () ->
                info(
                    "ReplayGain",
                    "Чтение тегов ReplayGain и нормализация — следующий этап. Сейчас громкость"
                        + " исходного файла не изменяется."));
        scene.action("Библиотека и теги", 24, 482, 342, 56, this::scanOptions);
        scene.action("Внешний вид", 24, 550, 342, 56, this::appearance);
        scene.action(
            "Тексты и караоке",
            24,
            618,
            342,
            56,
            () -> {
              if (current() != null) show(7, true);
              else
                info(
                    "Караоке",
                    "Выберите песню, затем откройте текст в меню плеера. Можно вставить текст,"
                        + " импортировать .lrc и расставить время строк вручную.");
            });
        scene.action("Устройства", 24, 686, 342, 56, () -> show(4, true));
        scene.action("Расширенные настройки", 24, 752, 342, 65, this::advanced);
        break;
      case 7:
        scene.action("Назад", 12, 48, 48, 50, this::onBackPressed);
        scene.action("Редактировать текст", 218, 106, 148, 44, this::lyricsMenu);
        scene.action("Смещение текста", 24, 157, 342, 52, this::offsetDialog);
        scene.action("Предыдущий трек", 35, 675, 66, 66, this::previous);
        scene.action("Следующий трек", 289, 675, 66, 66, this::next);
        addPlay(scene, 179, 689, 32, 36, true);
        scene.action("Уменьшить текст", 30, 774, 52, 45, () -> lyricSize(-2));
        scene.action("Увеличить текст", 85, 774, 52, 45, () -> lyricSize(2));
        scene.action(
            "Фокус строки",
            155,
            774,
            203,
            45,
            () -> {
              app.prefs
                  .edit()
                  .putBoolean("lineFocus", !app.prefs.getBoolean("lineFocus", true))
                  .apply();
              updateLyrics();
            });
        scene.action("Текст и синхронизация", 24, 233, 342, 405, this::lyricsMenu);
        break;
    }
  }

  private void bind() {
    if (scene == null) return;
    Repository.Stats s = app.stats;
    if(isRu()) {
      scene.text("3:19","Сегодня");scene.text("3:23","На повторе");
      scene.text("3:28","до конца");scene.bounds("3:28",271,592,76,18);
      scene.text("3:68","");
    }
    Track t = current();
    if(playerArt!=null)Art.load(this,playerArt,t,false);
    if(miniArt!=null)Art.load(this,miniArt,t,false);
    if(homeArt!=null)Art.load(this,homeArt,t,false);
    String title = t == null ? (isRu() ? "Выберите музыку" : "Choose music") : t.title,
        artist = t == null ? (isRu() ? "Локальная библиотека" : "Local library") : t.artist;
    if(dock != null) for(String id:new String[]{"3:33","3:34","3:126","3:127","3:199","3:200"}) {
      TextView tv=dock.texts.get(id);if(tv!=null){tv.setSingleLine(true);tv.setEllipsize(TextUtils.TruncateAt.END);}
    }
    if (dock != null) {
      String idHome = page == 0 ? "3:38" : page == 2 ? "3:131" : page == 3 ? "3:204" : page == 4 ? "3:241" : page == 5 ? "9:126" : null;
      String idLib = page == 0 ? "3:40" : page == 2 ? "3:133" : page == 3 ? "3:206" : page == 4 ? "3:243" : page == 5 ? "9:128" : null;
      String idIns = page == 0 ? "3:42" : page == 2 ? "3:135" : page == 3 ? "3:208" : page == 4 ? "3:245" : page == 5 ? "9:130" : null;
      String idDev = page == 0 ? "3:44" : page == 2 ? "3:137" : page == 3 ? "3:210" : page == 4 ? "3:247" : page == 5 ? "9:132" : null;
      if (isRu()) {
        if (idHome != null) {
          dock.text(idHome, "Главная");
          dock.bounds(idHome, 8, 811, 76, 16);
          TextView tv = dock.texts.get(idHome);
          if (tv != null) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        }
        if (idLib != null) {
          dock.text(idLib, "Библиотека");
          dock.bounds(idLib, 96, 811, 76, 16);
          TextView tv = dock.texts.get(idLib);
          if (tv != null) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        }
        if (idIns != null) {
          dock.text(idIns, "Инсайты");
          dock.bounds(idIns, 184, 811, 76, 16);
          TextView tv = dock.texts.get(idIns);
          if (tv != null) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        }
        if (idDev != null) {
          dock.text(idDev, "Устройства");
          dock.bounds(idDev, 272, 811, 76, 16);
          TextView tv = dock.texts.get(idDev);
          if (tv != null) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        }
      } else {
        if (idHome != null) {
          dock.text(idHome, "Home");
          dock.bounds(idHome, 8, 811, 76, 16);
          TextView tv = dock.texts.get(idHome);
          if (tv != null) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        }
        if (idLib != null) {
          dock.text(idLib, "Library");
          dock.bounds(idLib, 96, 811, 76, 16);
          TextView tv = dock.texts.get(idLib);
          if (tv != null) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        }
        if (idIns != null) {
          dock.text(idIns, "Insights");
          dock.bounds(idIns, 184, 811, 76, 16);
          TextView tv = dock.texts.get(idIns);
          if (tv != null) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        }
        if (idDev != null) {
          dock.text(idDev, "Devices");
          dock.bounds(idDev, 272, 811, 76, 16);
          TextView tv = dock.texts.get(idDev);
          if (tv != null) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        }
      }
      switch (page) {
        case 0:
          dock.text("3:33", title);
          dock.bounds("3:33", 78, 722, 235, 20);
          dock.text("3:34", artist);
          dock.bounds("3:34", 78, 743, 235, 18);
          break;
        case 2:
          dock.text("3:126", title);
          dock.bounds("3:126", 78, 722, 235, 20);
          dock.text("3:127", artist);
          dock.bounds("3:127", 78, 743, 235, 18);
          break;
        case 3:
          dock.text("3:199", title);
          dock.bounds("3:199", 78, 722, 235, 20);
          dock.text("3:200", artist);
          dock.bounds("3:200", 78, 743, 235, 18);
          break;
      }
    }
    switch (page) {
      case 0:
        scene.text("3:6", "PAIN / LOCAL");
        int hour = LocalTime.now().getHour();
        if (isRu()) {
          String greet =
              hour < 6
                  ? "Доброй ночи,"
                  : hour < 12 ? "Доброе утро," : hour < 18 ? "Добрый день," : "Добрый вечер,";
          scene.text("3:7", greet + "\n" + app.prefs.getString("name", "Ivan") + ".");
          scene.text("3:8", "Твоя музыка, не алгоритмы.");
          scene.text("3:10", "ПРОДОЛЖИТЬ");
          scene.text("3:11", t == null ? "Локальная\nбиблиотека" : t.album);
          scene.bounds("3:11", 42, 260, 181, 66);
          scene.text("3:12", artist);
          scene.bounds("3:12", 42, 331, 175, 24);
          scene.text("12:3", "ЛОКАЛЬНО  •  " + app.tracks.size() + " ТРЕКОВ");
          scene.bounds("12:3", 42, 375, 230, 14);
          scene.text("3:20", Repository.formatTime(s.today));
          scene.bounds("3:20", 24, 463, 120, 38);
          scene.text("3:21", "Треков: " + s.todayTracks);
          scene.bounds("3:21", 145, 473, 125, 20);
          Track obsession = app.track(s.obsession);
          scene.text("3:24", obsession == null ? "Твой следующий трек" : obsession.title);
          scene.size("3:24", obsession == null ? 18 : 22);
          scene.bounds("3:24", 42, 560, 217, 36);
          scene.text("3:25", s.counts.getOrDefault(s.obsession, 0L) + " прослушиваний · всё время");
          scene.bounds("3:25", 42, 596, 215, 20);
          scene.text("3:27", percent(s.completed, s.completed + s.early + s.other));
          scene.bounds("3:27", 271, 556, 67, 36);
        } else {
          String greet =
              hour < 6
                  ? "Good night,"
                  : hour < 12 ? "Good morning," : hour < 18 ? "Good afternoon," : "Good evening,";
          scene.text("3:7", greet + "\n" + app.prefs.getString("name", "Ivan") + ".");
          scene.text("3:11", t == null ? "Your local\nlibrary" : t.album);
          scene.bounds("3:11", 42, 260, 181, 66);
          scene.text("3:12", artist);
          scene.bounds("3:12", 42, 331, 175, 24);
          scene.text("12:3", "LOCAL  •  " + app.tracks.size() + " TRACKS");
          scene.bounds("12:3", 42, 375, 230, 14);
          scene.text("3:20", Repository.formatTime(s.today));
          scene.bounds("3:20", 24, 463, 120, 38);
          scene.text("3:21", "Треков: " + s.todayTracks);
          scene.bounds("3:21", 145, 473, 125, 20);
          Track obsession = app.track(s.obsession);
          scene.text("3:24", obsession == null ? "Your next favorite" : obsession.title);
          scene.size("3:24", obsession == null ? 20 : 24);
          scene.bounds("3:24", 42, 560, 217, 32);
          scene.text("3:25", s.counts.getOrDefault(s.obsession, 0L) + " plays · all time");
          scene.bounds("3:25", 42, 592, 215, 20);
          scene.text("3:27", percent(s.completed, s.completed + s.early + s.other));
          scene.bounds("3:27", 271, 556, 67, 36);
        }
        if (message != null)
          message.setText(
              app.scanning
                  ? (isRu() ? app.scanMessage : "Сканирование…")
                  : s.insight);
        break;
      case 1:
        if (repeatView != null && player != null) {
          repeatView.active = player.getRepeatMode() == Player.REPEAT_MODE_ONE;
          repeatView.invalidate();
        }
        if (heartView != null) {
          heartView.active = t != null && t.favorite;
          heartView.invalidate();
        }
        TextView titleView = scene.texts.get("3:51");
        if (titleView != null) {
          titleView.setSingleLine(true);
          titleView.setEllipsize(TextUtils.TruncateAt.MARQUEE);
          titleView.setSelected(true);
          titleView.setMarqueeRepeatLimit(-1);
          titleView.setHorizontalFadingEdgeEnabled(true);
          titleView.setFadingEdgeLength(dp(12));
        }
        scene.text("3:50", artist);
        scene.bounds("3:50", 24, 112, 342, 18);
        scene.text("3:51", title);
        scene.bounds("3:51", 24, 134, 342, 51);
        scene.size("3:51", title.length() > 30 ? 24 : title.length() > 20 ? 28 : 36);
        scene.text("3:52", t == null ? (isRu() ? "Добавьте музыку" : "Add music to begin") : t.album);
        scene.bounds("3:52", 24, 182, 342, 30);
        scene.text("3:82", (isRu() ? "Текст  ·  " : "Lyrics  ·  ") + (t == null ? (isRu() ? "локально" : "local") : format(t)));
        scene.bounds("3:82", 252, 770, 124, 20);
        break;
      case 2:
        if (isRu()) {
          scene.text("3:87", "БИБЛИОТЕКА");
          scene.bounds("3:87", 24, 60, 200, 24);
          scene.text("3:90", "Сортировка");
          scene.bounds("3:90", 274, 87, 96, 24);
        } else {
          scene.text("3:87", "LIBRARY");
          scene.bounds("3:87", 24, 60, 200, 24);
          scene.text("3:90", "Sort  ↕");
          scene.bounds("3:90", 280, 87, 90, 24);
        }
        scene.text("3:88", group.isEmpty() ? localizedLibraryMode() : libraryTitle);
        scene.size("3:88", (group.isEmpty() ? localizedLibraryMode() : libraryTitle).length() > 20 ? 22 : 34);
        scene.bounds("3:88", 24, 87, 192, 45);
        if (summary != null) {
          long bytes = 0;
          for (Track tr : app.tracks) bytes += tr.bytes;
          if (isRu()) {
            summary.text("3:119", "ОБЪЁМ БИБЛИОТЕКИ");
            summary.bounds("3:119", 42, 630, 220, 18);
          } else {
            summary.text("3:119", "LIBRARY SIZE");
            summary.bounds("3:119", 42, 630, 200, 18);
          }
          summary.text("3:120", app.tracks.size() + (isRu() ? " треков" : " треков"));
          summary.bounds("3:120", 42, 651, 218, 30);
          summary.text("3:121", String.format(Locale.ROOT, "%.1f ГБ", bytes / 1e9));
          summary.bounds("3:121", 267, 654, 85, 25);
        }
        break;
      case 3:
        scene.text("3:142", "Инсайты / " + LocalDate.now().getYear());
        scene.text("9:3", "" + (s.heard / 60000));
        scene.bounds("9:3", 42, 157, 190, 50);
        scene.text("9:5", s.sessionCount + " сессий");
        scene.bounds("9:5", 238, 166, 115, 19);
        scene.text("9:6", s.unique + " треков");
        scene.bounds("9:6", 238, 190, 115, 18);
        scene.text("9:36", s.peak < 0 ? "—" : String.format(Locale.ROOT, "%02d:00", s.peak));
        scene.text("9:40", "" + s.streak);
        scene.text("9:44", s.longestStreak + " дней");
        scene.bounds("9:44", 293, 390, 61, 18);
        scene.text("9:46", percent(s.newPlays, s.qualified));
        scene.text("9:48", percent(s.qualified - s.newPlays, s.qualified));
        long ended = s.completed + s.early + s.other;
        scene.text("9:54", percent(s.completed, ended));
        scene.text("9:56", percent(s.early, ended));
        scene.text("9:58", percent(s.replayed, s.qualified));
        scene.text("9:60", percent(s.other, ended));
        Track obsession2 = app.track(s.obsession);
        scene.text("9:63", obsession2 == null ? "Пока нет прослушиваний" : obsession2.title);
        scene.bounds("9:63", 24, 668, 169, 30);
        scene.size("9:63", 18);
        scene.text("9:64", s.counts.getOrDefault(s.obsession, 0L) + " прослушиваний");
        scene.bounds("9:64", 24, 693, 173, 16);
        if (discovery != null) {
          discovery.progress = s.qualified > 0 ? (float) s.newPlays / s.qualified : 0;
          discovery.invalidate();
        }
        if (clock != null) {
          clock.values = s.hours;
          clock.invalidate();
        }
        if (pulse != null) {
          pulse.values = s.week;
          pulse.invalidate();
        }
        break;
      case 4:
        scene.text("3:216", isRu() ? "Твоя музыка,\nрядом." : "Your music,\nclose.");
        scene.text("3:220", isRu() ? "На этом телефоне" : "On this phone");
        scene.bounds("3:220", 76, 239, 260, 22);
        scene.text(
            "3:221",
            isRu()
                ? (app.tracks.size() + " треков в библиотеке")
                : (app.tracks.size() + " tracks in library"));
        scene.bounds("3:221", 76, 263, 263, 22);
        scene.text(
            "3:222",
            app.scanning
                ? (isRu() ? "Сканирование…" : "Scanning…")
                : (isRu() ? "Хранится на устройстве" : "Stored on device"));
        scene.bounds("3:222", 76, 286, 265, 20);
        scene.text("3:224", isRu() ? "Сканировать" : "Scan");
        scene.bounds("3:224", 94, 323, 140, 18);
        scene.text("3:227", "WINDOWS & DESKTOP");
        scene.bounds("3:227", 76, 397, 252, 20);
        String syncIp = app.syncServer != null ? app.syncServer.getLocalIp() : "127.0.0.1";
        scene.text(
            "3:228",
            isRu()
                ? ("Сервер: " + syncIp + ":8865")
                : ("Server: " + syncIp + ":8865"));
        scene.bounds("3:228", 76, 421, 270, 24);
        scene.text("3:229", isRu() ? "Wi-Fi · автопоиск" : "Wi-Fi · auto-discover");
        scene.bounds("3:229", 76, 444, 252, 18);
        scene.text("3:231", isRu() ? "Синхронизация" : "Sync");
        scene.bounds("3:231", 88, 481, 140, 18);
        long b = 0;
        for (Track tr : app.tracks) b += tr.bytes;
        scene.text(
            "3:233",
            String.format(Locale.ROOT, "%.1f " + (isRu() ? "ГБ" : "GB"), b / 1e9));
        scene.bounds("3:233", 24, 584, 135, 40);
        scene.text("3:234", isRu() ? "на телефоне" : "on phone");
        scene.bounds("3:234", 165, 592, 190, 24);
        scene.text(
            "3:238",
            isRu()
                ? "Оригиналы хранятся на телефоне. Синхронизируйте библиотеку и статистику с Windows."
                : "Audio stored on phone. Sync library and listening stats with Windows companion.");
        scene.bounds("3:238", 24, 647, 342, 50);
        break;
      case 6:
        if (isRu()) {
          scene.text("22:7", "НАСТРОЙКИ");
          scene.bounds("22:7", 58, 62, 280, 24);
          scene.text("22:8", "Настройка плеера.");
          scene.bounds("22:8", 58, 88, 300, 36);
          scene.text("22:9", "Простота сверху. Глубина внутри.");
          scene.bounds("22:9", 58, 130, 310, 24);
          scene.text("22:11", "ВОСПРОИЗВЕДЕНИЕ");
          scene.bounds("22:11", 42, 198, 280, 20);
          scene.text("22:12", "Ощущение");
          scene.bounds("22:12", 42, 222, 280, 28);
          scene.text("22:13", "Точный контроль без изменения файлов.");
          scene.bounds("22:13", 42, 251, 310, 24);
          scene.text("22:15", "Бесшовный звук");
          scene.bounds("22:15", 42, 299, 250, 20);
          scene.text("22:16", "Плавный переход между треками альбома");
          scene.bounds("22:16", 42, 319, 270, 20);
          scene.text("22:19", "Кроссфейд");
          scene.bounds("22:19", 42, 350, 220, 20);
          scene.text("22:20", "Скоро");
          scene.bounds("22:20", 270, 350, 90, 24);
          scene.text("22:24", "");
          scene.text("22:25", "в планах");
          scene.bounds("22:25", 270, 391, 80, 16);
          scene.text("22:26", "ReplayGain");
          scene.bounds("22:26", 42, 413, 220, 20);
          scene.text("22:27", "Скоро. Выравнивание громкости");
          scene.bounds("22:27", 42, 433, 270, 20);
          scene.text("22:31", "БИБЛИОТЕКА И ТЕГИ");
          scene.bounds("22:31", 42, 494, 280, 20);
          scene.text("22:32", app.tracks.size() + " треков · теги в приоритете");
          scene.bounds("22:32", 42, 511, 270, 20);
          scene.text("22:35", "ВНЕШНИЙ ВИД И ЯЗЫК");
          scene.bounds("22:35", 42, 562, 280, 20);
          scene.text(
              "22:36",
              themeName()
                  + ", рельеф "
                  + app.prefs.getInt("depth", 72)
                  + "%");
          scene.bounds("22:36", 42, 579, 285, 20);
          scene.text("22:39", "ТЕКСТЫ ПЕСЕН");
          scene.bounds("22:39", 42, 630, 280, 20);
          scene.text("22:40", "Ваш текст и LRC на устройстве");
          scene.bounds("22:40", 42, 647, 270, 20);
          scene.text("22:43", "УСТРОЙСТВА И СИНХРОНИЗАЦИЯ");
          scene.bounds("22:43", 42, 698, 280, 20);
          scene.text("22:44", "Linux / Windows · скоро");
          scene.bounds("22:44", 42, 715, 285, 20);
          scene.text("22:46", "ДОПОЛНИТЕЛЬНО");
          scene.bounds("22:46", 24, 760, 280, 20);
          scene.text("22:47", "Звук, история и экспорт данных");
          scene.bounds("22:47", 24, 779, 320, 20);
        } else {
          scene.text("22:7", "SETTINGS");
          scene.bounds("22:7", 58, 62, 280, 24);
          scene.text("22:8", "Tune the machine.");
          scene.bounds("22:8", 58, 88, 300, 36);
          scene.text("22:9", "Simple on top. Deep when you want it.");
          scene.bounds("22:9", 58, 130, 310, 24);
          scene.text("22:11", "PLAYBACK");
          scene.bounds("22:11", 42, 198, 280, 20);
          scene.text("22:12", "Feel");
          scene.bounds("22:12", 42, 222, 280, 28);
          scene.text("22:13", "Fine control without touching the file.");
          scene.bounds("22:13", 42, 251, 310, 24);
          scene.text("22:15", "Gapless playback");
          scene.bounds("22:15", 42, 299, 250, 20);
          scene.text("22:16", "Seamless album transitions");
          scene.bounds("22:16", 42, 319, 270, 20);
          scene.text("22:19", "Кроссфейд");
          scene.bounds("22:19", 42, 350, 220, 20);
          scene.text("22:20", "Off · later");
          scene.bounds("22:20", 280, 350, 76, 24);
          scene.text("22:24", "");
          scene.text("22:25", "planned");
          scene.bounds("22:25", 294, 391, 59, 16);
          scene.text("22:26", "ReplayGain");
          scene.bounds("22:26", 42, 413, 220, 20);
          scene.text("22:27", "Planned · original volume");
          scene.bounds("22:27", 42, 433, 270, 20);
          scene.text("22:31", "LIBRARY & TAGS");
          scene.bounds("22:31", 42, 494, 280, 20);
          scene.text("22:32", app.tracks.size() + " tracks · tags first");
          scene.bounds("22:32", 42, 511, 270, 20);
          scene.text("22:35", "APPEARANCE & LANGUAGE");
          scene.bounds("22:35", 42, 562, 280, 20);
          scene.text(
              "22:36",
              app.prefs.getString("theme", "paper")
                  + " · Language: English · depth "
                  + app.prefs.getInt("depth", 72)
                  + "%");
          scene.bounds("22:36", 42, 579, 285, 20);
          scene.text("22:39", "LYRICS & KARAOKE");
          scene.bounds("22:39", 42, 630, 280, 20);
          scene.text("22:40", "Your text / .LRC · local only");
          scene.bounds("22:40", 42, 647, 270, 20);
          scene.text("22:43", "DEVICES & SYNC");
          scene.bounds("22:43", 42, 698, 280, 20);
          scene.text("22:44", "Linux / Windows · next milestone");
          scene.bounds("22:44", 42, 715, 285, 20);
          scene.text("22:46", "ADVANCED");
          scene.bounds("22:46", 24, 760, 280, 20);
          scene.text("22:47", "Decoder · cache · audio output · history");
          scene.bounds("22:47", 24, 779, 320, 20);
        }
        TextView on = label(isRu()?"Вкл.":"Включено", 12);
        if (scene.findViewWithTag("gapless") == null) {
          on.setTag("gapless");
          scene.put(on, 313, 302, 40, 26);
        }
        break;
      case 7:
        scene.text("22:55", title);
        scene.bounds("22:55", 58, 84, 308, 38);
        scene.size("22:55", title.length() > 23 ? 22 : 28);
        scene.text("22:56", artist);
        scene.bounds("22:56", 58, 120, 155, 20);
        scene.text("22:57", "Текст и LRC");
        scene.bounds("22:57", 232, 124, 130, 18);
        break;
    }
  }

  private static String percent(long n, long total) {
    return total <= 0 ? "—" : Math.round(n * 100d / total) + "%";
  }

  private static String format(Track t) {
    String m = t.mime.toUpperCase(Locale.ROOT);
    return m.contains("FLAC")
        ? "FLAC"
        : m.contains("MPEG")
            ? "MP3"
            : m.contains("OGG") ? "OGG" : m.contains("MP4") ? "M4A" : "AUDIO";
  }

  private Track current() {
    if (player == null || player.getCurrentMediaItem() == null) return null;
    return app.track(player.getCurrentMediaItem().mediaId);
  }

  private void openLibrary() {
    group = "";
    show(2, true);
    if (app.tracks.isEmpty()) scanOptions();
  }

  private void play(List<Track> tracks, int index) {
    if (player == null) {
      toast("Плеер подключается…");
      return;
    }
    if (tracks.isEmpty()) return;
    List<MediaItem> items = new ArrayList<>();
    for (Track t : tracks) items.add(t.mediaItem());
    player.setMediaItems(items, index, 0);
    player.prepare();
    player.play();
    bind();
  }

  private void toggle() {
    if (player == null) return;
    if (player.getCurrentMediaItem() == null) {
      if (!app.tracks.isEmpty()) play(app.tracks, 0);
      else openLibrary();
      return;
    }
    if (player.isPlaying()) player.pause();
    else {
      if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
      player.prepare();
      player.play();
    }
  }

  private void toggleIfPaused() {
    if (player != null && !player.isPlaying()) toggle();
  }

  private void previous() {
    if (player != null) {
      if (player.getCurrentPosition() > 3000) player.seekTo(0);
      else player.seekToPreviousMediaItem();
    }
  }

  private void next() {
    if (player != null && player.hasNextMediaItem()) player.seekToNextMediaItem();
    else toast("Конец очереди");
  }

  private void toggleRepeat() {
    if (player == null) return;
    int cur = player.getRepeatMode();
    int next = cur == Player.REPEAT_MODE_ONE ? Player.REPEAT_MODE_OFF : Player.REPEAT_MODE_ONE;
    player.setRepeatMode(next);
    if (repeatView != null) {
      repeatView.active = next == Player.REPEAT_MODE_ONE;
      repeatView.invalidate();
    }
    toast(next == Player.REPEAT_MODE_ONE ? (isRu() ? "Повтор трека включён" : "Repeat one on") : (isRu() ? "Повтор выключен" : "Repeat off"));
  }

  private void toggleFavoriteCurrent() {
    Track t = current();
    if (t == null) {
      toast(isRu() ? "Выберите трек для избранного" : "Select a track to add to favorites");
      return;
    }
    favorite(t);
    if (heartView != null) {
      heartView.active = t.favorite;
      heartView.invalidate();
    }
  }

  private void seek(double fraction) {
    if (player != null && player.getDuration() > 0)
      player.seekTo((long) (player.getDuration() * fraction));
  }

  private static String time(long ms) {
    if (ms < 0) return "00:00";
    return String.format(Locale.ROOT, "%02d:%02d", ms / 60000, ms / 1000 % 60);
  }

  private void updatePlayback() {
    if (scene == null) return;
    boolean active = player != null && player.isPlaying();
    for (InstrumentView p : plays) {
      if (p.playing != active) {
        p.setPlaying(active);
      }
      p.setContentDescription(active ? "Пауза" : "Воспроизвести");
    }
    long pos = player == null ? 0 : player.getCurrentPosition(),
        duration = player == null ? 0 : player.getDuration();
    float progress = duration > 0 ? (float) pos / duration : 0;
    for (InstrumentView v : progressViews)
      v.playback(
          progress,
          duration,
          active,
          app.prefs.getBoolean("motion", true) && resumed,
          player == null ? 1 : player.getPlaybackParameters().speed);
    if (dial != null)
      dial.playback(
          progress,
          duration,
          active,
          app.prefs.getBoolean("discMotion", true)
              && app.prefs.getBoolean("motion", true)
              && resumed,
          player == null ? 1 : player.getPlaybackParameters().speed);
    if (page == 1) {
      scene.text("3:70", time(pos));
      scene.text("3:71", time(duration));
      scene.text("3:81", (isRu()?"Очередь: ":"Queue: ") + (player == null ? 0 : player.getMediaItemCount()));
      scene.bounds("3:81", 24, 770, 190, 22);
    }
    if (page == 7) {
      scene.text("22:88", time(pos));
      scene.text("22:89", time(duration));
    }
  }

  private TextView label(String text, float size) {
    TextView t = new TextView(this);
    t.setText(text);
    t.setTextColor(ink());
    t.setTextSize(
        TypedValue.COMPLEX_UNIT_PX,
        (scale > 0 ? scale : getResources().getDisplayMetrics().density) * size);
    t.setTypeface(DesignScene.font(this));
    t.setIncludeFontPadding(false);
    return t;
  }

  private void toast(String msg) {
    Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
  }

  private void info(String title, String text) {
    new AlertDialog.Builder(this)
        .setTitle(title)
        .setMessage(text)
        .setPositiveButton("OK", null)
        .show();
  }

  private DesignScene summary;
  private TextView libraryStatus;
  private List<Entry> entries = List.of();
  private List<Track> visibleTracks = List.of();

  private static final class Entry {
    String title, subtitle, meta, key;
    List<Track> tracks;
    boolean leaf;
    long playlist = -1;

    Entry(
        String title, String subtitle, String meta, String key, List<Track> tracks, boolean leaf) {
      this.title = title;
      this.subtitle = subtitle;
      this.meta = meta;
      this.key = key;
      this.tracks = tracks;
      this.leaf = leaf;
    }
  }

  private void buildLibrary() {
    scene = new DesignScene(this, 2, scale, 40, 140, Set.of("12:13","12:14"));
    body.addView(scene, new LinearLayout.LayoutParams(-1, sx(100)));
    scene.action("Сортировка", 269, 70, 104, 50, this::sortDialog);
    IconView searchIcon = new IconView(this,"search",ink());
    searchIcon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    scene.put(searchIcon,222,68,48,48);
    scene.action("Поиск", 222, 68, 48, 48, this::searchDialog);
    scene.action("Раздел библиотеки", 20, 83, 192, 49, this::modeDialog);
    LinearLayout bar = new LinearLayout(this);
    bar.setPadding(sx(24), 0, sx(24), sx(8));
    bar.setGravity(Gravity.CENTER_VERTICAL);
    String modeText =
        group.isEmpty()
            ? (isRu() ? "Разделы библиотеки" : "Albums · Tracks · More")
            : (isRu() ? "‹  Все " : "‹  All ") + libraryMode;
    TextView modes = label(modeText, 12);
    modes.setPadding(0, sx(9), 0, sx(9));
    modes.setOnClickListener(
        v -> {
          if (group.isEmpty()) modeDialog();
          else {
            group = "";
            rebuildLibrary();
            bind();
          }
        });
    MicroMotion.press(modes,modes,.985f);
    bar.addView(modes, new LinearLayout.LayoutParams(0, sx(40), 1));
    TextView add = label(isRu() ? "Добавить музыку" : "Add music", 12);
    add.setPadding(sx(8), sx(9), 0, sx(9));
    add.setOnClickListener(v -> scanOptions());
    MicroMotion.press(add,add,.985f);
    bar.addView(add);
    body.addView(bar);
    FrameLayout frame = new FrameLayout(this);
    libraryList = new ListView(this);
    libraryList.setDivider(null);
    libraryList.setClipToPadding(false);
    libraryList.setPadding(sx(24), 0, sx(24), sx(8));
    libraryList.setVerticalScrollBarEnabled(false);
    adapter = new LibraryAdapter();
    libraryList.setAdapter(adapter);
    frame.addView(libraryList, new FrameLayout.LayoutParams(-1, -1));
    libraryStatus = label("", 16);
    libraryStatus.setGravity(Gravity.CENTER);
    libraryStatus.setPadding(sx(28), sx(16), sx(28), sx(16));
    frame.addView(libraryStatus, new FrameLayout.LayoutParams(-1, -1));
    libraryList.setEmptyView(libraryStatus);
    body.addView(frame, new LinearLayout.LayoutParams(-1, 0, 1));
    libraryList.setOnItemClickListener(
        (p, v, pos, id) -> {
          Entry e = entries.get(pos);
          if (e.leaf) {
            play(visibleTracks, visibleTracks.indexOf(e.tracks.get(0)));
          } else {
            group = e.key;
            libraryTitle = e.title;
            rebuildLibrary();
            bind();
          }
        });
    libraryList.setOnItemLongClickListener(
        (p, v, pos, id) -> {
          entryMenu(entries.get(pos));
          return true;
        });
    summary = new DesignScene(this, 2, scale, 602, 704, Set.of());
    body.addView(summary, new LinearLayout.LayoutParams(-1, sx(102)));
    summary.action("Сканирование и папки", 24, 612, 342, 78, this::scanOptions);
    lastTracks = app.tracks;
    rebuildLibrary();
  }

  private static final String EN_KB = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./~@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:\"ZXCVBNM<>?";
  private static final String RU_KB = "ё1234567890-=йцукенгшщзхъ\\фывапролджэячсмитьбю.Ё\"№;%:?*()_+ЙЦУКЕНГШЩЗХЪ/ФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";

  private static String switchLayout(String s) {
    if (s == null) return "";
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      int idxEn = EN_KB.indexOf(c);
      if (idxEn >= 0 && idxEn < RU_KB.length()) {
        sb.append(RU_KB.charAt(idxEn));
        continue;
      }
      int idxRu = RU_KB.indexOf(c);
      if (idxRu >= 0 && idxRu < EN_KB.length()) {
        sb.append(EN_KB.charAt(idxRu));
        continue;
      }
      sb.append(c);
    }
    return sb.toString();
  }

  private static String normalizeQuery(String s) {
    if (s == null) return "";
    return s.toLowerCase(Locale.ROOT)
        .replace('ё', 'е')
        .replaceAll("[\\p{Punct}\\s]+", " ")
        .trim();
  }

  private static int matchScore(Track t, String query) {
    if (query == null || query.isBlank()) return 0;
    String qNorm = normalizeQuery(query);
    String qAlt = normalizeQuery(switchLayout(query));
    String titleNorm = normalizeQuery(t.title);
    String artistNorm = normalizeQuery(t.artist);
    String albumNorm = normalizeQuery(t.album);
    String folderNorm = normalizeQuery(t.folder);
    String fullNorm = titleNorm + " " + artistNorm + " " + albumNorm + " " + folderNorm;

    String[] tokens = qNorm.split(" ");
    String[] altTokens = qAlt.split(" ");
    boolean allMatched = true;
    for (int i = 0; i < tokens.length; i++) {
      String tok = tokens[i];
      String altTok = i < altTokens.length ? altTokens[i] : "";
      boolean hit = (!tok.isEmpty() && fullNorm.contains(tok))
                 || (!altTok.isEmpty() && fullNorm.contains(altTok));
      if (!hit) {
        allMatched = false;
        break;
      }
    }
    if (!allMatched) return -1;

    int score = 10;
    if (titleNorm.equals(qNorm) || titleNorm.equals(qAlt)) score += 120;
    else if (titleNorm.startsWith(qNorm) || titleNorm.startsWith(qAlt)) score += 70;
    else if (titleNorm.contains(qNorm) || titleNorm.contains(qAlt)) score += 40;

    if (artistNorm.equals(qNorm) || artistNorm.equals(qAlt)) score += 50;
    else if (artistNorm.startsWith(qNorm) || artistNorm.startsWith(qAlt)) score += 30;
    else if (artistNorm.contains(qNorm) || artistNorm.contains(qAlt)) score += 20;

    if (albumNorm.contains(qNorm) || albumNorm.contains(qAlt)) score += 10;
    return score;
  }

  private void rebuildLibrary() {
    if (page != 2 || adapter == null) return;
    int generation = ++libraryGeneration;
    String mode = libraryMode, filter = group, ordering = sort;
    List<Track> all = app.tracks;
    boolean hasSearch = !search.trim().isEmpty();
    libraryStatus.setText(
        app.scanning
            ? (isRu() ? "Сканирование музыки…" : "Scanning your music…")
            : (isRu()
                ? "В библиотеке пока нет музыки"
                : "В библиотеке пока нет музыки"));
    app.io.execute(
        () -> {
          List<Track> selected = new ArrayList<>();
          Map<Long, String> playlists = app.repo.playlists();
          Set<String> playlistTracks =
              mode.equals("Playlists") && !filter.isEmpty()
                  ? new HashSet<>(app.repo.playlist(Long.parseLong(filter)))
                  : Set.of();
          for (Track t : all) {
            if (hasSearch && matchScore(t, search) < 0) continue;
            if (mode.equals("Favorites") && !t.favorite) continue;
            if (!filter.isEmpty()
                && !(mode.equals("Albums") && t.albumKey().equals(filter)
                    || mode.equals("Artists") && t.artist.equals(filter)
                    || mode.equals("Folders") && t.folder.equals(filter)
                    || mode.equals("Playlists") && playlistTracks.contains(t.id))) continue;
            selected.add(t);
          }
          if (hasSearch) {
            selected.sort(
                Comparator.comparingInt((Track t) -> matchScore(t, search))
                    .reversed()
                    .thenComparing(t -> t.title, String.CASE_INSENSITIVE_ORDER));
          } else {
            Comparator<Track> comparator =
                switch (ordering) {
                  case "Artist" ->
                      Comparator.comparing((Track t) -> t.artist, String.CASE_INSENSITIVE_ORDER)
                          .thenComparing(t -> t.album)
                          .thenComparingInt(t -> t.number);
                  case "Recently added" -> Comparator.comparingLong((Track t) -> t.added).reversed();
                  case "Most played" ->
                      Comparator.comparingLong((Track t) -> app.stats.counts.getOrDefault(t.id, 0L))
                          .reversed();
                  case "Least played" ->
                      Comparator.comparingLong(t -> app.stats.counts.getOrDefault(t.id, 0L));
                  case "Duration" -> Comparator.comparingLong((Track t) -> t.duration).reversed();
                  default -> Comparator.comparing(t -> t.title, String.CASE_INSENSITIVE_ORDER);
                };
            selected.sort(comparator.thenComparing(t -> t.id));
            if (!filter.isEmpty() && mode.equals("Albums") && ordering.equals("Title"))
              selected.sort(Comparator.comparingInt(t -> t.number));
          }
          List<Entry> result = new ArrayList<>();
          boolean leaf = !filter.isEmpty() || mode.equals("Tracks") || mode.equals("Favorites") || hasSearch;
          if (leaf)
            for (Track t : selected)
              result.add(
                  new Entry(
                      t.title,
                      t.artist,
                      time(t.duration) + " · " + format(t) + (t.favorite ? " · ♥" : ""),
                      t.id,
                      List.of(t),
                      true));
          else if (mode.equals("Playlists")) {
            for (var e : playlists.entrySet()) {
              Set<String> ids = new HashSet<>(app.repo.playlist(e.getKey()));
              List<Track> ts = new ArrayList<>();
              for (Track t : all) if (ids.contains(t.id)) ts.add(t);
              Entry entry =
                  new Entry(
                      e.getValue(),
                      "Плейлист",
                      ts.size() + " треков",
                      "" + e.getKey(),
                      ts,
                      false);
              entry.playlist = e.getKey();
              result.add(entry);
            }
          } else {
            Map<String, List<Track>> groups = new LinkedHashMap<>();
            for (Track t : selected) {
              String k =
                  mode.equals("Albums")
                      ? t.albumKey()
                      : mode.equals("Artists") ? t.artist : t.folder;
              groups.computeIfAbsent(k, key -> new ArrayList<>()).add(t);
            }
            for (var e : groups.entrySet()) {
              List<Track> ts = e.getValue();
              Track t = ts.get(0);
              long duration = 0;
              for (Track tr : ts) duration += tr.duration;
              String name = mode.equals("Albums") ? t.album : e.getKey();
              result.add(
                  new Entry(
                      name,
                      mode.equals("Albums") ? t.artist : "Коллекция",
                      ts.size() + " треков, " + duration / 60000 + " мин",
                      e.getKey(),
                      ts,
                      false));
            }
          }
          app.main.post(
              () -> {
                if (generation != libraryGeneration || page != 2 || libraryList == null) return;
                entries = result;
                visibleTracks = selected;
                adapter.notifyDataSetChanged();
                libraryStatus.setText(
                    app.scanning
                        ? (isRu() ? "Сканирование…" : "Сканирование…")
                        : !search.isEmpty()
                            ? (isRu() ? "Ничего не найдено\nИзмените запрос поиска" : "No results\nChange search query")
                            : mode.equals("Playlists")
                                ? (isRu() ? "Плейлистов пока нет. Создайте их в разделах библиотеки." : "No playlists yet\nTap section title → New playlist")
                                : (isRu()
                                    ? "В библиотеке пока нет музыки"
                                    : "Your library is empty"));
                if (!group.isEmpty()) {
                  String name =
                      mode.equals("Albums") && selected.size() > 0
                          ? selected.get(0).album
                          : mode.equals("Playlists")
                              ? playlists.getOrDefault(Long.parseLong(group), "Playlist")
                              : group;
                  scene.text("3:88", name);
                  scene.size("3:88", name.length() > 15 ? 24 : 34);
                } else scene.text("3:88", localizedLibraryMode());
              });
        });
  }

  private final class LibraryAdapter extends BaseAdapter {
    public int getCount() {
      return entries.size();
    }

    public Object getItem(int p) {
      return entries.get(p);
    }

    public long getItemId(int p) {
      return entries.get(p).key.hashCode();
    }

    public View getView(int pos, View recycled, android.view.ViewGroup parent) {
      LinearLayout row;
      if (recycled instanceof LinearLayout) row = (LinearLayout) recycled;
      else {
        row = new LinearLayout(MainActivity.this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setDescendantFocusability(android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS);
        row.setPadding(0, 0, 0, sx(20));
        row.setLayoutParams(new AbsListView.LayoutParams(-1, -2));
        row.setMinimumHeight(sx(96));
        ImageView cover = new ImageView(MainActivity.this);
        cover.setId(R.id.track_cover);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        row.addView(cover, new LinearLayout.LayoutParams(sx(84), sx(84)));
        LinearLayout text = new LinearLayout(MainActivity.this);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(sx(18), 0, 0, 0);
        row.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
        TextView title = label("", 17);
        title.setId(R.id.track_title);
        title.setMaxLines(3);
        title.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(title);
        TextView artist = label("", 12);
        artist.setId(R.id.track_artist);
        artist.setMaxLines(2);
        artist.setEllipsize(TextUtils.TruncateAt.END);
        artist.setPadding(0, sx(6), 0, 0);
        text.addView(artist);
        TextView meta = label("", 11);
        meta.setId(R.id.track_meta);
        meta.setAlpha(.6f);
        meta.setPadding(0, sx(7), 0, 0);
        text.addView(meta);
        TextView more = label("⋯", 23);
        more.setId(R.id.track_more);
        more.setGravity(Gravity.CENTER);
        more.setContentDescription("Действия");
        row.addView(more, new LinearLayout.LayoutParams(Math.max(dp(48),sx(40)), sx(60)));
        MicroMotion.press(row,row,.992f);
        MicroMotion.press(more,more,.96f);
      }
      MicroMotion.reset(row);
      MicroMotion.reset(row.findViewById(R.id.track_more));
      Entry e = entries.get(pos);
      row.setOnClickListener(
          v -> {
            if (e.leaf) play(visibleTracks, visibleTracks.indexOf(e.tracks.get(0)));
            else {
              group = e.key;
              libraryTitle = e.title;
              rebuildLibrary();
              bind();
            }
          });
      row.setOnLongClickListener(
          v -> {
            entryMenu(e);
            return true;
          });
      row.setContentDescription(e.title + ", " + e.subtitle + ", " + e.meta);
      ((TextView) row.findViewById(R.id.track_title)).setText(e.title);
      ((TextView) row.findViewById(R.id.track_artist)).setText(e.subtitle);
      ((TextView) row.findViewById(R.id.track_meta)).setText(e.meta);
      row.findViewById(R.id.track_more).setOnClickListener(v -> entryMenu(e));
      ImageView image = row.findViewById(R.id.track_cover);
      
      image.setBackground(rounded(paper(), 12));
      Art.load(MainActivity.this, image, e.tracks.isEmpty()?null:e.tracks.get(0));
      return row;
    }
  }

  private android.graphics.drawable.Drawable rounded(int color, int radius) {
    GradientDrawable g = new GradientDrawable();
    g.setColor(color);
    g.setCornerRadius(sx(radius));
    g.setStroke(
        Math.max(1, sx(.5f)),
        app.prefs.getString("theme", "paper").equals("dark") ? 0xff484842 : 0xfffaf9f6);
    return g;
  }

  private void modeDialog() {
    String[] modes = {
      "Albums", "Tracks", "Artists", "Folders", "Favorites", "Playlists", "＋ New playlist"
    };
    String[] titles =
        isRu()
            ? new String[] {
              "Альбомы", "Треки", "Исполнители", "Папки", "Избранное", "Плейлисты", "＋ Новый плейлист"
            }
            : modes;
    new AlertDialog.Builder(this)
        .setTitle(isRu() ? "Раздел библиотеки" : "Library")
        .setItems(
            titles,
            (d, i) -> {
              if (i == 6) {
                createPlaylist(null);
                return;
              }
              libraryMode = modes[i];
              group = "";
              show(2, true);
            })
        .show();
  }

  private void sortDialog() {
    String[] options = {
      "Title", "Artist", "Recently added", "Most played", "Least played", "Duration"
    };
    String[] titles =
        isRu()
            ? new String[] {
              "Название",
              "Исполнитель",
              "Недавно добавленные",
              "Часто воспроизводимые",
              "Редко воспроизводимые",
              "Длительность"
            }
            : options;
    new AlertDialog.Builder(this)
        .setTitle(isRu() ? "Сортировка" : "Sort library")
        .setSingleChoiceItems(
            titles,
            Arrays.asList(options).indexOf(sort),
            (d, i) -> {
              sort = options[i];
              rebuildLibrary();
              d.dismiss();
            })
        .show();
  }

  private void searchDialog() {
    EditText input =
        input(
            isRu() ? "Песня, исполнитель, альбом, папка" : "Song, artist, album, folder",
            search);
    new AlertDialog.Builder(this)
        .setTitle(isRu() ? "Поиск по библиотеке" : "Search library")
        .setView(input)
        .setPositiveButton(
            isRu() ? "Найти" : "Search",
            (d, w) -> {
              search = input.getText().toString().trim();
              rebuildLibrary();
            })
        .setNeutralButton(
            isRu() ? "Сбросить" : "Reset",
            (d, w) -> {
              search = "";
              rebuildLibrary();
            })
        .setNegativeButton(isRu() ? "Отмена" : "Cancel", null)
        .show();
  }

  private void entryMenu(Entry e) {
    List<String> options =
        new ArrayList<>(List.of("Воспроизвести", "Воспроизвести следующим", "Добавить в очередь", "Smart queue"));
    if (e.leaf) options.add(e.tracks.get(0).favorite ? "Убрать из избранного" : "В избранное");
    options.add("Добавить в плейлист");
    if (e.leaf) {
      options.add("Текст и караоке");
      options.add("File details");
      if (libraryMode.equals("Playlists") && !group.isEmpty()) options.add("Убрать из плейлиста");
    }
    if (e.playlist >= 0) options.add("Удалить плейлист");
    new AlertDialog.Builder(this)
        .setTitle(e.title)
        .setItems(
            options.toArray(new String[0]),
            (d, i) -> {
              String action = options.get(i);
              switch (action) {
                case "Воспроизвести":
                  play(e.tracks, 0);
                  break;
                case "Воспроизвести следующим":
                  enqueue(e.tracks, true);
                  break;
                case "Добавить в очередь":
                  enqueue(e.tracks, false);
                  break;
                case "Smart queue":
                  play(app.smartQueue(e.tracks, ""), 0);
                  break;
                case "В избранное":
                case "Убрать из избранного":
                  favorite(e.tracks.get(0));
                  break;
                case "Добавить в плейлист":
                  choosePlaylist(e.tracks);
                  break;
                case "Текст и караоке":
                  play(e.tracks, 0);
                  show(7, true);
                  break;
                case "File details":
                  Track t = e.tracks.get(0);
                  info(
                      t.title,
                      t.artist
                          + "\n"
                          + t.album
                          + "\n"
                          + format(t)
                          + " · "
                          + time(t.duration)
                          + "\n"
                          + String.format(Locale.ROOT, "%.2f MB", t.bytes / 1e6)
                          + "\n"
                          + t.folder
                          + "\n\n"
                          + t.uri);
                  break;
                case "Убрать из плейлиста":
                  long list = Long.parseLong(group);
                  app.io.execute(
                      () -> {
                        app.repo.removeFromPlaylist(list, e.tracks.get(0).id);
                        app.main.post(this::rebuildLibrary);
                      });
                  break;
                case "Удалить плейлист":
                  new AlertDialog.Builder(this)
                      .setTitle("Удалить плейлист?")
                      .setMessage("Аудиофайлы останутся на устройстве.")
                      .setPositiveButton(
                          "Удалить",
                          (dd, w) ->
                              app.io.execute(
                                  () -> {
                                    app.repo.deletePlaylist(e.playlist);
                                    app.main.post(this::rebuildLibrary);
                                  }))
                      .setNegativeButton("Отмена", null)
                      .show();
                  break;
              }
            })
        .show();
  }

  private void favorite(Track t) {
    boolean value = !t.favorite;
    t.favorite = value;
    app.io.execute(() -> app.repo.favorite(t.id, value));
    toast(value ? "В избранном" : "Удалено из избранного");
    if (page == 2) rebuildLibrary();
  }

  private void enqueue(List<Track> tracks, boolean next) {
    if (player == null) return;
    List<MediaItem> items = new ArrayList<>();
    for (Track t : tracks) items.add(t.mediaItem());
    if (next && player.getMediaItemCount() > 0)
      player.addMediaItems(player.getCurrentMediaItemIndex() + 1, items);
    else player.addMediaItems(items);
    toast("Добавлено в очередь: " + items.size());
  }

  private void createPlaylist(List<Track> add) {
    EditText input = input("Название", "");
    AlertDialog d =
        new AlertDialog.Builder(this)
            .setTitle("Новый плейлист")
            .setView(input)
            .setPositiveButton("Создать", null)
            .setNegativeButton("Отмена", null)
            .create();
    d.setOnShowListener(
        v ->
            d.getButton(-1)
                .setOnClickListener(
                    b -> {
                      String name = input.getText().toString().trim();
                      if (name.isEmpty()) {
                        input.setError("Введите название");
                        return;
                      }
                      app.io.execute(
                          () -> {
                            long id = app.repo.createPlaylist(name);
                            if (add != null) for (Track t : add) app.repo.addToPlaylist(id, t.id);
                            app.main.post(
                                () -> {
                                  toast("Плейлист сохранён");
                                  if (page == 2) rebuildLibrary();
                                });
                          });
                      d.dismiss();
                    }));
    d.show();
  }

  private void choosePlaylist(List<Track> tracks) {
    app.io.execute(
        () -> {
          Map<Long, String> lists = app.repo.playlists();
          app.main.post(
              () -> {
                List<Long> ids = new ArrayList<>(lists.keySet());
                List<String> names = new ArrayList<>(lists.values());
                names.add("＋ New playlist");
                new AlertDialog.Builder(this)
                    .setTitle("Добавить в плейлист")
                    .setItems(
                        names.toArray(new String[0]),
                        (d, i) -> {
                          if (i == ids.size()) {
                            createPlaylist(tracks);
                            return;
                          }
                          app.io.execute(
                              () -> {
                                for (Track t : tracks) app.repo.addToPlaylist(ids.get(i), t.id);
                                app.main.post(() -> toast("Добавлено в плейлист"));
                              });
                        })
                    .show();
              });
        });
  }

  private EditText input(String hint, String value) {
    EditText e = new EditText(this);
    e.setText(value);
    e.setHint(hint);
    e.setPadding(dp(24), dp(12), dp(24), dp(12));
    e.setTextColor(ink());
    e.setSelectAllOnFocus(true);
    return e;
  }

  private void queue() {
    if (player == null) return;
    List<String> rows = new ArrayList<>();
    for (int i = 0; i < player.getMediaItemCount(); i++) {
      MediaItem item = player.getMediaItemAt(i);
      rows.add(
          (i == player.getCurrentMediaItemIndex() ? "▶  " : "")
              + (i + 1)
              + ". "
              + item.mediaMetadata.title
              + "\n"
              + item.mediaMetadata.artist);
    }
    new AlertDialog.Builder(this)
        .setTitle("Очередь: " + rows.size())
        .setItems(rows.toArray(new String[0]), (d, index) -> queueItem(index))
        .setPositiveButton("Умная сортировка", (d, w) -> smartSortQueue())
        .setNeutralButton("Порядок", (d, w) -> queueModes())
        .setNegativeButton("Закрыть", null)
        .show();
  }

  private void queueItem(int index) {
    if (player == null || index >= player.getMediaItemCount()) return;
    new AlertDialog.Builder(this)
        .setTitle("" + player.getMediaItemAt(index).mediaMetadata.title)
        .setItems(
            new String[] {"Воспроизвести", "Поднять", "Опустить", "Убрать"},
            (d, i) -> {
              if (index >= player.getMediaItemCount()) return;
              switch (i) {
                case 0:
                  player.seekTo(index, 0);
                  player.prepare();
                  player.play();
                  break;
                case 1:
                  if (index > 0) player.moveMediaItem(index, index - 1);
                  break;
                case 2:
                  if (index + 1 < player.getMediaItemCount())
                    player.moveMediaItem(index, index + 1);
                  break;
                case 3:
                  player.removeMediaItem(index);
                  break;
              }
              queue();
            })
        .show();
  }

  private void smartSortQueue() {
    if (player == null) return;
    int current = player.getCurrentMediaItemIndex();
    if (current < 0) return;
    List<Track> upcoming = new ArrayList<>();
    for (int i = current + 1; i < player.getMediaItemCount(); i++) {
      Track t = app.track(player.getMediaItemAt(i).mediaId);
      if (t != null) upcoming.add(t);
    }
    String artist = current() == null ? "" : current().artist;
    upcoming = app.smartQueue(upcoming, artist);
    player.removeMediaItems(current + 1, player.getMediaItemCount());
    enqueue(upcoming, false);
    player.setShuffleModeEnabled(false);
    toast("Реже слушанное выше; исполнители чередуются");
  }

  private void queueModes() {
    if (player == null) return;
    String repeat =
        player.getRepeatMode() == Player.REPEAT_MODE_OFF
            ? "Выключено"
            : player.getRepeatMode() == Player.REPEAT_MODE_ONE ? "Один трек" : "Вся очередь";
    new AlertDialog.Builder(this)
        .setTitle("Порядок воспроизведения")
        .setItems(
            new String[] {
              "Перемешивание: " + (player.getShuffleModeEnabled() ? "Включено" : "Выключено"),
              "Повтор: " + repeat,
              "Очистить следующие треки"
            },
            (d, i) -> {
              if (i == 0) player.setShuffleModeEnabled(!player.getShuffleModeEnabled());
              else if (i == 1) player.setRepeatMode((player.getRepeatMode() + 1) % 3);
              else
                player.removeMediaItems(
                    Math.max(0, player.getCurrentMediaItemIndex() + 1), player.getMediaItemCount());
            })
        .show();
  }

  private void playerMenu() {
    Track t = current();
    String[] names = {
      "Текст и караоке",
      "Очередь",
      t != null && t.favorite ? "Убрать из избранного" : "В избранное",
      "Добавить в плейлист",
      "Таймер сна",
      "Скорость воспроизведения",
      "Эквалайзер",
      "Настройки"
    };
    new AlertDialog.Builder(this)
        .setTitle(t == null ? "Плеер" : t.title)
        .setItems(
            names,
            (d, i) -> {
              switch (i) {
                case 0:
                  show(7, true);
                  break;
                case 1:
                  queue();
                  break;
                case 2:
                  if (t != null) favorite(t);
                  break;
                case 3:
                  if (t != null) choosePlaylist(List.of(t));
                  break;
                case 4:
                  sleepDialog();
                  break;
                case 5:
                  speedDialog();
                  break;
                case 6:
                  equalizer();
                  break;
                case 7:
                  show(6, true);
                  break;
              }
            })
        .show();
  }

  private void sleepDialog() {
    int[] values = {0, 15, 30, 60, 90, -1};
    new AlertDialog.Builder(this)
        .setTitle(
            "Таймер сна"
                + (app.service != null && app.service.sleepDeadline > 0 ? " включён" : ""))
        .setItems(
            new String[] {"Выключено", "15 мин", "30 мин", "60 мин", "90 мин", "В конце трека"},
            (d, i) -> {
              if (app.service != null) {
                app.service.sleep(values[i]);
                toast(i == 0 ? "Таймер выключен" : "Таймер сна установлен");
              }
            })
        .show();
  }

  private void speedDialog() {
    float[] speeds = {.75f, 1f, 1.25f, 1.5f, 2f};
    new AlertDialog.Builder(this)
        .setTitle("Скорость воспроизведения")
        .setItems(
            new String[] {"0.75×", "1×", "1.25×", "1.5×", "2×"},
            (d, i) -> {
              app.prefs.edit().putFloat("speed", speeds[i]).apply();
              if (app.service != null) app.service.applyPreferences();
            })
        .show();
  }

  private void equalizer() {
    if (app.service == null) return;
    Intent intent = new Intent(AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL);
    intent.putExtra(AudioEffect.EXTRA_AUDIO_SESSION, app.service.player.getAudioSessionId());
    intent.putExtra(AudioEffect.EXTRA_PACKAGE_NAME, getPackageName());
    intent.putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC);
    try {
      startActivity(intent);
    } catch (ActivityNotFoundException e) {
      info(
          "Эквалайзер",
          "На этом устройстве нет системной панели эквалайзера. Встроенный эквалайзер запланирован"
              + " в следующей версии.");
    }
  }

  private void scanOptions() {
    String[] options = {
      app.scanning ? "Сканирование…" : "Сканировать устройство",
      "Выбрать аудиофайлы",
      "Минимальная длительность: " + app.prefs.getInt("minimumSeconds", 10) + " сек",
      "Исключённые папки",
      "Только музыка: " + state("musicOnly", true),
      "Автосканирование: " + state("autoScan", true),
      "Playlists"
    };
    new AlertDialog.Builder(this)
        .setTitle("Музыка на устройстве")
        .setMessage(null)
        .setItems(
            options,
            (d, i) -> {
              switch (i) {
                case 0:
                  requestScan();
                  break;
                case 1:
                  Intent pick =
                      new Intent(Intent.ACTION_OPEN_DOCUMENT)
                          .setType("audio/*")
                          .addCategory(Intent.CATEGORY_OPENABLE)
                          .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                  startActivityForResult(pick, AUDIO_FILES);
                  break;
                case 2:
                  int[] seconds = {0, 5, 10, 30, 60};
                  new AlertDialog.Builder(this)
                      .setTitle("Минимальная длительность")
                      .setItems(
                          new String[] {
                            "Все файлы", "5 секунд", "10 секунд", "30 секунд", "60 секунд"
                          },
                          (dd, n) -> {
                            app.prefs.edit().putInt("minimumSeconds", seconds[n]).apply();
                            app.scan();
                          })
                      .show();
                  break;
                case 3:
                  EditText e =
                      input(
                          "Одна папка / часть пути на строку",
                          app.prefs.getString("excludedFolders", ""));
                  e.setMinLines(4);
                  new AlertDialog.Builder(this)
                      .setTitle("Исключённые папки")
                      .setMessage("Например: Ringtones или Recordings. Файлы не удаляются.")
                      .setView(e)
                      .setPositiveButton(
                          "Сохранить",
                          (dd, w) -> {
                            app.prefs
                                .edit()
                                .putString("excludedFolders", e.getText().toString())
                                .apply();
                            app.scan();
                          })
                      .setNegativeButton("Отмена", null)
                      .show();
                  break;
                case 4:
                  flip("musicOnly", true);
                  app.scan();
                  break;
                case 5:
                  flip("autoScan", true);
                  break;
                case 6:
                  libraryMode = "Playlists";
                  group = "";
                  show(2, true);
                  break;
              }
            })
        .setNegativeButton("Закрыть", null)
        .show();
  }

  private void requestScan() {
    if (app.hasPermission()) {
      app.scan();
      return;
    }
    requestPermissions(
        new String[] {
          Build.VERSION.SDK_INT >= 33
              ? Manifest.permission.READ_MEDIA_AUDIO
              : Manifest.permission.READ_EXTERNAL_STORAGE
        },
        100);
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
    super.onRequestPermissionsResult(code, permissions, grants);
    if (code == 100) {
      if (grants.length > 0 && grants[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
        app.scan();
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED)
          requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 101);
      } else
        info(
            "Доступ к музыке",
            "Без разрешения нажмите «Добавить музыку» и выберите аудиофайлы вручную."
                + " Разрешение также доступно в системных настройках приложения.");
    }
  }

  private void flip(String key, boolean defaultValue) {
    app.prefs.edit().putBoolean(key, !app.prefs.getBoolean(key, defaultValue)).apply();
  }

  private void appearance() {
    String[] options = {
      (isRu() ? "Язык интерфейса: " : "Language: ") + (isRu() ? "Русский" : "English"),
      (isRu() ? "Тема: " : "Theme: ") + (isRu()?themeName():app.prefs.getString("theme", "paper")),
      (isRu() ? "Глубина рельефа: " : "Relief depth: ") + app.prefs.getInt("depth", 72) + "%",
      (isRu() ? "Анимации: " : "Motion: ") + state("motion", true),
      (isRu() ? "Вращение диска: " : "Disc motion: ") + state("discMotion", true),
      (isRu() ? "Высокая частота кадров: " : "High refresh rate: ") + state("highRefresh", true),
      (isRu() ? "Тактильный отклик: " : "Haptics: ") + state("haptic", true),
      isRu() ? "Масштаб текста" : "Размер текста",
      isRu() ? "Ваше имя" : "Your name"
    };
    new AlertDialog.Builder(this)
        .setTitle(isRu() ? "Внешний вид и язык" : "Appearance & Language")
        .setItems(
            options,
            (d, i) -> {
              switch (i) {
                case 0:
                  new AlertDialog.Builder(this)
                      .setTitle(isRu() ? "Язык интерфейса" : "Language")
                      .setItems(
                          new String[] {"English (Default)", "Русский"},
                          (dd, n) -> {
                            app.prefs.edit().putString("lang", n == 1 ? "ru" : "en").apply();
                            show(page, false);
                          })
                      .show();
                  break;
                case 1:
                  new AlertDialog.Builder(this)
                      .setTitle("Тема")
                      .setItems(
                          new String[] {"Тёплая бумага", "Туман", "Графит"},
                          (dd, n) -> {
                            app.prefs
                                .edit()
                                .putString("theme", new String[] {"paper", "mist", "dark"}[n])
                                .apply();
                            show(page, false);
                          })
                      .show();
                  break;
                case 2:
                  slider(
                      "Глубина рельефа",
                      0,
                      100,
                      app.prefs.getInt("depth", 72),
                      n -> {
                        app.prefs.edit().putInt("depth", n).apply();
                        show(page, false);
                      });
                  break;
                case 3:
                  flip("motion", true);
                  break;
                case 4:
                  flip("discMotion", true);
                  break;
                case 5:
                  flip("highRefresh", true);
                  WindowManager.LayoutParams p = getWindow().getAttributes();
                  p.preferredDisplayModeId = 0;
                  getWindow().setAttributes(p);
                  requestRefreshRate();
                  break;
                case 6:
                  flip("haptic", true);
                  break;
                case 7:
                  new AlertDialog.Builder(this)
                      .setTitle("Размер текста")
                      .setItems(
                          new String[] {"100%", "110%", "120%"},
                          (dd, n) -> {
                            app.prefs.edit().putFloat("textScale", 1 + n * .1f).apply();
                            show(page, false);
                          })
                      .show();
                  break;
                case 8:
                  EditText input = input("Имя", app.prefs.getString("name", "Ivan"));
                  input.setFilters(new InputFilter[] {new InputFilter.LengthFilter(20)});
                  new AlertDialog.Builder(this)
                      .setTitle(isRu() ? "Ваше имя" : "Your name")
                      .setView(input)
                      .setPositiveButton(
                          "Сохранить",
                          (dd, n) -> {
                            String name = input.getText().toString().trim();
                            app.prefs
                                .edit()
                                .putString("name", name.isEmpty() ? "друг" : name)
                                .apply();
                            bind();
                          })
                      .setNegativeButton("Отмена", null)
                      .show();
                  break;
              }
            })
        .show();
  }

  private void syncOptions() {
    String ip = app.syncServer != null ? app.syncServer.getLocalIp() : "127.0.0.1";
    String[] items = {
      (isRu() ? "Адрес сервера: http://" : "Server URL: http://") + ip + ":8865",
      isRu() ? "Отправить сигнал поиска в сеть (UDP)" : "Broadcast network discovery (UDP)",
      isRu() ? "Экспорт библиотеки в файл" : "Export library to JSON file",
      isRu() ? "Перезапустить сервер синхронизации" : "Restart sync server"
    };
    new AlertDialog.Builder(this)
        .setTitle(isRu() ? "Синхронизация с Windows" : "Windows & Desktop Sync")
        .setItems(
            items,
            (d, i) -> {
              switch (i) {
                case 0:
                  android.content.ClipboardManager cm =
                      (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                  if (cm != null) {
                    cm.setPrimaryClip(
                        android.content.ClipData.newPlainText(
                            "Pain Sync IP", "http://" + ip + ":8865"));
                    toast(isRu() ? "Адрес скопирован в буфер" : "URL copied to clipboard");
                  }
                  break;
                case 1:
                  if (app.syncServer != null) {
                    app.syncServer.broadcastDiscovery();
                    toast(isRu() ? "Сигнал отправлен в сеть" : "Discovery broadcast sent");
                  }
                  break;
                case 2:
                  try {
                    String json = app.repo.exportJson();
                    java.io.File exportFile = new java.io.File(getExternalFilesDir(null), "pain_library_export.json");
                    try (java.io.FileWriter fw = new java.io.FileWriter(exportFile)) {
                      fw.write(json);
                    }
                    toast(isRu() ? ("Экспортировано: " + exportFile.getName()) : ("Exported to " + exportFile.getName()));
                  } catch (Exception e) {
                    toast("Ошибка экспорта: " + e.getMessage());
                  }
                  break;
                case 3:
                  if (app.syncServer != null) {
                    app.syncServer.stop();
                    app.syncServer.start();
                    toast(isRu() ? "Сервер перезапущен" : "Sync server restarted");
                    bind();
                  }
                  break;
              }
            })
        .show();
  }

  private void slider(
      String title, int min, int max, int current, java.util.function.IntConsumer save) {
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(24), dp(18), dp(24), dp(10));
    TextView value = label("" + current, 18);
    box.addView(value);
    SeekBar seek = new SeekBar(this);
    seek.setMax(max - min);
    seek.setProgress(current - min);
    box.addView(seek);
    seek.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onProgressChanged(SeekBar s, int p, boolean u) {
            value.setText("" + (p + min));
          }

          public void onStartTrackingTouch(SeekBar s) {}

          public void onStopTrackingTouch(SeekBar s) {}
        });
    new AlertDialog.Builder(this)
        .setTitle(title)
        .setView(box)
        .setPositiveButton("Сохранить", (d, w) -> save.accept(seek.getProgress() + min))
        .setNegativeButton("Отмена", null)
        .show();
  }

  private void advanced() {
    String[] names = {
      "Скорость воспроизведения",
      "Пропуск тишины: " + state("skipSilence", false),
      "История: " + state("history", true),
      "Таймер сна",
      "Эквалайзер",
      "Экспорт библиотеки и истории",
      "Очистить историю прослушивания",
      "О приложении"
    };
    new AlertDialog.Builder(this)
        .setTitle("Дополнительно")
        .setItems(
            names,
            (d, i) -> {
              switch (i) {
                case 0:
                  speedDialog();
                  break;
                case 1:
                  flip("skipSilence", false);
                  if (app.service != null) app.service.applyPreferences();
                  break;
                case 2:
                  if (app.service != null) app.service.checkpoint();
                  flip("history", true);
                  if (app.service != null) app.service.resetTracking();
                  toast("История: " + state("history", true));
                  break;
                case 3:
                  sleepDialog();
                  break;
                case 4:
                  equalizer();
                  break;
                case 5:
                  Intent save =
                      new Intent(Intent.ACTION_CREATE_DOCUMENT)
                          .setType("application/json")
                          .addCategory(Intent.CATEGORY_OPENABLE)
                          .putExtra(Intent.EXTRA_TITLE, "mono-local-" + LocalDate.now() + ".json");
                  startActivityForResult(save, EXPORT);
                  break;
                case 6:
                  new AlertDialog.Builder(this)
                      .setTitle("Удалить историю прослушивания?")
                      .setMessage(
                          "Музыка, избранное, тексты и плейлисты останутся. Это действие нельзя"
                              + " отменить.")
                      .setPositiveButton(
                          "Удалить",
                          (dd, w) -> {
                            if (app.service != null) app.service.resetTracking();
                            app.io.execute(
                                () -> {
                                  app.repo.clearHistory();
                                  app.refreshStats();
                                });
                          })
                      .setNegativeButton("Отмена", null)
                      .show();
                  break;
                case 7:
                  info(
                      "MONO / LOCAL · 0.1.0",
                      "Локальный музыкальный плеер.\n\n"
                          + "Дизайн перенесён из вашего Figma: Ceramic hi-fi / quiet luxury, Geist,"
                          + " Maple mark.\n\n"
                          + "Воспроизведение: Android Media3. Статистика, очередь, тексты и"
                          + " настройки хранятся на устройстве. Приложение не запрашивает доступ к"
                          + " интернету.\n\n"
                          + "Далее: ваш рекомендатель, Linux / Windows sync, crossfade и"
                          + " ReplayGain.");
                  break;
              }
            })
        .show();
  }

  private void rangeDialog() {
    String[] titles = {"Сегодня", "7 дней", "30 дней", "Этот год", "Всё время"};
    new AlertDialog.Builder(this)
        .setTitle("Statistics range")
        .setItems(
            titles,
            (d, i) -> {
              LocalDate now = LocalDate.now();
              rangeStart =
                  switch (i) {
                    case 0 -> now.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
                    case 1 ->
                        now.minusDays(6)
                            .atStartOfDay(ZoneId.systemDefault())
                            .toInstant()
                            .toEpochMilli();
                    case 2 ->
                        now.minusDays(29)
                            .atStartOfDay(ZoneId.systemDefault())
                            .toInstant()
                            .toEpochMilli();
                    case 3 ->
                        now.withDayOfYear(1)
                            .atStartOfDay(ZoneId.systemDefault())
                            .toInstant()
                            .toEpochMilli();
                    default -> 0;
                  };
              loadDetail();
            })
        .show();
  }

  private void loadDetail() {
    long from = rangeStart;
    app.io.execute(
        () -> {
          Repository.Stats s = app.repo.stats(from);
          app.main.post(
              () -> {
                if (page != 5 || scene == null || from != rangeStart) return;
                detail = s;
                bindDetail(s);
              });
        });
  }

  private final List<View> detailBars = new ArrayList<>();

  private void bindDetail(Repository.Stats s) {
    scene.text("9:80", rangeStart == 0 ? "Всё" : "С");
    scene.text(
        "9:81",
        rangeStart == 0
            ? "время"
            : Instant.ofEpochMilli(rangeStart)
                .atZone(ZoneId.systemDefault())
                .toLocalDate()
                .toString()
                .substring(5));
    scene.text("9:84", "" + (s.heard / 60000));
    scene.bounds("9:84", 40, 224, 83, 34);
    scene.size("9:84", s.heard / 60000 > 9999 ? 19 : 24);
    scene.text("9:88", "" + s.sessionCount);
    scene.text("9:92", "" + s.unique);
    int[] nameIds = {95, 99, 103, 107}, timeIds = {96, 100, 104, 108};
    List<Map.Entry<String, Long>> artists = new ArrayList<>(s.artists.entrySet());
    for (View v : detailBars) scene.removeView(v);
    detailBars.clear();
    for (int i = 0; i < 4; i++) {
      scene.text("9:" + nameIds[i], i < artists.size() ? artists.get(i).getKey() : "—");
      scene.bounds("9:" + nameIds[i], 24, 332 + i * 45, 260, 22);
      scene.text(
          "9:" + timeIds[i],
          i < artists.size() ? Repository.formatTime(artists.get(i).getValue()) : "—");
      scene.bounds("9:" + timeIds[i], 285, 332 + i * 45, 80, 22);
      View bar = new View(this);
      bar.setBackgroundColor(ink());
      float w =
          i < artists.size()
              ? 342f * artists.get(i).getValue() / Math.max(1, artists.get(0).getValue())
              : 0;
      scene.put(bar, 24, 354 + i * 45, w, 3);
      detailBars.add(bar);
    }
    scene.text("9:113", s.peak < 0 ? "—" : String.format(Locale.ROOT, "%02d:00", s.peak));
    scene.text("9:115", Repository.formatTime(s.average));
    scene.bounds("9:115", 151, 566, 95, 32);
    scene.size("9:115", 18);
    scene.text("9:117", Repository.formatTime(s.longest));
    scene.bounds("9:117", 256, 566, 102, 32);
    scene.size("9:117", 18);
    scene.text("9:119", "История и другие метрики");
    scene.bounds("9:119", 24, 670, 320, 20);
    String past = LocalDate.now().minusYears(1).toString();
    long listened = app.stats.days.getOrDefault(past, 0L);
    scene.text("9:121", listened > 0 ? "Год назад" : "Ваша история");
    scene.bounds("9:121", 42, 708, 260, 19);
    scene.text(
        "9:122", listened > 0 ? Repository.formatTime(listened) : "Метрики и дни прослушивания");
    scene.bounds("9:122", 42, 730, 285, 25);
  }

  private void moreStats() {
    Repository.Stats s = detail == null ? app.stats : detail;
    List<String> rows = new ArrayList<>();
    rows.add("Прослушано: " + Repository.formatTime(s.heard));
    rows.add("Уникальных треков: " + s.unique + "; исполнителей: " + s.artists.size());
    rows.add("Прослушиваний: " + s.qualified);
    rows.add("Дослушано: " + s.completed + "; ранних пропусков: " + s.early);
    rows.add("Повторов: " + s.replayed + "; новых треков: " + s.newPlays);
    rows.add("Сессий: " + s.sessionCount + "; в среднем: " + Repository.formatTime(s.average));
    rows.add("Самая длинная сессия: " + Repository.formatTime(s.longest));
    rows.add("Дней подряд: " + s.streak + "; рекорд: " + s.longestStreak);
    rows.add("Изучено в библиотеке: " + percent(s.unique, app.tracks.size()));
    rows.add("Любимые треки");
    s.trackMs.entrySet().stream()
        .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
        .limit(10)
        .forEach(
            e -> {
              Track t = app.track(e.getKey());
              rows.add(
                  (t == null ? "Недоступный трек" : t.title)
                      + " · "
                      + Repository.formatTime(e.getValue()));
            });
    rows.add("Дни прослушивания");
    s.days.entrySet().stream()
        .sorted(Map.Entry.<String, Long>comparingByKey().reversed())
        .limit(31)
        .forEach(e -> rows.add(e.getKey() + " · " + Repository.formatTime(e.getValue())));
    new AlertDialog.Builder(this)
        .setTitle("Ваши привычки")
        .setItems(rows.toArray(new String[0]), null)
        .setPositiveButton(
            "Как это считается",
            (d, w) ->
                info(
                    "Статистика",
                    "Время: только слышимое воспроизведение, без пауз, буферизации и перемотки.\n\n"
                        + "Прослушивание: минимум 30 секунд или половина короткого трека."
                        + " Завершение: услышано не менее 90% длительности.\n\n"
                        + "Сессия: перерыв менее 30 минут. День серии: минимум минута музыки. Пик:"
                        + " час по времени прослушивания.\n\n"
                        + "Новые треки: первые квалифицированные прослушивания. Повтор — отдельная"
                        + " метрика, она может пересекаться с завершёнными прослушиваниями.\n\n"
                        + "Данные сохраняются каждые 5 секунд и при паузе. При аварийном завершении"
                        + " возможна потеря последних 5 секунд."))
        .setNegativeButton("Закрыть", null)
        .show();
  }

  private void loadLyrics() {
    Track t = current();
    if (t == null) {
      lyricTrack = "";
      lyricBody = "";
      lyrics = List.of();
      updateLyrics();
      return;
    }
    if (lyricLoading || lyricTrack.equals(t.id)) {
      updateLyrics();
      return;
    }
    lyricLoading = true;
    String id = t.id;
    app.io.execute(
        () -> {
          String body = app.repo.lyrics(id);
          int offset = app.repo.offset(id);
          List<Lrc.Line> parsed = Lrc.parse(body);
          app.main.post(
              () -> {
                lyricLoading = false;
                Track now = current();
                if (now == null || !now.id.equals(id)) {
                  loadLyrics();
                  return;
                }
                lyricTrack = id;
                lyricBody = body;
                lyrics = parsed;
                lyricOffset = offset;
                lyricIndex = -2;
                updateLyrics();
              });
        });
  }

  private void updateLyrics() {
    if (scene == null || page != 7) return;
    long pos = player == null ? 0 : player.getCurrentPosition();
    int index = Lrc.active(lyrics, pos + lyricOffset);
    scene.text("22:60", (lyricOffset >= 0 ? "+" : "") + lyricOffset + " мс");
    scene.bounds("22:60", 252, 168, 96, 24);
    scene.text("22:73", lyrics.isEmpty() ? "—" : percent(Math.max(0, index + 1), lyrics.size()));
    scene.text("22:78", lyrics.isEmpty() ? "+" : "" + (Math.max(0, index) + 1));
    boolean focus = app.prefs.getBoolean("lineFocus", true);
    TextView prev = scene.texts.get("22:68"), next = scene.texts.get("22:75");
    if (prev != null) prev.setAlpha(focus ? .45f : 1);
    if (next != null) next.setAlpha(focus ? .55f : 1);
    if (lyrics.isEmpty()) {
      scene.text("22:67", "Ваш текст");
      scene.bounds("22:67", 54, 276, 220, 20);
      scene.text(
          "22:68",
          lyricBody.isBlank()
              ? "Добавьте текст к песне"
              : "Добавьте время строк для караоке");
      scene.bounds("22:68", 54, 296, 280, 48);
      scene.text("22:69", "Изменить текст");
      scene.bounds("22:69", 54, 354, 200, 20);
      scene.text("22:70", lyricBody.isBlank() ? "Твой голос.\nТвои слова." : lyricBody);
      scene.bounds("22:70", 54, 377, 280, 93);
      scene.size("22:70", lyricBody.isBlank() ? 32 : 22);
      scene.text("22:75", "Вставьте текст, импортируйте LRC\nили отметьте время строк.");
      scene.text("22:76", "");
      scene.text("22:74", "Локальное караоке");
      scene.bounds("22:74", 54, 500, 240, 20);
      return;
    }
    scene.text("22:67", index > 0 ? time(lyrics.get(index - 1).ms) : "Готово");
    scene.bounds("22:67", 54, 276, 200, 20);
    scene.text("22:68", index > 0 ? lyrics.get(index - 1).text : "");
    scene.bounds("22:68", 54, 296, 280, 46);
    scene.text("22:69", index >= 0 ? time(lyrics.get(index).ms) : "Вступление");
    scene.bounds("22:69", 54, 354, 200, 20);
    scene.text("22:70", index >= 0 ? lyrics.get(index).text : "…");
    scene.bounds("22:70", 54, 377, 280, 80);
    scene.size("22:70", app.prefs.getInt("lyricSize", 30));
    scene.text("22:74", "Далее");
    scene.text("22:75", index + 1 < lyrics.size() ? lyrics.get(index + 1).text : "");
    scene.bounds("22:75", 54, 522, 280, 46);
    scene.text("22:76", index + 2 < lyrics.size() ? lyrics.get(index + 2).text : "");
    scene.bounds("22:76", 54, 574, 280, 22);
  }

  private void lyricsMenu() {
    Track t = current();
    if (t == null) {
      openLibrary();
      return;
    }
    new AlertDialog.Builder(this)
        .setTitle("Текст песни: " + t.title)
        .setItems(
            new String[] {
              "Изменить или вставить текст", "Импорт LRC", "Привязать строки ко времени", "Сдвиг текста", "Экспорт LRC"
            },
            (d, i) -> {
              switch (i) {
                case 0:
                  editLyrics();
                  break;
                case 1:
                  importLyricTrack = t.id;
                  Intent pick =
                      new Intent(Intent.ACTION_OPEN_DOCUMENT)
                          .setType("*/*")
                          .addCategory(Intent.CATEGORY_OPENABLE);
                  startActivityForResult(pick, LRC_FILE);
                  break;
                case 2:
                  timeLyrics();
                  break;
                case 3:
                  offsetDialog();
                  break;
                case 4:
                  exportBody = lyricBody;
                  startActivityForResult(
                      new Intent(Intent.ACTION_CREATE_DOCUMENT)
                          .setType("text/plain")
                          .addCategory(Intent.CATEGORY_OPENABLE)
                          .putExtra(
                              Intent.EXTRA_TITLE, t.title.replaceAll("[/\\\\]", "_") + ".lrc"),
                      EXPORT_LRC);
                  break;
              }
            })
        .show();
  }

  private void editLyrics() {
    Track t = current();
    if (t == null) return;
    EditText text = input("[00:12.00] Первая строка\n[00:16.50] Следующая строка", lyricBody);
    text.setMinLines(8);
    text.setMaxLines(16);
    text.setGravity(Gravity.TOP);
    text.setTextSize(15);
    text.setSelectAllOnFocus(false);
    new AlertDialog.Builder(this)
        .setTitle("Ваш текст")
        .setMessage(
            "Обычный текст или LRC с временем строк. Сохраняется только на этом устройстве.")
        .setView(text)
        .setPositiveButton(
            "Сохранить", (d, w) -> saveLyrics(t.id, text.getText().toString(), lyricOffset))
        .setNegativeButton("Отмена", null)
        .show();
  }

  private void saveLyrics(String id, String body, int offset) {
    app.io.execute(
        () -> {
          app.repo.saveLyrics(id, body, offset);
          app.main.post(
              () -> {
                lyricTrack = "";
                loadLyrics();
                toast("Текст сохранён");
              });
        });
  }

  private void offsetDialog() {
    Track t = current();
    if (t == null) return;
    slider(
        "Сдвиг в мс (плюс — текст раньше)",
        -5000,
        5000,
        lyricOffset,
        value -> saveLyrics(t.id, lyricBody, value));
  }

  private void lyricSize(int delta) {
    int size = Math.max(18, Math.min(36, app.prefs.getInt("lyricSize", 30) + delta));
    app.prefs.edit().putInt("lyricSize", size).apply();
    updateLyrics();
  }

  private void timeLyrics() {
    Track track = current();
    if (track == null) return;
    List<String> raw = new ArrayList<>();
    for (String line : lyricBody.split("\\r?\\n")) {
      String clean = line.replaceAll("\\[[^]]*\\]", "").trim();
      if (!clean.isEmpty()) raw.add(clean);
    }
    if (raw.isEmpty()) {
      editLyrics();
      return;
    }
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(24), dp(16), dp(24), dp(16));
    TextView text = label(raw.get(0), 22);
    text.setMinHeight(dp(100));
    box.addView(text);
    Button mark = new Button(this);
    mark.setText("Отметить строку сейчас");
    box.addView(mark);
    Button control = new Button(this);
    control.setText("Воспроизвести или приостановить");
    control.setOnClickListener(v -> toggle());
    box.addView(control);
    int[] index = {0};
    List<String> timed = new ArrayList<>();
    AlertDialog dialog =
        new AlertDialog.Builder(this)
            .setTitle("Синхронизация: " + track.title)
            .setMessage(
                "Запустите музыку. Нажимайте кнопку в начале каждой строки. Время можно"
                    + " отредактировать позже.")
            .setView(box)
            .setPositiveButton("Сохранить", null)
            .setNeutralButton("Сначала", null)
            .setNegativeButton("Отмена", null)
            .create();
    mark.setOnClickListener(
        v -> {
          Track now = current();
          if (now == null || !now.id.equals(track.id)) {
            toast("Трек сменился. Вернитесь к исходной песне.");
            return;
          }
          if (index[0] >= raw.size()) return;
          timed.add(Lrc.stamp(player.getCurrentPosition()) + raw.get(index[0]));
          index[0]++;
          text.setText(index[0] < raw.size() ? raw.get(index[0]) : "Все строки размечены");
          mark.setEnabled(index[0] < raw.size());
        });
    dialog.setOnShowListener(
        v -> {
          dialog
              .getButton(-1)
              .setOnClickListener(
                  b -> {
                    if (index[0] != raw.size()) {
                      toast("Отметьте все строки: " + index[0] + " / " + raw.size());
                      return;
                    }
                    saveLyrics(track.id, String.join("\n", timed), 0);
                    dialog.dismiss();
                  });
          dialog
              .getButton(-3)
              .setOnClickListener(
                  b -> {
                    index[0] = 0;
                    timed.clear();
                    text.setText(raw.get(0));
                    mark.setEnabled(true);
                    if (player != null) player.seekTo(0);
                  });
        });
    dialog.show();
  }

  @Override
  public void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (result != RESULT_OK || data == null) return;
    Uri uri = data.getData();
    if (code == AUDIO_FILES) {
      List<Uri> uris = new ArrayList<>();
      if (data.getClipData() != null)
        for (int i = 0; i < data.getClipData().getItemCount(); i++)
          uris.add(data.getClipData().getItemAt(i).getUri());
      else if (uri != null) uris.add(uri);
      for (Uri u : uris)
        try {
          getContentResolver()
              .takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
        }
      app.io.execute(
          () -> {
            int count = 0;
            String error = "";
            for (Uri u : uris)
              try {
                app.repo.importUri(u);
                count++;
              } catch (Exception e) {
                error = e.getMessage();
              }
            int n = count;
            String err = error;
            app.refresh();
            app.main.post(
                () -> {
                  toast("Добавлено: " + n + (err.isEmpty() ? "" : " · Ошибка: " + err));
                });
          });
    } else if (uri != null && code == LRC_FILE) {
      String id = importLyricTrack;
      app.io.execute(
          () -> {
            try (java.io.InputStream in = getContentResolver().openInputStream(uri)) {
              byte[] bytes = Io.read(in, 512 * 1024);
              if (bytes.length > 512 * 1024)
                throw new IllegalArgumentException("Файл больше 512 КБ");
              String text =
                  new String(bytes, java.nio.charset.StandardCharsets.UTF_8).replace("\ufeff", "");
              app.repo.saveLyrics(id, text, 0);
              app.main.post(
                  () -> {
                    lyricTrack = "";
                    loadLyrics();
                    toast("Текст импортирован");
                  });
            } catch (Exception e) {
              app.main.post(() -> toast("Не удалось прочитать LRC: " + e.getMessage()));
            }
          });
    } else if (uri != null && (code == EXPORT || code == EXPORT_LRC)) {
      if (app.service != null) app.service.checkpoint();
      String lyricsToExport = exportBody;
      app.io.execute(
          () -> {
            try (java.io.OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
              String text = code == EXPORT ? app.repo.exportJson() : lyricsToExport;
              out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
              app.main.post(() -> toast("Экспорт сохранён"));
            } catch (Exception e) {
              app.main.post(() -> toast("Ошибка экспорта: " + e.getMessage()));
            }
          });
    }
  }
}
