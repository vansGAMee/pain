package dev.mono.local;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** HTTP framing is byte based, including when JSON contains Cyrillic or emoji. */
final class SyncHttp {
  static final class Request {
    final String method, path, body;
    Request(String method, String path, String body) {
      this.method = method; this.path = path; this.body = body;
    }
  }

  private static String line(InputStream in) throws IOException {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    for (int b; (b = in.read()) != -1;) {
      if (b == '\n') return bytes.toString("US-ASCII").replaceFirst("\\r$", "");
      if (bytes.size() >= 8192) throw new IOException("Header too long");
      bytes.write(b);
    }
    throw new EOFException("Incomplete HTTP header");
  }

  static Request read(InputStream in) throws IOException {
    String[] parts = line(in).split(" ");
    if (parts.length != 3) throw new IOException("Invalid request");
    int length = 0, headers = 0; boolean hasLength = false;
    for (String header; !(header = line(in)).isEmpty();) {
      if (++headers > 100) throw new IOException("Too many headers");
      String name = header.substring(0, Math.max(0, header.indexOf(':'))).toLowerCase(Locale.ROOT);
      if (name.equals("transfer-encoding")) throw new IOException("Unsupported framing");
      if (name.equals("content-length")) {
        int value;
        try { value = Integer.parseInt(header.substring(header.indexOf(':') + 1).trim()); }
        catch (NumberFormatException e) { throw new IOException("Invalid content length", e); }
        if (value < 0 || value > 32 * 1024 * 1024 || hasLength && value != length) throw new IOException("Invalid content length");
        length = value; hasLength = true;
      }
    }
    byte[] bytes = new byte[length]; int read = 0;
    while (read < length) {
      int n = in.read(bytes, read, length - read);
      if (n == -1) throw new EOFException("Incomplete HTTP body");
      read += n;
    }
    return new Request(parts[0], parts[1], length == 0 ? "{}" : new String(bytes, StandardCharsets.UTF_8));
  }
}
