package dev.mono.local;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

final class UpdateChecker {
  private static final String API = "https://api.github.com/repos/vansGAMee/pain/releases/latest";
  private static final Set<String> HOSTS = Set.of("api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "github-releases.githubusercontent.com");
  private static final AtomicBoolean BUSY = new AtomicBoolean();
  private static final long INTERVAL = 12 * 60 * 60 * 1000L;

  static void resume(MainActivity activity) {
    String pending = activity.getPreferences(Activity.MODE_PRIVATE).getString("pendingUpdate", "");
    if (!pending.isEmpty()) {
      File file = new File(pending);
      if (file.isFile() && (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls())) {
        if (install(activity, file))
          activity.getPreferences(Activity.MODE_PRIVATE).edit().remove("pendingUpdate").apply();
        return;
      }
    }
    check(activity, false);
  }

  static void check(MainActivity activity, boolean force) {
    MonoApp app = (MonoApp) activity.getApplication();
    long last = app.prefs.getLong("lastUpdateCheck", 0);
    if (!force && System.currentTimeMillis() - last < INTERVAL) return;
    if (!BUSY.compareAndSet(false, true)) return;
    app.io.execute(
        () -> {
          try {
            Release release = latest();
            app.prefs.edit().putLong("lastUpdateCheck", System.currentTimeMillis()).apply();
            if (newer(release.version, BuildConfig.VERSION_NAME))
              app.main.post(() -> offer(activity, release));
          } catch (Exception ignored) {
            // Updates never block startup or playback. A later launch retries.
          } finally {
            BUSY.set(false);
          }
        });
  }

  private static void offer(MainActivity activity, Release release) {
    if (activity.isFinishing() || activity.isDestroyed()) return;
    new AlertDialog.Builder(activity)
        .setTitle("Доступно обновление " + release.version)
        .setMessage("Pain загрузит официальный APK, проверит SHA‑256 и откроет системный установщик.")
        .setNegativeButton("Позже", null)
        .setPositiveButton("Обновить", (dialog, which) -> download(activity, release))
        .show();
  }

  private static void download(MainActivity activity, Release release) {
    MonoApp app = (MonoApp) activity.getApplication();
    Toast.makeText(activity, "Загрузка обновления…", Toast.LENGTH_SHORT).show();
    app.io.execute(
        () -> {
          File directory = new File(activity.getCacheDir(), "updates");
          File apk = new File(directory, release.apkName);
          try {
            if (!directory.exists() && !directory.mkdirs()) throw new IOException("Не удалось создать папку обновления");
            File[] old = directory.listFiles();
            if (old != null) for (File file : old) if (!file.equals(apk)) file.delete();
            String sums = new String(read(release.sumsUrl, 128 * 1024), java.nio.charset.StandardCharsets.UTF_8);
            String expected = checksum(sums, release.apkName);
            if (expected == null) throw new IOException("В релизе нет контрольной суммы APK");
            String actual = download(release.apkUrl, apk, 150 * 1024 * 1024);
            if (!expected.equals(actual)) { apk.delete(); throw new IOException("Контрольная сумма не совпала"); }
            activity.getPreferences(Activity.MODE_PRIVATE).edit().putString("pendingUpdate", apk.getAbsolutePath()).apply();
            app.main.post(() -> requestInstall(activity, apk));
          } catch (Exception error) {
            apk.delete();
            app.main.post(() -> Toast.makeText(activity, "Не удалось обновить Pain", Toast.LENGTH_LONG).show());
          }
        });
  }

  private static void requestInstall(MainActivity activity, File apk) {
    if (activity.isFinishing() || activity.isDestroyed()) return;
    if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
      new AlertDialog.Builder(activity)
          .setTitle("Разрешите установку обновлений")
          .setMessage("Android требует один раз разрешить Pain устанавливать скачанный APK. После возврата установка продолжится.")
          .setNegativeButton("Отмена", null)
          .setPositiveButton("Открыть настройки", (dialog, which) -> {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
          })
          .show();
      return;
    }
    if (install(activity, apk))
      activity.getPreferences(Activity.MODE_PRIVATE).edit().remove("pendingUpdate").apply();
  }

