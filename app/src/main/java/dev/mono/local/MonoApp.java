package dev.mono.local;

import android.app.Application;
import android.content.SharedPreferences;
import android.database.ContentObserver;
import android.os.*;
import android.provider.MediaStore;
import java.util.*;
import java.util.concurrent.*;

public final class MonoApp extends Application {
  public final ExecutorService io = Executors.newSingleThreadExecutor();
  public final Handler main = new Handler(Looper.getMainLooper());
  public Repository repo;
  public SharedPreferences prefs;
  public volatile List<Track> tracks = List.of();
  public volatile Repository.Stats stats = new Repository.Stats();
  public final List<Runnable> listeners = new ArrayList<>();
  public PlaybackService service;
  public boolean scanning, ready;
  public String scanMessage = "";
  private ContentObserver observer;
  private final Runnable autoScan =
      () -> {
        if (prefs.getBoolean("autoScan", true) && hasPermission()) scan();
      };

  @Override
  public void onCreate() {
    super.onCreate();
    repo = new Repository(this);
    prefs = getSharedPreferences("mono", MODE_PRIVATE);
    refresh();
    observer =
        new ContentObserver(main) {
          @Override
          public void onChange(boolean self) {
            main.removeCallbacks(autoScan);
            main.postDelayed(autoScan, 1800);
          }
        };
    getContentResolver()
        .registerContentObserver(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, observer);
  }

  public boolean hasPermission() {
    return checkSelfPermission(
            Build.VERSION.SDK_INT >= 33
                ? "android.permission.READ_MEDIA_AUDIO"
                : "android.permission.READ_EXTERNAL_STORAGE")
        == android.content.pm.PackageManager.PERMISSION_GRANTED;
  }

  public void changed() {
    for (Runnable r : new ArrayList<>(listeners)) r.run();
  }

  public void refresh() {
    io.execute(
        () -> {
          List<Track> t = repo.tracks();
          Repository.Stats s = repo.stats(0);
          main.post(
              () -> {
                tracks = t;
                stats = s;
                ready = true;
                changed();
              });
        });
  }

  public void refreshStats() {
    io.execute(
        () -> {
          Repository.Stats s = repo.stats(0);
          main.post(
              () -> {
                stats = s;
                changed();
              });
        });
  }

  public void scan() {
    if (scanning) return;
    if (!hasPermission()) {
      scanMessage = "Разрешите доступ к аудио или выберите файлы.";
      changed();
      return;
    }
    scanning = true;
    scanMessage = "Читаем локальную медиатеку…";
    changed();
    io.execute(
        () -> {
          String msg;
          try {
            int n = repo.scan(prefs);
            Art.invalidate();
            msg = "Найдено треков: " + n;
          } catch (Exception e) {
            msg = "Сканирование: " + e.getMessage();
          }
          String result = msg;
          List<Track> t = repo.tracks();
          main.post(
              () -> {
                tracks = t;
                scanning = false;
                scanMessage = result;
                changed();
              });
        });
  }

  public Track track(String id) {
    for (Track t : tracks) if (t.id.equals(id)) return t;
    return null;
  }

  public List<Track> smartQueue(List<Track> input, String current) {
    List<Track> remaining = new ArrayList<>(input), result = new ArrayList<>();
    long now = System.currentTimeMillis();
    remaining.sort(
        Comparator.<Track>comparingDouble(
                t ->
                    stats.counts.getOrDefault(t.id, 0L) * 4
                        + (now - stats.last.getOrDefault(t.id, 0L) < 86400000 ? 10 : 0)
                        - (t.favorite ? 2 : 0))
            .thenComparing(t -> t.id));
    String artist = current;
    while (!remaining.isEmpty()) {
      int pick = 0;
      for (int i = 0; i < remaining.size(); i++)
        if (!remaining.get(i).artist.equals(artist)) {
          pick = i;
          break;
        }
      Track t = remaining.remove(pick);
      result.add(t);
      artist = t.artist;
    }
    return result;
  }
}
