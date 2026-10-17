package dev.mono.local;

import java.io.*;

public final class Io {
  public static byte[] read(InputStream in, int limit) throws IOException {
    try (in;
        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] b = new byte[8192];
      int count;
      while ((count = in.read(b, 0, Math.min(b.length, limit + 1 - out.size()))) > 0) {
        out.write(b, 0, count);
        if (out.size() > limit) throw new IOException("File exceeds " + limit + " bytes");
      }
      return out.toByteArray();
    }
  }
}
