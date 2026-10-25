package dev.mono.local;

import android.content.ContentUris;
import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.format.Formatter;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.*;

/**
 * Lightweight local network synchronization server.
 * Enables zero-config auto-discovery (UDP 8866) and fast HTTP data transfer (Port 8865)
 * between the mobile app and the Windows desktop companion.
 */
public final class SyncServer {
  public static final int HTTP_PORT = 8865;
  public static final int UDP_PORT = 8866;

  private final MonoApp app;
  private final ExecutorService threadPool = Executors.newCachedThreadPool();
  private ServerSocket serverSocket;
  private DatagramSocket udpSocket;
  private volatile boolean running = false;
  private SyncListener listener;

  public interface SyncListener {
    void onSyncEvent(String event, String detail);
  }

  public SyncServer(MonoApp app) {
    this.app = app;
  }

  public void setListener(SyncListener listener) {
    this.listener = listener;
  }

  public synchronized void start() {
    if (running) return;
    running = true;

    // Start HTTP Server
    threadPool.execute(() -> {
      try {
        serverSocket = new ServerSocket(HTTP_PORT);
        notifyListener("server_started", getLocalIp() + ":" + HTTP_PORT);
        while (running && !serverSocket.isClosed()) {
          try {
            Socket client = serverSocket.accept();
            threadPool.execute(() -> handleClient(client));
          } catch (IOException e) {
            if (!running) break;
          }
        }
      } catch (Exception e) {
        notifyListener("server_error", e.getMessage());
      }
    });

    // Start UDP Discovery Listener
    threadPool.execute(() -> {
      byte[] buf = new byte[1024];
      try {
        udpSocket = new DatagramSocket(UDP_PORT);
        udpSocket.setBroadcast(true);
        while (running && !udpSocket.isClosed()) {
          DatagramPacket packet = new DatagramPacket(buf, buf.length);
          udpSocket.receive(packet);
          String message = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8).trim();
          if (message.startsWith("PAIN_DISCOVERY")) {
            String reply = "PAIN_DEVICE|Android|" + HTTP_PORT + "|" + app.tracks.size();
            byte[] replyBytes = reply.getBytes(StandardCharsets.UTF_8);
            DatagramPacket replyPacket = new DatagramPacket(replyBytes, replyBytes.length, packet.getAddress(), packet.getPort());
            udpSocket.send(replyPacket);
            notifyListener("peer_discovered", packet.getAddress().getHostAddress());
          }
        }
      } catch (Exception ignored) {
        // UDP socket closed or network error
      }
    });

