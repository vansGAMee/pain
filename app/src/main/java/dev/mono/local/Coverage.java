package dev.mono.local;

import java.util.*;

/** Union of heard media intervals, so rewinding a chorus cannot fake a completed track. */
public final class Coverage {
  private final List<long[]> spans = new ArrayList<>();

  public void clear() {
    spans.clear();
  }

  public long add(long start, long end) {
    if (end <= start) return 0;
    start = Math.max(0, start);
    long before = 0;
    for (long[] s : spans) before += s[1] - s[0];
    List<long[]> merged = new ArrayList<>();
    boolean inserted = false;
    for (long[] s : spans) {
      if (s[1] < start) merged.add(s);
      else if (s[0] > end) {
        if (!inserted) {
          merged.add(new long[] {start, end});
          inserted = true;
        }
        merged.add(s);
      } else {
        start = Math.min(start, s[0]);
        end = Math.max(end, s[1]);
      }
    }
    if (!inserted) merged.add(new long[] {start, end});
    spans.clear();
    spans.addAll(merged);
    long after = 0;
    for (long[] s : spans) after += s[1] - s[0];
    return after - before;
  }
}
