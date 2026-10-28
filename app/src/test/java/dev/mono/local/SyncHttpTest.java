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
  @Test public void uploadStreamsToTemporaryFileAndCleansUpWithoutHoldingAudioInHeap()throws Exception{
    File directory=new File(System.getProperty("java.io.tmpdir"),"pain-http-"+java.util.UUID.randomUUID());assertTrue(directory.mkdirs());
    int size=5*1024*1024;byte[] header=("POST /api/upload-track HTTP/1.1\r\nContent-Length: "+size+"\r\n\r\n").getBytes(StandardCharsets.UTF_8);
    InputStream zeros=new InputStream(){int left=size;public int read(){return left-->0?42:-1;}public int read(byte[] b,int offset,int length){if(left==0)return -1;int n=Math.min(length,left);java.util.Arrays.fill(b,offset,offset+n,(byte)42);left-=n;return n;}};
    File upload;try(SyncHttp.Request request=SyncHttp.read(new SequenceInputStream(new ByteArrayInputStream(header),zeros),directory)){upload=request.bodyFile;assertNotNull(upload);assertEquals(size,upload.length());assertEquals(0,request.rawBody.length);assertEquals("{}",request.body);}
    assertFalse(upload.exists());assertTrue(directory.delete());
  }
  @Test public void rejectsBrowserWritesAndOversizedJsonBeforeReadingPayload()throws Exception{
    for(String header:new String[]{"Origin: https://evil.example","Origin: null","Sec-Fetch-Site: cross-site","Content-Length: 33554433"}){
      try{SyncHttp.read(input("POST /api/library HTTP/1.1\r\n"+header,""));fail(header);}catch(IOException expected){}
    }
    assertEquals("GET",SyncHttp.read(input("GET /api/track/song HTTP/1.1\r\nOrigin: http://localhost:3000","")).method);
    assertEquals("GET",SyncHttp.read(input("GET /api/track/song HTTP/1.1\r\nOrigin: http://192.168.1.12:3000","")).method);
    try{SyncHttp.read(input("GET /api/track/song HTTP/1.1\r\nOrigin: https://evil.example",""));fail();}catch(IOException expected){}
  }
  @Test public void interruptedUploadLeavesNoTemporaryFile()throws Exception{
    File directory=new File(System.getProperty("java.io.tmpdir"),"pain-http-"+java.util.UUID.randomUUID());assertTrue(directory.mkdirs());
    try{SyncHttp.read(input("POST /api/upload-track HTTP/1.1\r\nContent-Length: 100","partial"),directory);fail();}catch(EOFException expected){}
    assertEquals(0,directory.list().length);assertTrue(directory.delete());
  }
}
