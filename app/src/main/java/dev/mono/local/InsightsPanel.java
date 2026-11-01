package dev.mono.local;

import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.widget.*;
import java.time.LocalDate;
import java.util.*;
import java.util.function.*;

/** Statistics update in place: no replacement of the scroll view during playback. */
final class InsightsPanel extends LinearLayout {
  private final MonoApp app;
  private final MobilePalette palette;
  private final boolean ru;
  private final LinearLayout content;
  private final TextView status, total, summary, empty, peak, emptySongs, emptyArtists;
  private final TextView[] periods = new TextView[3], metricValues = new TextView[10];
  private final TextView[] songs = new TextView[10], artists = new TextView[10];
  private final WeekChart weekChart;
  private final HoursChart hoursChart;
  private final Consumer<String> playTrack;

  InsightsPanel(Context context, MonoApp app, IntConsumer changePeriod, Runnable weekly,
      Runnable tools, Consumer<String> playTrack, Runnable more) {
    super(context);
    this.app = app; this.playTrack = playTrack;
    palette = new MobilePalette(app); ru = app.prefs.getString("lang", "ru").equals("ru");
    setOrientation(VERTICAL); setPadding(dp(24), dp(16), dp(24), dp(24));
    TextView heading = text(ru ? "Инсайты" : "Insights", 32);
    heading.setTypeface(DesignScene.font(context, "Bold")); addView(heading);
    TextView subtitle = text(ru ? "Ваша музыка в цифрах" : "Your music in numbers", 14);
    subtitle.setTextColor(palette.muted); addView(subtitle);
    LinearLayout choices = new LinearLayout(context);
    LayoutParams choiceParams = new LayoutParams(-1, dp(52)); choiceParams.topMargin = dp(16);
    addView(choices, choiceParams);
    int[] spans = {7, 30, 0};
    String[] names = ru ? new String[]{"7 дней", "30 дней", "Всё время"}
        : new String[]{"7 days", "30 days", "All time"};
    for (int i = 0; i < spans.length; i++) {
      int span = spans[i]; TextView button = text(names[i], 14); periods[i] = button;
      button.setGravity(Gravity.CENTER); button.setMinHeight(dp(48)); button.setFocusable(true);
      button.setOnClickListener(v -> changePeriod.accept(span));
      LayoutParams params = new LayoutParams(0, -1, 1); params.setMargins(dp(2), 0, dp(2), 0);
      choices.addView(button, params);
    }
    status = text("", 12); status.setTextColor(palette.muted);
    // Reserved height avoids moving the report while its data is being read.
    addView(status, new LayoutParams(-1, dp(32)));
    content = new LinearLayout(context); content.setOrientation(VERTICAL);
    addView(content, new LayoutParams(-1, -2));

    LinearLayout time = section(ru ? "Время с музыкой" : "Time with music");
    total = text("—", 34); total.setTypeface(DesignScene.font(context, "SemiBold")); time.addView(total);
    summary = text("", 14); time.addView(summary);
    empty = text(ru ? "Начните слушать — здесь появятся ваши привычки."
        : "Start listening to see your music habits here.", 14); time.addView(empty);
    button(time, ru ? "Все 20 графиков" : "All 20 charts",
        () -> ChartGallery.open((android.app.Activity) context, app));
    button(time, ru ? "Отчёт за неделю" : "Weekly report", weekly);

    LinearLayout week = section(ru ? "Последние семь дней" : "Last seven days");
    weekChart = new WeekChart(context, Map.of(), LocalDate.now().minusDays(6), palette.ink, palette.accent);
    week.addView(weekChart, new LayoutParams(-1, dp(185)));
    LinearLayout hours = section(ru ? "Когда вы слушаете" : "When you listen");
    hoursChart = new HoursChart(context, palette.ink, palette.accent);
    hours.addView(hoursChart, new LayoutParams(-1, dp(150)));
    peak = text("", 14); hours.addView(peak);

    LinearLayout habits = section(ru ? "Как вы слушаете" : "How you listen");
    String[] labels = ru ? new String[]{"Прослушивания", "Дослушано", "Ранние пропуски", "Повторы",
        "Новые треки", "Сессии", "Средняя сессия", "Самая длинная сессия", "Дней подряд · всё время",
        "Рекорд серии · всё время"} : new String[]{"Listens", "Completed", "Early skips", "Replays",
        "New songs", "Sessions", "Average session", "Longest session", "Current streak · all time", "Best streak · all time"};
    for (int i = 0; i < labels.length; i++) {
      LinearLayout row = new LinearLayout(context); row.setGravity(Gravity.CENTER_VERTICAL);
      row.addView(text(labels[i], 14), new LayoutParams(0, -2, 1));
      TextView value = text("—", 15); metricValues[i] = value;
      value.setTextColor(palette.accent); value.setGravity(Gravity.END);
      value.setPadding(dp(12), dp(6), 0, dp(6)); row.addView(value, new LayoutParams(-2, -2));
      habits.addView(row);
    }
    LinearLayout favoriteSongs = section(ru ? "Любимые треки" : "Most played songs");
    emptySongs = text(ru ? "Здесь появятся треки, которые вы слушаете чаще." : "Your most played songs appear here.", 14);
    favoriteSongs.addView(emptySongs);
    LinearLayout favoriteArtists = section(ru ? "Любимые исполнители" : "Most played artists");
    emptyArtists = text(ru ? "Исполнители появятся после прослушивания." : "Artists appear after listening.", 14);
    favoriteArtists.addView(emptyArtists);
    for (int i = 0; i < songs.length; i++) {
      songs[i] = text("", 14); songs[i].setMinHeight(dp(64)); songs[i].setGravity(Gravity.CENTER_VERTICAL);
      songs[i].setFocusable(true); songs[i].setVisibility(GONE); favoriteSongs.addView(songs[i]);
      artists[i] = text("", 14); artists[i].setVisibility(GONE); favoriteArtists.addView(artists[i]);
    }
    button(content, ru ? "Все метрики и выбор периода" : "More metrics & date range", more);
    button(content, ru ? "Инструменты и настройки" : "Tools & settings", tools);
  }

