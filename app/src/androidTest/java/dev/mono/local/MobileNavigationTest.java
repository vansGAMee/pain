package dev.mono.local;

import static org.junit.Assert.*;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.os.SystemClock;
import android.view.*;
import android.widget.*;
import androidx.media3.common.Player;
import androidx.media3.common.MediaItem;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class MobileNavigationTest {
  private final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
  private <T> T field(Object owner, String name) {
    try { Field f = owner.getClass().getDeclaredField(name); f.setAccessible(true); return (T) f.get(owner); }
    catch (Exception error) { throw new AssertionError(error); }
  }
  private void show(MainActivity activity, int page) {
    try { Method m = MainActivity.class.getDeclaredMethod("show", int.class, boolean.class); m.setAccessible(true); m.invoke(activity, page, true); }
    catch (Exception error) { throw new AssertionError(error); }
  }
  private void await(BooleanSupplier condition) throws Exception {
    long deadline = SystemClock.elapsedRealtime() + 12000;
    while (SystemClock.elapsedRealtime() < deadline) {
      boolean[] result = {false}; inst.runOnMainSync(() -> result[0] = condition.getAsBoolean());
      if (result[0]) return;
      Thread.sleep(40);
    }
    fail("UI condition timed out");
  }
  private View find(View view, String label) {
    if (label.contentEquals(view.getContentDescription() == null ? "" : view.getContentDescription())) return view;
    if (view instanceof TextView && label.contentEquals(((TextView) view).getText())) return view;
    if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
      View found = find(((ViewGroup) view).getChildAt(i), label); if (found != null) return found;
    }
    return null;
  }
  private Rect bounds(View view) { int[] xy = new int[2]; view.getLocationOnScreen(xy); return new Rect(xy[0], xy[1], xy[0] + view.getWidth(), xy[1] + view.getHeight()); }

  @Test public void bufferingCanBePausedFromInsightsWithoutRestartingTheStream() throws Exception {
    Context context = inst.getTargetContext(); MonoApp app = (MonoApp) context.getApplicationContext();
    boolean history = app.prefs.getBoolean("history", true), scan = app.prefs.getBoolean("autoScan", true);
    app.prefs.edit().putBoolean("history", false).putBoolean("autoScan", false).commit();
    CountDownLatch release = new CountDownLatch(1);
    try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
      Thread stream = new Thread(() -> {
        try (Socket socket = server.accept()) {
          socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: 5000000\r\n\r\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
          socket.getOutputStream().flush(); release.await(20, TimeUnit.SECONDS);
        } catch (Exception ignored) {}
      });
      stream.setDaemon(true); stream.start();
      MainActivity activity = (MainActivity) inst.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      try {
        await(() -> field(activity, "player") != null);
        inst.runOnMainSync(() -> {
          show(activity, 3);
          app.service.player.setMediaItem(MediaItem.fromUri("http://127.0.0.1:" + server.getLocalPort() + "/buffering.wav"));
          app.service.player.prepare(); app.service.player.play();
        });
        await(() -> app.service.player.getPlaybackState() == Player.STATE_BUFFERING
            && ((MobileDock) field(activity, "mobileDock")).playIcon.playing);
        inst.runOnMainSync(() -> {
          assertFalse(app.service.player.isPlaying());
          ((MobileDock) field(activity, "mobileDock")).playButton.performClick();
        });
        await(() -> !app.service.player.getPlayWhenReady()
            && !((MobileDock) field(activity, "mobileDock")).playIcon.playing);
        inst.runOnMainSync(() -> show(activity, 1)); inst.waitForIdleSync();
        inst.runOnMainSync(() -> assertFalse(((List<InstrumentView>) field(activity, "plays")).get(0).playing));
      } finally {
        release.countDown();
        inst.runOnMainSync(() -> { app.service.player.pause(); app.service.player.clearMediaItems(); activity.finish(); });
      }
      stream.join(2000);
    } finally { app.prefs.edit().putBoolean("history", history).putBoolean("autoScan", scan).commit(); }
  }

  @Test public void transportAndTabGeometryStayConsistentInEverySavedTheme() throws Exception {
    Context context = inst.getTargetContext(); MonoApp app = (MonoApp) context.getApplicationContext();
    String theme = app.prefs.getString("theme", "sakura"), lang = app.prefs.getString("lang", "ru");
    boolean autoScan = app.prefs.getBoolean("autoScan", true), history = app.prefs.getBoolean("history", true);
    int repeat = app.prefs.getInt("repeat", 0);
    float textScale = app.prefs.getFloat("textScale", 1);
    File wav = new File(context.getFilesDir(), "navigation-regression.wav"); RepositoryTest.writeWav(wav, 30);
    app.prefs.edit().putBoolean("autoScan", false).putBoolean("history", false).putString("lang", "ru").commit();
    app.io.submit(() -> { try { app.repo.importUri(Uri.fromFile(wav)); } catch (Exception e) { throw new RuntimeException(e); } }).get();
    inst.runOnMainSync(app::refresh);
    MainActivity activity = (MainActivity) inst.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    String[] trackId = {null};
    try {
      await(() -> field(activity, "player") != null && app.track(app.tracks.stream().filter(t -> t.uri.equals(Uri.fromFile(wav).toString())).findFirst().map(t -> t.id).orElse("")) != null);
      inst.runOnMainSync(() -> {
        Track track = app.tracks.stream().filter(t -> t.uri.equals(Uri.fromFile(wav).toString())).findFirst().orElseThrow(); trackId[0] = track.id;
        app.service.player.setMediaItems(List.of(track.mediaItem())); app.service.player.setRepeatMode(Player.REPEAT_MODE_ONE);
        app.service.player.prepare(); app.service.player.play();
      });
      await(() -> app.service.player.isPlaying());
      for (String saved : new String[]{"paper", "mist", "dark", "night", "sakura"}) {
        inst.runOnMainSync(() -> { app.prefs.edit().putString("theme", saved).putFloat("textScale", saved.equals("mist") ? 1.2f : 1).apply(); show(activity, 0); });
        inst.waitForIdleSync(); Thread.sleep(180);
        Rect[] anchor = {null}; inst.runOnMainSync(() -> anchor[0] = bounds(field(activity, "mobileDock")));
        for (String tab : new String[]{"Библиотека", "Инсайты", "Устройства", "Главная", "Инсайты"}) {
          inst.runOnMainSync(() -> { MobileDock dock = field(activity, "mobileDock"); View button = find(dock, tab); assertNotNull(button); button.performClick(); });
          inst.waitForIdleSync(); Thread.sleep(180);
          inst.runOnMainSync(() -> {
            MobileDock dock = field(activity, "mobileDock");
            assertEquals(saved + " dock shifted on " + tab, anchor[0], bounds(dock));
            assertTrue(saved + " must show pause during playback on " + tab, dock.playIcon.playing);
            assertEquals("Пауза", dock.playButton.getContentDescription());
          });
        }
        await(() -> ((ScrollView) field(activity, "insightsScroll")).getChildAt(0).getHeight() > 1000);
        app.io.submit(() -> {}).get(); inst.waitForIdleSync();
        ScrollView[] scroll = {null}; int[] position = {0};
        inst.runOnMainSync(() -> { scroll[0] = field(activity, "insightsScroll"); scroll[0].scrollTo(0, 500); position[0] = scroll[0].getScrollY(); assertTrue(position[0] > 100); app.refreshStats(); app.refreshStats(); });
        app.io.submit(() -> {}).get(); inst.waitForIdleSync(); Thread.sleep(250);
        inst.runOnMainSync(() -> { assertSame(scroll[0], field(activity, "insightsScroll")); assertEquals("Report jumped during refresh", position[0], scroll[0].getScrollY()); });
        inst.runOnMainSync(() -> { show(activity, 2); show(activity, 3); });
        inst.waitForIdleSync(); Thread.sleep(200);
        inst.runOnMainSync(() -> assertEquals("Report position lost on tab return", position[0], scroll[0].getScrollY()));
        inst.runOnMainSync(() -> { View panel = field(activity, "insightsPanel"); find(panel, "30 дней").performClick(); find(panel, "Всё время").performClick(); find(panel, "7 дней").performClick(); });
        app.io.submit(() -> {}).get(); inst.waitForIdleSync(); Thread.sleep(100);
        inst.runOnMainSync(() -> { View panel = field(activity, "insightsPanel"); assertTrue(find(panel, "7 дней").isSelected()); assertFalse(find(panel, "30 дней").isSelected()); });
        if ("true".equals(InstrumentationRegistry.getArguments().getString("mobileScreenshots"))) {
          inst.runOnMainSync(() -> scroll[0].scrollTo(0, 0)); inst.waitForIdleSync(); Thread.sleep(120);
          try (FileOutputStream out = new FileOutputStream(new File(context.getFilesDir(), "mobile-" + saved + ".png"))) { inst.getUiAutomation().takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, out); }
        }
        inst.runOnMainSync(() -> ((MobileDock) field(activity, "mobileDock")).playButton.performClick());
        await(() -> !app.service.player.getPlayWhenReady());
        inst.runOnMainSync(() -> show(activity, 1)); inst.waitForIdleSync();
        inst.runOnMainSync(() -> {
          List<InstrumentView> controls = field(activity, "plays"); assertFalse(controls.get(0).playing);
          List<View> buttons = field(activity, "playButtons"); buttons.get(0).performClick();
        });
        await(() -> app.service.player.isPlaying());
        inst.runOnMainSync(() -> { assertTrue(((List<InstrumentView>) field(activity, "plays")).get(0).playing); show(activity, 3); });
        await(() -> ((MobileDock) field(activity, "mobileDock")).playIcon.playing);
      }
    } finally {
      inst.runOnMainSync(() -> { if (app.service != null) { app.service.player.pause(); app.service.player.clearMediaItems(); } activity.finish(); });
      app.prefs.edit().putString("theme", theme).putString("lang", lang).putFloat("textScale", textScale).putInt("repeat", repeat).putBoolean("autoScan", autoScan).putBoolean("history", history).commit();
      if (trackId[0] != null) app.io.submit(() -> app.repo.getWritableDatabase().delete("tracks", "id=?", new String[]{trackId[0]})).get();
      wav.delete();
    }
  }
}
