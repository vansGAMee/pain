package dev.mono.local;

import android.content.ContentUris;
import android.content.Context;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.provider.MediaStore;
import android.text.format.Formatter;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/**
 * Lightweight local network synchronization server.
 * Enables zero-config auto-discovery (UDP 8766) and fast HTTP data transfer (Port 8765)
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
    try (InputStream in = socket.getInputStream();
         OutputStream out = socket.getOutputStream()) {

      BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
      String requestLine = reader.readLine();
      if (requestLine == null || requestLine.isBlank()) return;

      String[] parts = requestLine.split(" ");
      if (parts.length < 2) return;
      String method = parts[0];
      String path = parts[1];

      int contentLength = 0;
      String line;
      while ((line = reader.readLine()) != null && !line.isEmpty()) {
        if (line.toLowerCase().startsWith("content-length:")) {
          try {
            contentLength = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
          } catch (Exception ignored) {}
        }
      }

      if ("OPTIONS".equalsIgnoreCase(method)) {
        sendResponse(out, 200, "OK", "text/plain", "OK");
        return;
      }

      if ("/api/status".equals(path)) {
        String json = String.format(
            "{\"status\":\"ok\",\"device\":\"Android\",\"appName\":\"Pain\",\"tracks\":%d,\"timestamp\":%d}",
            app.tracks.size(), System.currentTimeMillis());
        sendResponse(out, 200, "OK", "application/json", json);
      } else if ("/api/library".equals(path) && "GET".equalsIgnoreCase(method)) {
        String json = app.repo.exportLibraryJson();
        sendResponse(out, 200, "OK", "application/json", json);
        notifyListener("library_exported", app.tracks.size() + " tracks");
      } else if ("/api/library".equals(path) && "POST".equalsIgnoreCase(method)) {
        String body = readBody(reader, contentLength);
        int merged = app.repo.importJson(body);
        app.refresh();
        sendResponse(out, 200, "OK", "application/json", "{\"status\":\"ok\",\"merged\":" + merged + "}");
        notifyListener("library_merged", merged + " items");
      } else if ("/api/stats".equals(path) && "GET".equalsIgnoreCase(method)) {
        String json = app.repo.exportStatsJson();
        sendResponse(out, 200, "OK", "application/json", json);
        notifyListener("stats_exported", "Stats sent");
      } else if ("/api/stats".equals(path) && "POST".equalsIgnoreCase(method)) {
        String body = readBody(reader, contentLength);
        int merged = app.repo.importJson(body);
        app.refresh();
        sendResponse(out, 200, "OK", "application/json", "{\"status\":\"ok\",\"merged\":" + merged + "}");
        notifyListener("stats_merged", merged + " stats items");
      } else if ("/api/favorite".equals(path) && "POST".equalsIgnoreCase(method)) {
        String body = readBody(reader, contentLength);
        org.json.JSONObject obj = new org.json.JSONObject(body);
        String trackId = obj.getString("trackId");
        boolean favorite = obj.optBoolean("favorite", obj.optInt("favorite", 0) == 1);
        app.repo.favorite(trackId, favorite);
        app.refresh();
        sendResponse(out, 200, "OK", "application/json", "{\"status\":\"ok\",\"favorite\":" + (favorite ? 1 : 0) + "}");
        notifyListener("favorite_synced", trackId + ": " + favorite);
      } else if ("/api/record-play".equals(path) && "POST".equalsIgnoreCase(method)) {
        String body = readBody(reader, contentLength);
        org.json.JSONObject obj = new org.json.JSONObject(body);
        String trackId = obj.getString("track");
        long heard = obj.optLong("heard", 0);
        long started = obj.optLong("started", System.currentTimeMillis());
        long duration = obj.optLong("duration", heard);
        boolean finished = obj.optBoolean("finished", true);
        String playId = "pc_" + System.currentTimeMillis() + "_" + (int)(Math.random() * 10000);
        app.repo.record(playId, trackId, "pc_companion", started, duration, System.currentTimeMillis(), heard, heard, finished, false);
        app.refresh();
        sendResponse(out, 200, "OK", "application/json", "{\"status\":\"ok\",\"playId\":\"" + playId + "\"}");
        notifyListener("play_recorded", trackId + " (" + (heard / 1000) + "s)");
      } else if (path.startsWith("/api/track/") && ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method))) {
        String trackId = URLDecoder.decode(path.substring("/api/track/".length()), StandardCharsets.UTF_8);
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

  private String readBody(BufferedReader reader, int length) throws IOException {
    if (length <= 0) return "{}";
    char[] buf = new char[length];
    int read = 0;
    while (read < length) {
      int r = reader.read(buf, read, length - read);
      if (r == -1) break;
      read += r;
    }
    return new String(buf, 0, read);
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
