package dev.mono.local;

import static org.junit.Assert.*;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.SystemClock;
import androidx.media3.common.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class PlaybackTest {
  @Test
  public void audibleHistoryIgnoresPausesSeeksAndContinuesInBackground() throws Exception {
    Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    Context c = inst.getTargetContext();
    MonoApp app = (MonoApp) c.getApplicationContext();
    app.prefs
        .edit()
        .putBoolean("autoScan", false)
        .putBoolean("history", true)
        .putInt("repeat", 0)
        .putBoolean("shuffle", false)
        .putFloat("speed", 1)
        .apply();
    File wav = new File(c.getFilesDir(), "playback-check.wav");
    RepositoryTest.writeWav(wav, 8);
    app.io
        .submit(
            () -> {
              try {
                app.repo.clearHistory();
                app.repo.importUri(Uri.fromFile(wav));
              } catch (Exception e) {
                throw new RuntimeException(e);
              }
            })
        .get();
    app.refresh();
    Activity activity =
        inst.startActivitySync(
            new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    long until = SystemClock.elapsedRealtime() + 10000;
    while ((app.service == null || app.tracks.isEmpty()) && SystemClock.elapsedRealtime() < until)
      Thread.sleep(50);
    assertNotNull(app.service);
    Track t =
        app.tracks.stream()
            .filter(x -> x.uri.equals(Uri.fromFile(wav).toString()))
            .findFirst()
            .orElseThrow();
    inst.runOnMainSync(
        () -> {
          app.service.player.setMediaItems(List.of(t.mediaItem()));
          app.service.player.prepare();
          app.service.player.play();
        });
    Thread.sleep(1800);
    inst.runOnMainSync(
        () -> {
          assertTrue(app.service.player.isPlaying());
          app.service.player.pause();
          app.service.checkpoint();
        });
    long first = app.io.submit(() -> app.repo.stats(0).heard).get();
    assertTrue("Actual playback recorded: " + first, first >= 500 && first < 2400);
    Thread.sleep(1200);
    inst.runOnMainSync(
        () -> {
          app.service.player.seekTo(6500);
          app.service.checkpoint();
        });
    long afterSeek = app.io.submit(() -> app.repo.stats(0).heard).get();
    assertEquals("Pause + seek must not add time", first, afterSeek);
    inst.runOnMainSync(() -> app.service.player.play());
    Thread.sleep(2200);
    inst.runOnMainSync(() -> app.service.checkpoint());
    Repository.Stats s = app.io.submit(() -> app.repo.stats(0)).get();
    assertTrue("End after seek not counted as full listen", s.heard < 5000);
    assertEquals(0, s.completed);
    inst.runOnMainSync(
        () -> {
          app.service.player.seekTo(0);
          app.service.player.play();
          activity.moveTaskToBack(true);
        });
    Thread.sleep(1500);
    inst.runOnMainSync(
        () -> {
          assertTrue("Background playback", app.service.player.isPlaying());
          assertTrue(app.service.player.getCurrentPosition() > 500);
          app.service.player.pause();
          app.service.checkpoint();
        });
    long total = app.io.submit(() -> app.repo.stats(0).heard).get();
    assertTrue(total > s.heard);
    inst.runOnMainSync(
        () -> {
          app.service.player.clearMediaItems();
          activity.finish();
        });
    wav.delete();
  }

  @Test
  public void automaticQueueTransitionsAndEndOfTrackTimer() throws Exception {
    Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    Context c = inst.getTargetContext();
    MonoApp app = (MonoApp) c.getApplicationContext();
    app.prefs.edit().putBoolean("autoScan", false).putBoolean("history", true).apply();
    File first = new File(c.getFilesDir(), "queue-first.wav"),
        second = new File(c.getFilesDir(), "queue-second.wav");
    RepositoryTest.writeWav(first, 3);
    RepositoryTest.writeWav(second, 3);
    app.io
        .submit(
            () -> {
              try {
                app.repo.clearHistory();
                app.repo.importUri(Uri.fromFile(first));
                app.repo.importUri(Uri.fromFile(second));
              } catch (Exception e) {
                throw new RuntimeException(e);
              }
            })
        .get();
    app.refresh();
    Activity activity =
        inst.startActivitySync(
            new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    long until = SystemClock.elapsedRealtime() + 10000;
    while ((app.service == null
            || app.tracks.stream().noneMatch(t -> t.uri.equals(Uri.fromFile(second).toString())))
        && SystemClock.elapsedRealtime() < until) Thread.sleep(50);
    Track
        a =
            app.tracks.stream()
                .filter(t -> t.uri.equals(Uri.fromFile(first).toString()))
                .findFirst()
                .orElseThrow(),
        b =
            app.tracks.stream()
                .filter(t -> t.uri.equals(Uri.fromFile(second).toString()))
                .findFirst()
                .orElseThrow();
    inst.runOnMainSync(
        () -> {
          app.service.player.setRepeatMode(Player.REPEAT_MODE_OFF);
          app.service.player.setShuffleModeEnabled(false);
          app.service.player.setMediaItems(List.of(a.mediaItem(), b.mediaItem()));
          app.service.player.prepare();
          app.service.player.play();
        });
    Thread.sleep(7000);
    inst.runOnMainSync(() -> app.service.checkpoint());
    Repository.Stats stats = app.io.submit(() -> app.repo.stats(0)).get();
    assertEquals("Both tracks completed", 2, stats.completed);
    assertEquals(2, stats.unique);
    assertTrue(stats.trackMs.getOrDefault(a.id, 0L) > 2500);
    assertTrue(stats.trackMs.getOrDefault(b.id, 0L) > 2500);
    inst.runOnMainSync(
        () -> {
          app.service.player.seekTo(0, 0);
          app.service.sleep(-1);
          app.service.player.play();
        });
    Thread.sleep(3800);
    inst.runOnMainSync(
        () -> {
          assertFalse(
              "End of track timer pauses before next audio", app.service.player.isPlaying());
          assertEquals(1, app.service.player.getCurrentMediaItemIndex());
          assertTrue(app.service.player.getCurrentPosition() < 300);
          app.service.player.clearMediaItems();
          activity.finish();
        });
    first.delete();
    second.delete();
  }
}