  void select(int period, boolean loading) {
    int[] spans = {7, 30, 0};
    for (int i = 0; i < periods.length; i++) {
      boolean selected = spans[i] == period;
      periods[i].setSelected(selected); periods[i].setTextColor(selected ? palette.paper : palette.ink);
      periods[i].setBackground(surface(selected ? palette.accent : palette.surface, 12));
    }
    status.setText(loading ? (ru ? "Считаем вашу статистику…" : "Loading your listening history…") : "");
    content.setVisibility(loading ? INVISIBLE : VISIBLE);
  }

  void bind(Repository.Stats stats, Repository.Stats all) {
    total.setText(Repository.formatTime(stats.heard));
    summary.setText(ru ? stats.unique + " треков · " + stats.artists.size() + " исполнителей"
        : stats.unique + " songs · " + stats.artists.size() + " artists");
    empty.setVisibility(stats.heard == 0 ? VISIBLE : GONE);
    weekChart.bind(stats.days, LocalDate.now().minusDays(6)); hoursChart.bind(stats.hours);
    peak.setText(stats.peak < 0 ? (ru ? "Пик появится после прослушивания" : "A peak appears after listening")
        : (ru ? "Любимый час: " : "Favorite hour: ") + String.format(Locale.ROOT, "%02d:00", stats.peak));
    String[] values = {"" + stats.qualified, "" + stats.completed, "" + stats.early, "" + stats.replayed,
        "" + stats.newPlays, "" + stats.sessionCount, Repository.formatTime(stats.average),
        Repository.formatTime(stats.longest), "" + all.streak, "" + all.longestStreak};
    for (int i = 0; i < values.length; i++) metricValues[i].setText(values[i]);
    List<Map.Entry<String, Long>> topSongs = new ArrayList<>(stats.trackMs.entrySet());
    topSongs.removeIf(e -> app.track(e.getKey()) == null);
    topSongs.sort(Map.Entry.<String, Long>comparingByValue().reversed());
    List<Map.Entry<String, Long>> topArtists = new ArrayList<>(stats.artists.entrySet());
    topArtists.sort(Map.Entry.<String, Long>comparingByValue().reversed());
    emptySongs.setVisibility(topSongs.isEmpty() ? VISIBLE : GONE);
    emptyArtists.setVisibility(topArtists.isEmpty() ? VISIBLE : GONE);
    for (int i = 0; i < songs.length; i++) {
      boolean song = i < topSongs.size(), artist = i < topArtists.size();
      songs[i].setVisibility(song ? VISIBLE : GONE); artists[i].setVisibility(artist ? VISIBLE : GONE);
      if (song) {
        Map.Entry<String, Long> entry = topSongs.get(i); Track track = app.track(entry.getKey());
        songs[i].setText(track.title + "\n" + track.artist + " · " + Repository.formatTime(entry.getValue()));
        songs[i].setOnClickListener(v -> playTrack.accept(track.id));
      }
      if (artist) {
        Map.Entry<String, Long> entry = topArtists.get(i);
        artists[i].setText(entry.getKey() + " · " + Repository.formatTime(entry.getValue()));
      }
    }
  }

