package dev.mono.local;

/** Pure accounting rules: seeks, buffering and pause never add listening time. */
public final class ListeningMath {
  private ListeningMath() {}

  public static long audibleDelta(
      long elapsedMs, long positionDelta, float speed, boolean wasPlaying, boolean discontinuity) {
    if (!wasPlaying || discontinuity || elapsedMs <= 0 || positionDelta <= 0 || speed <= 0)
      return 0;
    // Use the smaller of elapsed real time and rendered media time. A seek is never a listen.
    if (positionDelta > elapsedMs * speed + 1500) return 0;
    return Math.min(elapsedMs, Math.round(positionDelta / speed));
  }

  public static boolean qualifies(long audible, long duration) {
    return audible >= (duration>0?Math.min(30000, Math.max(1000, duration / 2)):30000);
  }

  public static boolean completed(long mediaHeard, long duration) {
    return duration > 0 && mediaHeard >= duration * .90;
  }
}
