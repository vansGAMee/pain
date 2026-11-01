package dev.mono.local;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.*;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import java.util.function.IntConsumer;

/** One measured, persistent transport and navigation bar for all primary tabs. */
final class MobileDock extends LinearLayout {
  final InstrumentView playIcon;
  final View playButton;
  private final ImageView artwork;
  private final TextView title, artist;
  private final View[] tabs = new View[4];
  private final TextView[] captions = new TextView[4];
  private final IconView[] icons = new IconView[4];
  private final int[] targets = {0, 2, 3, 4};
  private final MonoApp app;
  private final MobilePalette palette;
  private final boolean ru;

  MobileDock(Context context, MonoApp app, IntConsumer navigate, Runnable openPlayer,
      Runnable toggle, Runnable next) {
    super(context);
    this.app = app;
    palette = new MobilePalette(app);
    ru = app.prefs.getString("lang", "ru").equals("ru");
    setOrientation(VERTICAL);
    setPadding(dp(16), dp(8), dp(16), 0);
    setBackgroundColor(palette.paper);
    setElevation(dp(4));

    LinearLayout transport = new LinearLayout(context);
    transport.setGravity(Gravity.CENTER_VERTICAL);
    transport.setPadding(dp(10), dp(6), dp(4), dp(6));
    GradientDrawable surface = new GradientDrawable();
    surface.setColor(palette.surface); surface.setCornerRadius(dp(16));
    transport.setBackground(surface);
    addView(transport, new LayoutParams(-1, dp(64)));

    LinearLayout recording = new LinearLayout(context);
    recording.setGravity(Gravity.CENTER_VERTICAL);
    recording.setContentDescription(ru ? "Открыть плеер" : "Open player");
    recording.setFocusable(true);
    recording.setOnClickListener(v -> openPlayer.run());
    transport.addView(recording, new LayoutParams(0, -1, 1));
    artwork = new ImageView(context);
    artwork.setScaleType(ImageView.ScaleType.CENTER_CROP);
    GradientDrawable outline = new GradientDrawable();
    outline.setColor(Color.TRANSPARENT); outline.setCornerRadius(dp(8));
    artwork.setBackground(outline); artwork.setClipToOutline(true);
    artwork.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    recording.addView(artwork, new LayoutParams(dp(44), dp(44)));
    LinearLayout text = new LinearLayout(context);
    text.setOrientation(VERTICAL); text.setGravity(Gravity.CENTER_VERTICAL);
    text.setPadding(dp(12), 0, dp(6), 0);
    recording.addView(text, new LayoutParams(0, -1, 1));
    title = label("", 14, palette.ink); title.setTypeface(DesignScene.font(context, "SemiBold"));
    artist = label("", 12, palette.muted);
    text.addView(title, new LayoutParams(-1, -2));
    text.addView(artist, new LayoutParams(-1, -2));

    FrameLayout play = new FrameLayout(context);
    playButton = play; play.setFocusable(true); play.setOnClickListener(v -> toggle.run());
    transport.addView(play, new LayoutParams(dp(48), dp(48)));
    playIcon = new InstrumentView(context, "play"); playIcon.ink = palette.ink;
    playIcon.setFocusable(false); playIcon.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    play.addView(playIcon, new FrameLayout.LayoutParams(dp(30), dp(34), Gravity.CENTER));
    MicroMotion.press(play, playIcon, .94f);
    IconView skip = new IconView(context, "next", palette.ink);
    skip.setFocusable(true); skip.setContentDescription(ru ? "Следующий трек" : "Next track");
    skip.setOnClickListener(v -> next.run());
    transport.addView(skip, new LayoutParams(dp(44), dp(48)));
    MicroMotion.press(skip, skip, .94f);

    LinearLayout nav = new LinearLayout(context);
    addView(nav, new LayoutParams(-1, dp(64)));
    String[] names = ru ? new String[]{"Главная", "Библиотека", "Инсайты", "Устройства"}
        : new String[]{"Home", "Library", "Insights", "Devices"};
    String[] symbols = {"home", "library", "stats", "device"};
    for (int i = 0; i < targets.length; i++) {
      final int target = targets[i];
      LinearLayout tab = new LinearLayout(context);
      tabs[i] = tab; tab.setOrientation(VERTICAL); tab.setGravity(Gravity.CENTER);
      tab.setContentDescription(names[i]); tab.setFocusable(true);
      tab.setOnClickListener(v -> navigate.accept(target));
      tab.setBackground(new RippleDrawable(ColorStateList.valueOf(palette.muted & 0x22ffffff),
          null, new ColorDrawable(Color.WHITE)));
      nav.addView(tab, new LayoutParams(0, -1, 1));
      icons[i] = new IconView(context, symbols[i], palette.accent);
      icons[i].setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
      tab.addView(icons[i], new LayoutParams(dp(23), dp(23)));
      captions[i] = label(names[i], 10, palette.ink);
      captions[i].setGravity(Gravity.CENTER);
      captions[i].setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
      LayoutParams caption = new LayoutParams(-1, -2); caption.topMargin = dp(3);
      tab.addView(captions[i], caption);
      MicroMotion.press(tab, icons[i], .94f);
    }
  }

  void select(int page) {
    int selected = page == 5 ? 3 : page;
    for (int i = 0; i < tabs.length; i++) {
      boolean active = targets[i] == selected;
      tabs[i].setSelected(active); icons[i].setAlpha(active ? 1f : .5f);
      captions[i].setAlpha(active ? 1f : .65f);
      captions[i].setTypeface(DesignScene.font(getContext(), active ? "SemiBold" : "Medium"));
    }
  }

  void bind(Track track) {
    title.setText(track == null ? (ru ? "Выберите музыку" : "Choose music") : track.title);
    artist.setText(track == null ? (ru ? "Открыть библиотеку" : "Open library") : track.artist);
    Art.load(getContext(), artwork, track, true);
  }

  void playback(boolean pause) {
    playIcon.setPlaying(pause);
    playButton.setContentDescription(pause ? (ru ? "Пауза" : "Pause") : (ru ? "Воспроизвести" : "Play"));
  }

  private TextView label(String value, int size, int color) {
    TextView text = new TextView(getContext()); text.setText(value); text.setTextColor(color);
    text.setTextSize(size * app.prefs.getFloat("textScale", 1));
    text.setTypeface(DesignScene.font(getContext())); text.setSingleLine(true);
    text.setEllipsize(TextUtils.TruncateAt.END); text.setIncludeFontPadding(false);
    return text;
  }

  private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