    // Periodically broadcast presence to LAN every 3 seconds
    threadPool.execute(() -> {
      while (running) {
        try {
          if (udpSocket != null && !udpSocket.isClosed()) {
            String announcement = "PAIN_DEVICE|Android|" + HTTP_PORT + "|" + app.tracks.size();
            byte[] bytes = announcement.getBytes(StandardCharsets.UTF_8);
            DatagramPacket packet = new DatagramPacket(bytes, bytes.length, InetAddress.getByName("255.255.255.255"), UDP_PORT);
            udpSocket.send(packet);
          }
        } catch (Exception ignored) {}
        try {
          Thread.sleep(3000);
        } catch (InterruptedException e) {
          break;
        }
      }
    });
  }

  public synchronized void stop() {
    running = false;
    try {
      if (serverSocket != null) serverSocket.close();
    } catch (Exception ignored) {}
    try {
      if (udpSocket != null) udpSocket.close();
    } catch (Exception ignored) {}
    notifyListener("server_stopped", "");
  }

  public boolean isRunning() {
    return running;
  }

  public String getLocalIp() {
    try {
      WifiManager wm = (WifiManager) app.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
      if (wm != null && wm.getConnectionInfo() != null) {
        int ip = wm.getConnectionInfo().getIpAddress();
        if (ip != 0) {
          return Formatter.formatIpAddress(ip);
        }
      }
    } catch (Exception ignored) {}

    try {
      for (NetworkInterface n : java.util.Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (n.isLoopback() || !n.isUp()) continue;
        for (InetAddress addr : java.util.Collections.list(n.getInetAddresses())) {
          if (!addr.isLoopbackAddress() && addr instanceof Inet4Address) {
            return addr.getHostAddress();
          }
        }
      }
    } catch (Exception ignored) {}
    return "127.0.0.1";
  }

  public void broadcastDiscovery() {
    threadPool.execute(() -> {
      try (DatagramSocket s = new DatagramSocket()) {
        s.setBroadcast(true);
        byte[] data = "PAIN_DISCOVERY".getBytes(StandardCharsets.UTF_8);
        DatagramPacket p = new DatagramPacket(data, data.length, InetAddress.getByName("255.255.255.255"), UDP_PORT);
        s.send(p);
      } catch (Exception ignored) {}
    });
  }

  private void notifyListener(String event, String detail) {
    if (listener != null) {
      listener.onSyncEvent(event, detail);
    }
  }

  private void handleClient(Socket socket) {
    try (InputStream in = new BufferedInputStream(socket.getInputStream());
         OutputStream out = socket.getOutputStream()) {

      socket.setSoTimeout(30000);
      SyncHttp.Request request = SyncHttp.read(in);
      String method = request.method, path = request.path;
      String cleanPath = path.contains("?") ? path.substring(0, path.indexOf('?')) : path;

      if ("OPTIONS".equalsIgnoreCase(method)) {
        sendResponse(out, 200, "OK", "text/plain", "OK");
        return;
      }

      if ("/api/status".equals(cleanPath)) {
        String json = String.format(
            "{\"status\":\"ok\",\"device\":\"Android\",\"appName\":\"Pain\",\"tracks\":%d,\"timestamp\":%d}",
            app.tracks.size(), System.currentTimeMillis());
        sendResponse(out, 200, "OK", "application/json", json);
      } else if ("/api/upload-track".equals(cleanPath) && "POST".equalsIgnoreCase(method)) {
        handleUploadTrack(request, out);
      } else if ("/api/dj-state".equals(cleanPath) && "GET".equalsIgnoreCase(method)) {
        sendResponse(out,200,"OK","application/json",app.music.exportState());
      } else if ("/api/dj-state".equals(cleanPath) && "POST".equalsIgnoreCase(method)) {
        sendResponse(out,200,"OK","application/json",app.music.mergeState(request.body));
      } else if ("/api/library".equals(cleanPath) && "GET".equalsIgnoreCase(method)) {
        String json = app.repo.exportLibraryJson();
        sendResponse(out, 200, "OK", "application/json", json);
        notifyListener("library_exported", app.tracks.size() + " tracks");
      } else if ("/api/library".equals(cleanPath) && "POST".equalsIgnoreCase(method)) {
        String body = request.body;
        int merged = app.repo.importJson(body);
        app.refresh();
        sendResponse(out, 200, "OK", "application/json", "{\"status\":\"ok\",\"merged\":" + merged + "}");
        notifyListener("library_merged", merged + " items");
      } else if ("/api/stats".equals(cleanPath) && "GET".equalsIgnoreCase(method)) {
        String json = app.repo.exportStatsJson();
        sendResponse(out, 200, "OK", "application/json", json);
        notifyListener("stats_exported", "Stats sent");
      } else if ("/api/stats".equals(cleanPath) && "POST".equalsIgnoreCase(method)) {
        String body = request.body;
        int merged = app.repo.importJson(body);
        app.refresh();
        sendResponse(out, 200, "OK", "application/json", "{\"status\":\"ok\",\"merged\":" + merged + "}");
        notifyListener("stats_merged", merged + " stats items");
      } else if ("/api/favorite".equals(cleanPath) && "POST".equalsIgnoreCase(method)) {
        String body = request.body;
        org.json.JSONObject obj = new org.json.JSONObject(body);
        String trackId = obj.getString("trackId");
        boolean favorite = obj.optBoolean("favorite", obj.optInt("favorite", 0) == 1);
        app.repo.favorite(trackId, favorite);
        app.refresh();
        sendResponse(out, 200, "OK", "application/json", "{\"status\":\"ok\",\"favorite\":" + (favorite ? 1 : 0) + "}");
        notifyListener("favorite_synced", trackId + ": " + favorite);
      } else if ("/api/record-play".equals(cleanPath) && "POST".equalsIgnoreCase(method)) {
        String body = request.body;
        org.json.JSONObject obj = new org.json.JSONObject(body);
        String trackId = obj.getString("track");
        long heard = obj.optLong("heard", 0);
        long started = obj.optLong("started", System.currentTimeMillis());
        long duration = obj.optLong("duration", heard);
        // Stable identity and absolute counters make a retry safe after a lost response.
        String playId = obj.optString("id", "pc_" + java.util.UUID.nameUUIDFromBytes(
            (trackId + "\0" + started).getBytes(StandardCharsets.UTF_8)));
        obj.put("id", playId);
        if (!obj.has("session")) obj.put("session", "pc_companion");
        obj.put("started", started); obj.put("duration", duration);
        app.repo.importJson(new org.json.JSONObject().put("plays", new org.json.JSONArray().put(obj)).toString());
        app.refresh();
        sendResponse(out, 200, "OK", "application/json", new org.json.JSONObject().put("status", "ok").put("playId", playId).toString());
        notifyListener("play_recorded", trackId + " (" + (heard / 1000) + "s)");
      } else if (cleanPath.startsWith("/api/track/") && ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method))) {
        String trackId = URLDecoder.decode(cleanPath.substring("/api/track/".length()), StandardCharsets.UTF_8.name());
        streamTrack(trackId, out);
      } else {
        sendResponse(out, 404, "Not Found", "text/plain", "Not Found");
      }
    } catch (Exception ignored) {}
    finally {
      try {
        socket.close();
      } catch (Exception ignored) {}
    }
  }

  private void handleUploadTrack(SyncHttp.Request request, OutputStream out) throws IOException {
    if (request.rawBody == null || request.rawBody.length < 512) {
      sendResponse(out, 400, "Bad Request", "application/json", "{\"error\":\"Empty or invalid audio payload\"}");
      return;
    }

    java.util.Map<String, String> params = new java.util.HashMap<>();
    if (request.path.contains("?")) {
      String query = request.path.substring(request.path.indexOf('?') + 1);
      for (String pair : query.split("&")) {
        int eq = pair.indexOf('=');
        if (eq > 0) {
          try {
            String k = URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8.name());
            String v = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8.name());
            params.put(k, v);
          } catch (Exception ignored) {}
        }
      }
    }

    String filename = params.get("filename");
    if (filename == null || filename.trim().isEmpty()) {
      filename = request.getHeader("x-filename");
      if (filename != null) {
        try { filename = URLDecoder.decode(filename, StandardCharsets.UTF_8.name()); } catch (Exception ignored) {}
      }
    }
    if (filename == null || filename.trim().isEmpty()) {
      filename = "track_" + System.currentTimeMillis() + ".mp3";
    }
    String safeName = filename.replaceAll("[/\\\\?%*:|\"<>]", "_").trim();
    if (safeName.isEmpty()) safeName = "track_" + System.currentTimeMillis() + ".mp3";

    File musicDir = app.getExternalFilesDir(Environment.DIRECTORY_MUSIC);
    if (musicDir == null) {
      musicDir = new File(app.getFilesDir(), "music");
    }
    if (!musicDir.exists()) musicDir.mkdirs();

    File dest = new File(musicDir, safeName);
    File tmpDest = new File(musicDir, safeName + "." + UUID.randomUUID().toString() + ".tmp");

    try (FileOutputStream fos = new FileOutputStream(tmpDest)) {
      fos.write(request.rawBody);
      fos.flush();
    }

    if (dest.exists()) {
      try { dest.delete(); } catch (Exception ignored) {}
    }
    if (!tmpDest.renameTo(dest)) {
      try (FileInputStream fis = new FileInputStream(tmpDest);
           FileOutputStream fos = new FileOutputStream(dest)) {
        byte[] buf = new byte[65536];
        int n;
        while ((n = fis.read(buf)) != -1) fos.write(buf, 0, n);
        fos.flush();
      }
      try { tmpDest.delete(); } catch (Exception ignored) {}
    }

    String title = params.get("title");
    if (title == null || title.trim().isEmpty()) {
      String hTitle = request.getHeader("x-title");
      if (hTitle != null) {
        try { title = URLDecoder.decode(hTitle, StandardCharsets.UTF_8.name()); } catch (Exception ignored) {}
      }
    }
    String artist = params.get("artist");
    if (artist == null || artist.trim().isEmpty()) {
      String hArtist = request.getHeader("x-artist");
      if (hArtist != null) {
        try { artist = URLDecoder.decode(hArtist, StandardCharsets.UTF_8.name()); } catch (Exception ignored) {}
      }
    }
    String album = params.get("album");
    if (album == null || album.trim().isEmpty()) {
      String hAlbum = request.getHeader("x-album");
      if (hAlbum != null) {
        try { album = URLDecoder.decode(hAlbum, StandardCharsets.UTF_8.name()); } catch (Exception ignored) {}
      }
    }
    long duration = 0;

    try {
      MediaMetadataRetriever mmr = new MediaMetadataRetriever();
      mmr.setDataSource(dest.getAbsolutePath());
      String tTitle = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
      String tArtist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
      String tAlbum = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
      String tDur = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
      if (tTitle != null && !tTitle.trim().isEmpty()) title = tTitle.trim();
      if (tArtist != null && !tArtist.trim().isEmpty()) artist = tArtist.trim();
      if (tAlbum != null && !tAlbum.trim().isEmpty()) album = tAlbum.trim();
      if (tDur != null) {
        try { duration = Long.parseLong(tDur); } catch (Exception ignored) {}
      }
      mmr.release();
    } catch (Exception ignored) {}

    if (title == null || title.trim().isEmpty()) {
      String fn = dest.getName();
      int dot = fn.lastIndexOf('.');
      title = dot > 0 ? fn.substring(0, dot) : fn;
    }
    if (artist == null || artist.trim().isEmpty()) {
      artist = "Загружено с ПК";
    }
    if (album == null || album.trim().isEmpty()) {
      album = "PC Library";
    }
    if (duration <= 0) {
      String dStr = params.get("duration");
      if (dStr != null) {
        try { duration = Long.parseLong(dStr); } catch (Exception ignored) {}
      }
      if (duration <= 0) duration = 180000;
    }

    String ext = dest.getName().toLowerCase(Locale.ROOT);
    String mime = "audio/mpeg";
    if (ext.endsWith(".flac")) mime = "audio/flac";
    else if (ext.endsWith(".wav")) mime = "audio/wav";
    else if (ext.endsWith(".m4a")) mime = "audio/mp4";
    else if (ext.endsWith(".ogg")) mime = "audio/ogg";

    // Keep the desktop identity so likes, history and cached audio round-trip.
    String trackId = params.get("trackId");
    if (trackId == null || !trackId.matches("pc_upload_[0-9a-f]{16}")) {
      byte[] digest;
      try {
        digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(dest.getName().getBytes(StandardCharsets.UTF_8));
      } catch (java.security.NoSuchAlgorithmException e) {
        throw new IOException("SHA-256 unavailable", e);
      }
      StringBuilder hex = new StringBuilder();
      for (int i = 0; i < 8; i++) hex.append(String.format(Locale.ROOT, "%02x", digest[i] & 0xff));
      trackId = "pc_upload_" + hex;
    }

    Track newTrack = new Track(
        trackId,
        Uri.fromFile(dest).toString(),
        title,
        artist,
        album,
        dest.getParentFile() != null ? dest.getParentFile().getName() : "Music",
        mime,
        duration,
        dest.length(),
        System.currentTimeMillis() / 1000,
        0,
        0,
        false
    );

    app.repo.addTrack(newTrack);
    app.refresh();

    try {
      org.json.JSONObject resp = new org.json.JSONObject();
      resp.put("status", "ok");
      resp.put("trackId", trackId);
      resp.put("title", title);
      resp.put("artist", artist);
      resp.put("uri", Uri.fromFile(dest).toString());
      sendResponse(out, 200, "OK", "application/json", resp.toString());
      notifyListener("track_uploaded", title + " - " + artist);
    } catch (org.json.JSONException e) {
      sendResponse(out, 500, "Error", "application/json", "{\"error\":\"JSON error\"}");
    }
  }

  private void streamTrack(String trackId, OutputStream out) {
    Track target = null;
    for (Track t : app.tracks) {
      if (t.id.equals(trackId)) {
        target = t;
        break;
      }
    }
    if (target == null) {
      try {
        sendResponse(out, 404, "Not Found", "text/plain", "Track not found: " + trackId);
      } catch (Exception ignored) {}
      return;
    }

    InputStream fileIn = null;
    try {
      if (target.uri != null && !target.uri.isEmpty()) {
        try {
          if (target.uri.startsWith("content://")) {
            fileIn = app.getContentResolver().openInputStream(Uri.parse(target.uri));
          } else if (target.uri.startsWith("file://")) {
            fileIn = new FileInputStream(new File(Uri.parse(target.uri).getPath()));
          } else {
            fileIn = new FileInputStream(new File(target.uri));
          }
        } catch (Exception ignored) {}
      }

      if (fileIn == null) {
        try {
          if (trackId.startsWith("media:")) {
            long mediaId = Long.parseLong(trackId.substring("media:".length()));
            Uri contentUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId);
            fileIn = app.getContentResolver().openInputStream(contentUri);
          }
        } catch (Exception ignored) {}
      }

      if (fileIn == null) {
        sendResponse(out, 404, "Not Found", "text/plain", "File unreadable");
        return;
      }
      String mime = target.mime != null && !target.mime.isEmpty() ? target.mime : "audio/mpeg";
      String header = "HTTP/1.1 200 OK\r\n"
          + "Content-Type: " + mime + "\r\n"
          + "Content-Length: " + target.bytes + "\r\n"
          + "Accept-Ranges: bytes\r\n"
          + "Access-Control-Allow-Origin: *\r\n"
          + "Connection: close\r\n\r\n";
      out.write(header.getBytes(StandardCharsets.UTF_8));

      byte[] buffer = new byte[65536];
      int n;
      while ((n = fileIn.read(buffer)) != -1) {
        out.write(buffer, 0, n);
      }
      out.flush();
    } catch (Exception e) {
      try {
        sendResponse(out, 500, "Error", "text/plain", "Error: " + e.getMessage());
      } catch (Exception ignored) {}
    } finally {
      if (fileIn != null) {
        try {
          fileIn.close();
        } catch (Exception ignored) {}
      }
    }
  }

  private void sendResponse(OutputStream out, int code, String msg, String mime, String content) throws IOException {
    byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
    String header = "HTTP/1.1 " + code + " " + msg + "\r\n"
        + "Content-Type: " + mime + "; charset=utf-8\r\n"
        + "Content-Length: " + bytes.length + "\r\n"
        + "Access-Control-Allow-Origin: *\r\n"
        + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        + "Access-Control-Allow-Headers: Content-Type\r\n"
        + "Connection: close\r\n\r\n";
    out.write(header.getBytes(StandardCharsets.UTF_8));
    out.write(bytes);
    out.flush();
  }
}
