package dev.mono.local;

import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class SyncHttpTest {
  private InputStream input(String header, String body) {
    return new ByteArrayInputStream((header + "\r\n\r\n" + body).getBytes(StandardCharsets.UTF_8));
  }
  @Test public void unicodeUsesByteLengthAndDoesNotConsumeNextRequest() throws Exception {
    String json = "{\"track\":\"Песня 🎵\",\"favorite\":1}";
    InputStream in = input("POST /api/library HTTP/1.1\r\nContent-Length: " + json.getBytes(StandardCharsets.UTF_8).length, json + "NEXT");
    SyncHttp.Request request = SyncHttp.read(in);
    assertEquals(json, request.body); assertEquals("POST", request.method); assertEquals("/api/library", request.path);
    assertEquals('N', in.read());
  }
  @Test public void rejectsTruncatedNegativeAndConflictingLengths() throws Exception {
    for (String headers : new String[] {"Content-Length: 10", "Content-Length: -1", "Content-Length: 999999999", "Content-Length: 2\r\nContent-Length: 3", "Transfer-Encoding: chunked"}) {
      try { SyncHttp.read(input("POST /api/stats HTTP/1.1\r\n" + headers, "{}")); fail(headers); }
      catch (IOException expected) {}
    }
  }
  @Test public void acceptsGetWithoutBody() throws Exception {
    SyncHttp.Request request = SyncHttp.read(input("GET /api/stats HTTP/1.1", ""));
    assertEquals("GET", request.method); assertEquals("{}", request.body);
  }
  @Test public void preservesRawBinaryBytesAndHeadersForTrackUpload() throws Exception {
    byte[] audioDummy = new byte[] { (byte)0xFF, (byte)0xFB, (byte)0x90, (byte)0x64, 0x00, 0x01, 0x02 };
    ByteArrayOutputStream stream = new ByteArrayOutputStream();
    stream.write("POST /api/upload-track?filename=test.mp3 HTTP/1.1\r\nContent-Type: audio/mpeg\r\nContent-Length: 7\r\nX-Track-Artist: Queen\r\n\r\n".getBytes(StandardCharsets.UTF_8));
    stream.write(audioDummy);
    SyncHttp.Request request = SyncHttp.read(new ByteArrayInputStream(stream.toByteArray()));
    assertEquals("POST", request.method);
    assertEquals("/api/upload-track?filename=test.mp3", request.path);
    assertEquals("Queen", request.getHeader("x-track-artist"));
    assertEquals(7, request.rawBody.length);
    assertArrayEquals(audioDummy, request.rawBody);
    assertEquals("{}", request.body); // Binary bodies don't waste heap on UTF-8 stringification
  }
}
