package dev.mono.local;

import java.util.*;
import java.util.regex.*;

public final class Lrc {
  public static final class Line {
    public final long ms;
    public final String text;

    Line(long m, String t) {
      ms = m;
      text = t;
    }
  }

  private static final Pattern STAMP =
      Pattern.compile("\\[(\\d{1,3}):(\\d{2})(?:[.:](\\d{1,3}))?\\]");

  public static List<Line> parse(String input) {
    List<Line> result = new ArrayList<>();
    long offset = 0;
    Matcher o =
        Pattern.compile("\\[offset:\\s*([+-]?\\d+)\\]", Pattern.CASE_INSENSITIVE).matcher(input);
    if (o.find())
      try {
        offset = Long.parseLong(o.group(1));
      } catch (NumberFormatException ignored) {
      }
    for (String raw : input.split("\\r?\\n")) {
      Matcher m = STAMP.matcher(raw);
      List<Long> times = new ArrayList<>();
      int end = 0;
      while (m.find()) {
        int sec = Integer.parseInt(m.group(2));
        if (sec > 59) continue;
        String frac = m.group(3);
        long f = frac == null ? 0 : Long.parseLong((frac + "00").substring(0, 3));
        times.add(Long.parseLong(m.group(1)) * 60000 + sec * 1000L + f);
        end = m.end();
      }
      String text = raw.substring(end).replaceAll("<\\d+:\\d+(?:\\.\\d+)?>", "").trim();
      for (long ms : times) result.add(new Line(Math.max(0, ms - offset), text));
    }
    result.sort(Comparator.comparingLong(l -> l.ms));
    return result;
  }

  public static int active(List<Line> lines, long position) {
    int lo = 0, hi = lines.size() - 1, found = -1;
    while (lo <= hi) {
      int mid = (lo + hi) >>> 1;
      if (lines.get(mid).ms <= position) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  public static String stamp(long ms) {
    return String.format(
        Locale.ROOT, "[%02d:%02d.%02d]", ms / 60000, (ms / 1000) % 60, (ms % 1000) / 10);
  }
}
