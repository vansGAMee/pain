package dev.mono.local;

/** Shared native surfaces: old themes keep their own colours on every screen. */
final class MobilePalette {
  final int paper, ink, surface, accent, muted;
  final boolean dark;

  MobilePalette(MonoApp app) {
    String theme = app.prefs.getString("theme", "sakura");
    dark = theme.equals("sakura") || theme.equals("night") || theme.equals("dark");
    switch (theme) {
      case "sakura":
        paper = 0xff0c0911; ink = 0xfff4edf8; surface = 0xff15101c; accent = 0xffd5b5f3;
        break;
      case "night":
        paper = 0xff0d0d0d; ink = 0xffe5e1e8; surface = 0xff191919; accent = ink;
        break;
      case "dark":
        paper = 0xff292928; ink = 0xffdeded5; surface = 0xff20201f; accent = ink;
        break;
      case "mist":
        paper = 0xffeeeef0; ink = 0xff11110f; surface = 0xffe1e1e5; accent = ink;
        break;
      default:
        paper = 0xffefede6; ink = 0xff11110f; surface = 0xffe4e1d8; accent = ink;
    }
    muted = android.graphics.Color.argb(175, android.graphics.Color.red(ink),
        android.graphics.Color.green(ink), android.graphics.Color.blue(ink));
  }
}
