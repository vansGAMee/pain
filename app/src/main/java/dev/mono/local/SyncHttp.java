package dev.mono.local;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** HTTP framing is byte based, including when JSON contains Cyrillic or emoji. */
final class SyncHttp {
  static final class Request implements Closeable {
    final String method, path, body;
    final byte[] rawBody;
    final java.util.Map<String, String> headers;
    File bodyFile;

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
    public void close(){if(bodyFile!=null)bodyFile.delete();}
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
    return read(in,null);
  }

  static Request read(InputStream in,File temporaryDirectory) throws IOException {
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
    boolean isBinary = parts[1].startsWith("/api/upload-track")
        || (headerMap.containsKey("content-type") && (headerMap.get("content-type").startsWith("audio/") || headerMap.get("content-type").equals("application/octet-stream")));
    if(!isBinary&&length>32*1024*1024)throw new IOException("JSON body too large");
    String origin=headerMap.get("origin");boolean audio=(parts[0].equals("GET")||parts[0].equals("HEAD"))&&parts[1].startsWith("/api/track/");
    if(origin!=null&&(!audio||!localOrigin(origin)))throw new IOException("Browser origin denied");
    if("cross-site".equals(headerMap.get("sec-fetch-site"))&&!audio)throw new IOException("Cross-site request denied");
    if(isBinary&&temporaryDirectory!=null){
      File file=File.createTempFile("sync-upload-",".tmp",temporaryDirectory);boolean complete=false;
      try(OutputStream out=new FileOutputStream(file)){
        byte[] buffer=new byte[65536];int remaining=length;
        while(remaining>0){int n=in.read(buffer,0,Math.min(buffer.length,remaining));if(n<0)throw new EOFException("Incomplete upload");out.write(buffer,0,n);remaining-=n;}
        complete=true;
      }finally{if(!complete)file.delete();}
      Request request=new Request(parts[0],parts[1],"{}",new byte[0],headerMap);request.bodyFile=file;return request;
    }
    byte[] bytes = new byte[length]; int read = 0;
    while (read < length) {
      int n = in.read(bytes, read, length - read);
      if (n == -1) throw new EOFException("Incomplete HTTP body");
      read += n;
    }
    String bodyStr = length == 0 ? "{}" : (isBinary ? "{}" : new String(bytes, StandardCharsets.UTF_8));
    return new Request(parts[0], parts[1], bodyStr, isBinary?bytes:new byte[0], headerMap);
  }

  private static boolean localOrigin(String value){
    try{java.net.URI uri=new java.net.URI(value);String host=uri.getHost();if(!"http".equals(uri.getScheme())||host==null||uri.getRawUserInfo()!=null)return false;
      if(host.equals("localhost")||host.equals("[::1]")||host.equals("::1"))return true;
      String[] parts=host.split("\\.");if(parts.length!=4)return false;int[] n=new int[4];for(int i=0;i<4;i++){n[i]=Integer.parseInt(parts[i]);if(n[i]<0||n[i]>255)return false;}
      return n[0]==127||n[0]==10||(n[0]==192&&n[1]==168)||(n[0]==172&&n[1]>=16&&n[1]<=31)||(n[0]==169&&n[1]==254);
    }catch(Exception ignored){return false;}
  }
}
