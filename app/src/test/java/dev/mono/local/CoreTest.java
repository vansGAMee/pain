package dev.mono.local;

import static org.junit.Assert.*;

import java.util.*;
import org.junit.Test;

public class CoreTest {
  @Test
  public void replayingSamePassageDoesNotFakeCompletion() {
    Coverage c = new Coverage();
    assertEquals(1000, c.add(0, 1000));
    assertEquals(0, c.add(0, 1000));
    assertEquals(500, c.add(500, 1500));
    assertEquals(1000, c.add(2000, 3000));
    assertEquals(500, c.add(1500, 2000));
    assertEquals(0, c.add(0, 3000));
    c.clear();
    assertEquals(100, c.add(0, 100));
  }

  @Test
  public void pausesBufferingAndSeeksDoNotCount() {
    assertEquals(0, ListeningMath.audibleDelta(1000, 1000, 1, false, false));
    assertEquals(0, ListeningMath.audibleDelta(1000, 0, 1, true, false));
    assertEquals(0, ListeningMath.audibleDelta(1000, 60000, 1, true, false));
    assertEquals(0, ListeningMath.audibleDelta(1000, -1000, 1, true, false));
    assertEquals(0, ListeningMath.audibleDelta(1000, 1000, 1, true, true));
  }

  @Test
  public void speedUsesWallTime() {
    assertEquals(1000, ListeningMath.audibleDelta(1000, 2000, 2, true, false));
    assertEquals(1000, ListeningMath.audibleDelta(1000, 750, .75f, true, false));
    assertEquals(500, ListeningMath.audibleDelta(1000, 500, 1, true, false));
  }

  @Test
  public void qualifiesAndCompletes() {
    assertFalse(ListeningMath.qualifies(29999, 180000));
    assertTrue(ListeningMath.qualifies(30000, 180000));
    assertTrue(ListeningMath.qualifies(10000, 20000));
    assertFalse(ListeningMath.completed(1000, 20000));
    assertTrue(ListeningMath.completed(18000, 20000));
    assertFalse(ListeningMath.completed(0, 0));
  }

  @Test
  public void lrcSupportsMultipleStampsOffsetsAndStableOrdering() {
    List<Lrc.Line> lines =
        Lrc.parse(
            "[ar:Example]\n"
                + "[offset:-200]\n"
                + "[00:01.50][00:03.250]Hello\n"
                + "[00:00.10]Intro\n"
                + "[00:70]bad\n"
                + "[01:02.3]End");
    assertEquals(4, lines.size());
    assertEquals(0, lines.get(0).ms);
    assertEquals(1300, lines.get(1).ms);
    assertEquals(3050, lines.get(2).ms);
    assertEquals(62100, lines.get(3).ms);
    assertEquals("Hello", lines.get(2).text);
    assertEquals(-1, Lrc.active(lines, -1));
    assertEquals(1, Lrc.active(lines, 1300));
    assertEquals(3, Lrc.active(lines, 999999));
  }

  @Test
  public void lrcPlainTextIsNotFalselyTimed() {
    assertTrue(Lrc.parse("first\nsecond").isEmpty());
    assertEquals("[01:02.34]", Lrc.stamp(62340));
    assertEquals(0, Lrc.parse("[00:00.00]Start").get(0).ms);
  }

  @Test
  public void updateVersionsAndChecksumsAreStrict() {
    assertTrue(UpdateChecker.newer("v1.4.8", "1.4.7"));
    assertTrue(UpdateChecker.newer("2.0.0", "1.99.99"));
    assertFalse(UpdateChecker.newer("1.4.7", "1.4.8"));
    assertFalse(UpdateChecker.newer("latest", "1.4.8"));
    assertFalse(UpdateChecker.newer("1.4.-1", "1.4.8"));
    assertFalse(UpdateChecker.newer("01.4.9", "1.4.8"));
    String hash = "a".repeat(64);
    assertEquals(hash, UpdateChecker.checksum(hash + "  Pain-v1.4.8-Android.apk\n", "Pain-v1.4.8-Android.apk"));
    assertNull(UpdateChecker.checksum(hash + "  another.apk\n", "Pain-v1.4.8-Android.apk"));
  }
}