  private TextView text(String value, int size) {
    TextView text = new TextView(getContext()); text.setText(value); text.setTextColor(palette.ink);
    text.setTextSize(size * app.prefs.getFloat("textScale", 1));
    text.setTypeface(DesignScene.font(getContext())); text.setFontFeatureSettings("tnum");
    text.setPadding(0, dp(6), 0, dp(6)); return text;
  }

  private LinearLayout section(String title) {
    LinearLayout box = new LinearLayout(getContext()); box.setOrientation(VERTICAL);
    box.setPadding(dp(18), dp(14), dp(18), dp(16)); box.setBackground(surface(palette.surface, 20));
    LayoutParams params = new LayoutParams(-1, -2); params.bottomMargin = dp(16); content.addView(box, params);
    TextView heading = text(title, 18); heading.setTypeface(DesignScene.font(getContext(), "SemiBold"));
    box.addView(heading); return box;
  }

  private void button(LinearLayout parent, String title, Runnable click) {
    TextView text = text(title, 15); text.setTextColor(palette.accent); text.setMinHeight(dp(48));
    text.setGravity(Gravity.CENTER_VERTICAL); text.setFocusable(true); text.setOnClickListener(v -> click.run());
    parent.addView(text, new LayoutParams(-1, -2));
  }

  private GradientDrawable surface(int color, int radius) {
    GradientDrawable background = new GradientDrawable(); background.setColor(color);
    background.setCornerRadius(dp(radius)); return background;
  }

  private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

  static final class HoursChart extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private long[] values = new long[24];
    private final int ink, accent;
    private final float density;
    HoursChart(Context context, int ink, int accent) {
      super(context); this.ink = ink; this.accent = accent; density = getResources().getDisplayMetrics().density;
      setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
    }
    void bind(long[] hours) {
      values = hours.clone(); StringBuilder description = new StringBuilder();
      for (int i = 0; i < values.length; i++) description.append(i).append(":00 — ")
          .append(Repository.formatTime(values[i])).append(". ");
      setContentDescription(description); invalidate();
    }
    @Override protected void onDraw(Canvas canvas) {
      long max = 1; for (long value : values) max = Math.max(max, value);
      float step = getWidth() / 24f, base = getHeight() - 25 * density, height = base - 8 * density;
      paint.setTextSize(11 * density); paint.setTextAlign(Paint.Align.CENTER);
      for (int i = 0; i < 24; i++) {
        paint.setColor(accent); float bar = values[i] == 0 ? density : Math.max(2 * density, height * values[i] / max);
        canvas.drawRoundRect(i * step + step * .14f, base - bar, (i + 1) * step - step * .14f, base, 2 * density, 2 * density, paint);
        if (i % 6 == 0) { paint.setColor(ink); canvas.drawText(String.format(Locale.ROOT, "%02d", i), step * (i + .5f), base + 19 * density, paint); }
      }
    }
  }
}
