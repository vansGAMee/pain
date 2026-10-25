package dev.mono.local;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** HTTP framing is byte based, including when JSON contains Cyrillic or emoji. */
final class SyncHttp {
  static final class Request {
    final String method, path, body;
    final byte[] rawBody;
    final java.util.Map<String, String> headers;

    Request(String method, String path, String body) {
      this(method, path, body, body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8), java.util.Collections.emptyMap());
    }

    Request(String method, String path, String body, byte[] rawBody, java.util.Map<String, String> headers) {
      this.method = method; this.path = path; this.body = body;
      this.rawBody = rawBody != null ? rawBody : new byte[0];
      this.headers = headers != null ? headers : java.util.Collections.emptyMap();
    }

    String getHeader(String name) {
      return headers.get(name.toLowerCase(Locale.ROOT));
    }
  }

  private static String line(InputStream in) throws IOException {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    for (int b; (b = in.read()) != -1;) {
      if (b == '\n') return bytes.toString(StandardCharsets.UTF_8.name()).replaceFirst("\\r$", "");
      if (bytes.size() >= 8192) throw new IOException("Header too long");
      bytes.write(b);
    }
    throw new EOFException("Incomplete HTTP header");
  }

  static Request read(InputStream in) throws IOException {
    String[] parts = line(in).split(" ");
    if (parts.length != 3) throw new IOException("Invalid request");
    int length = 0, headers = 0; boolean hasLength = false;
    java.util.Map<String, String> headerMap = new java.util.HashMap<>();
    for (String header; !(header = line(in)).isEmpty();) {
      if (++headers > 100) throw new IOException("Too many headers");
      int colon = header.indexOf(':');
      if (colon > 0) {
        String name = header.substring(0, colon).trim().toLowerCase(Locale.ROOT);
        String value = header.substring(colon + 1).trim();
        headerMap.put(name, value);
        if (name.equals("transfer-encoding")) throw new IOException("Unsupported framing");
        if (name.equals("content-length")) {
          int val;
          try { val = Integer.parseInt(value); }
          catch (NumberFormatException e) { throw new IOException("Invalid content length", e); }
          if (val < 0 || val > 128 * 1024 * 1024 || (hasLength && val != length)) throw new IOException("Invalid content length");
          length = val; hasLength = true;
        }
      }
    }
    byte[] bytes = new byte[length]; int read = 0;
    while (read < length) {
      int n = in.read(bytes, read, length - read);
      if (n == -1) throw new EOFException("Incomplete HTTP body");
      read += n;
    }
    boolean isBinary = parts[1].startsWith("/api/upload-track")
        || (headerMap.containsKey("content-type") && (headerMap.get("content-type").startsWith("audio/") || headerMap.get("content-type").equals("application/octet-stream")));
    String bodyStr = length == 0 ? "{}" : (isBinary ? "{}" : new String(bytes, StandardCharsets.UTF_8));
    return new Request(parts[0], parts[1], bodyStr, bytes, headerMap);
  }
}