  private static boolean install(Activity activity, File apk) {
    try {
      Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", apk);
      Intent intent = new Intent(Intent.ACTION_VIEW, uri)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
      activity.startActivity(intent);
      return true;
    } catch (RuntimeException error) {
      Toast.makeText(activity, "Не удалось открыть установщик Android", Toast.LENGTH_LONG).show();
      return false;
    }
  }

  private static Release latest() throws Exception {
    JSONObject json = new JSONObject(new String(read(API, 1024 * 1024), java.nio.charset.StandardCharsets.UTF_8));
    String version = json.optString("tag_name").replaceFirst("^[vV]", "");
    String apkName = "Pain-v" + version + "-Android.apk", sumsName = "SHA256SUMS-v" + version + ".txt";
    String apkUrl = null, sumsUrl = null;
    JSONArray assets = json.optJSONArray("assets");
    if (assets != null) for (int i = 0; i < assets.length(); i++) {
      JSONObject item = assets.getJSONObject(i);
      if (apkName.equals(item.optString("name"))) apkUrl = item.optString("browser_download_url");
      if (sumsName.equals(item.optString("name"))) sumsUrl = item.optString("browser_download_url");
    }
    if (!validVersion(version) || apkUrl == null || sumsUrl == null) throw new IOException("Неполный релиз");
    return new Release(version, apkName, apkUrl, sumsUrl);
  }

  static boolean newer(String candidate, String current) {
    int[] a = parts(candidate), b = parts(current);
    if (a == null || b == null) return false;
    for (int i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] > b[i];
    return false;
  }

  private static boolean validVersion(String value) { return parts(value) != null; }
  private static int[] parts(String value) {
    String clean = String.valueOf(value).trim();
    if (!clean.matches("^[vV]?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:[-+][0-9A-Za-z.-]+)?$")) return null;
    String[] values = clean.replaceFirst("^[vV]", "").split("[-+]", 2)[0].split("\\.");
    if (values.length != 3) return null;
    try { return new int[] {Integer.parseInt(values[0]), Integer.parseInt(values[1]), Integer.parseInt(values[2])}; }
    catch (NumberFormatException error) { return null; }
  }

  static String checksum(String contents, String filename) {
    for (String line : contents.split("\\r?\\n")) {
      String[] fields = line.trim().split("\\s+", 2);
      if (fields.length == 2 && fields[0].matches("(?i)[a-f0-9]{64}") && fields[1].replaceFirst("^\\*", "").equals(filename))
        return fields[0].toLowerCase(Locale.ROOT);
    }
    return null;
  }

  private static byte[] read(String url, int limit) throws Exception {
    HttpURLConnection connection = open(url, 5);
    try {
      if (connection.getResponseCode() != 200) throw new IOException("HTTP " + connection.getResponseCode());
      return Io.read(connection.getInputStream(), limit);
    } finally { connection.disconnect(); }
  }

  private static String download(String url, File destination, int limit) throws Exception {
    HttpURLConnection connection = open(url, 5);
    try {
      if (connection.getResponseCode() != 200) throw new IOException("HTTP " + connection.getResponseCode());
      int declared = connection.getContentLength();
      if (declared > limit) throw new IOException("APK слишком большой");
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      int total = 0;
      try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(destination)) {
        byte[] buffer = new byte[32 * 1024]; int count;
        while ((count = in.read(buffer)) != -1) {
          total += count; if (total > limit) throw new IOException("APK слишком большой");
          digest.update(buffer, 0, count); out.write(buffer, 0, count);
        }
        out.getFD().sync();
      }
      StringBuilder hex = new StringBuilder();
      for (byte value : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", value & 255));
      return hex.toString();
    } finally { connection.disconnect(); }
  }

  private static HttpURLConnection open(String value, int redirects) throws Exception {
    URL url = new URL(value);
    if (!"https".equals(url.getProtocol()) || !HOSTS.contains(url.getHost())) throw new IOException("Недоверенный адрес обновления");
    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
    connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
    connection.setRequestProperty("User-Agent", "Pain-Android-Updater");
    connection.setRequestProperty("Accept", "application/vnd.github+json");
    int code = connection.getResponseCode();
    if (code / 100 == 3 && redirects > 0) {
      String location = connection.getHeaderField("Location"); connection.disconnect();
      if (location == null) throw new IOException("Пустое перенаправление");
      return open(new URL(url, location).toString(), redirects - 1);
    }
    return connection;
  }

  private record Release(String version, String apkName, String apkUrl, String sumsUrl) {}
}
