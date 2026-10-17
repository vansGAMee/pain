package dev.mono.local;

import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import java.time.*;
import java.util.*;

/** Local durable store. All methods run on MonoApp.io, never on the render thread. */
public final class Repository extends SQLiteOpenHelper {
  private final Context context;

  public Repository(Context c) {
    this(c, "mono.db");
  }

  Repository(Context c, String file) {
    super(c, file, null, 1);
    context = c;
    setWriteAheadLoggingEnabled(true);
  }

  @Override
  public void onCreate(SQLiteDatabase d) {
    d.execSQL(
        "CREATE TABLE tracks(id TEXT PRIMARY KEY,uri TEXT NOT NULL,title TEXT,artist TEXT,album"
            + " TEXT,folder TEXT,mime TEXT,duration INTEGER,bytes INTEGER,added INTEGER,album_id"
            + " INTEGER,number INTEGER,favorite INTEGER DEFAULT 0,available INTEGER DEFAULT 1)");
    d.execSQL(
        "CREATE TABLE plays(id TEXT PRIMARY KEY,track TEXT,session TEXT,started INTEGER,heard"
            + " INTEGER DEFAULT 0,media_heard INTEGER DEFAULT 0,duration INTEGER,finished INTEGER"
            + " DEFAULT 0,skipped INTEGER DEFAULT 0)");
    d.execSQL("CREATE INDEX plays_started ON plays(started)");
    d.execSQL("CREATE INDEX plays_track ON plays(track)");
    d.execSQL("CREATE TABLE slices(id INTEGER PRIMARY KEY,play TEXT,at INTEGER,ms INTEGER)");
    d.execSQL("CREATE INDEX slices_at ON slices(at)");
    d.execSQL("CREATE TABLE lyrics(track TEXT PRIMARY KEY,body TEXT,offset INTEGER DEFAULT 0)");
    d.execSQL("CREATE TABLE playlists(id INTEGER PRIMARY KEY,name TEXT NOT NULL)");
    d.execSQL(
        "CREATE TABLE playlist_tracks(list INTEGER,track TEXT,position INTEGER,PRIMARY"
            + " KEY(list,track))");
  }

  @Override
  public void onUpgrade(SQLiteDatabase d, int old, int next) {
    throw new IllegalStateException("Unsupported database version");
  }

  public List<Track> tracks() {
    List<Track> r = new ArrayList<>();
    try (Cursor c =
        getReadableDatabase()
            .rawQuery(
                "SELECT * FROM tracks WHERE available=1 ORDER BY title COLLATE NOCASE", null)) {
      while (c.moveToNext()) r.add(readTrack(c));
    }
    return r;
  }

  private Track readTrack(Cursor c) {
    return new Track(
        s(c, "id"),
        s(c, "uri"),
        s(c, "title"),
        s(c, "artist"),
        s(c, "album"),
        s(c, "folder"),
        s(c, "mime"),
        l(c, "duration"),
        l(c, "bytes"),
        l(c, "added"),
        l(c, "album_id"),
        (int) l(c, "number"),
        l(c, "favorite") == 1);
  }

  private static String s(Cursor c, String n) {
    String v = c.getString(c.getColumnIndexOrThrow(n));
    return v == null ? "" : v;
  }

  private static long l(Cursor c, String n) {
    return c.getLong(c.getColumnIndexOrThrow(n));
  }

  private static String tag(String s, String fallback) {
    return s == null || s.isBlank() || s.equals("<unknown>") ? fallback : s;
  }

  private void upsert(SQLiteDatabase d, Track t) {
    ContentValues v = new ContentValues();
    v.put("id", t.id);
    v.put("uri", t.uri);
    v.put("title", t.title);
    v.put("artist", t.artist);
    v.put("album", t.album);
    v.put("folder", t.folder);
    v.put("mime", t.mime);
    v.put("duration", t.duration);
    v.put("bytes", t.bytes);
    v.put("added", t.added);
    v.put("album_id", t.albumId);
    v.put("number", t.number);
    v.put("available", 1);
    if (d.update("tracks", v, "id=?", new String[] {t.id}) == 0) d.insertOrThrow("tracks", null, v);
  }

  public int scan(SharedPreferences prefs) {
    List<Track> found = new ArrayList<>();
    String folderCol =
        Build.VERSION.SDK_INT >= 29
            ? MediaStore.Audio.Media.RELATIVE_PATH
            : MediaStore.Audio.Media.DATA;
    String[] cols = {
      "_id",
      "title",
      "artist",
      "album",
      folderCol,
      "mime_type",
      "duration",
      "_size",
      "date_added",
      "album_id",
      "track",
      "is_music"
    };
    long minimum = prefs.getInt("minimumSeconds", 10) * 1000L;
    String excluded = prefs.getString("excludedFolders", "");
    Uri root = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
    try (Cursor c = context.getContentResolver().query(root, cols, null, null, null)) {
      if (c == null)
        throw new IllegalStateException("Android не вернул библиотеку. Попробуйте ещё раз.");
      while (c.moveToNext()) {
        if (Thread.currentThread().isInterrupted())
          throw new IllegalStateException("Сканирование прервано");
        long duration = l(c, "duration");
        if (duration < minimum) continue;
        if (prefs.getBoolean("musicOnly", true) && l(c, "is_music") == 0) continue;
        String folder = s(c, folderCol);
        if (Build.VERSION.SDK_INT < 29) {
          int slash = folder.lastIndexOf('/');
          folder = slash >= 0 ? folder.substring(0, slash + 1) : "";
        }
        boolean skip = false;
        for (String e : excluded.split("\\n"))
          if (!e.isBlank()
              && folder.toLowerCase(Locale.ROOT).contains(e.trim().toLowerCase(Locale.ROOT)))
            skip = true;
        if (skip) continue;
        long id = l(c, "_id");
        String uri = ContentUris.withAppendedId(root, id).toString();
        found.add(
            new Track(
                "media:" + id,
                uri,
                tag(s(c, "title"), "Без названия"),
                tag(s(c, "artist"), "Неизвестный исполнитель"),
                tag(s(c, "album"), "Без альбома"),
                folder,
                s(c, "mime_type"),
                duration,
                l(c, "_size"),
                l(c, "date_added") * 1000,
                l(c, "album_id"),
                (int) l(c, "track"),
                false));
      }
    }
    SQLiteDatabase d = getWritableDatabase();
    d.beginTransaction();
    try {
      d.execSQL("UPDATE tracks SET available=0 WHERE id LIKE 'media:%'");
      for (Track t : found) upsert(d, t);
      d.setTransactionSuccessful();
    } finally {
      d.endTransaction();
    }
    return found.size();
  }

  public void importUri(Uri uri) throws Exception {
    String name = "Аудиофайл";
    long bytes = 0;
    try (Cursor c = context.getContentResolver().query(uri, null, null, null, null)) {
      if (c != null && c.moveToFirst()) {
        int n = c.getColumnIndex("_display_name"), b = c.getColumnIndex("_size");
        if (n >= 0) name = c.getString(n);
        if (b >= 0) bytes = c.getLong(b);
      }
    }
    MediaMetadataRetriever m = new MediaMetadataRetriever();
    try {
      m.setDataSource(context, uri);
      String dur = m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
      long duration = dur == null ? 0 : Long.parseLong(dur);
      if (duration <= 0)
        throw new IllegalArgumentException("Не удалось прочитать длительность файла");
      Track t =
          new Track(
              "saf:" + uri,
              uri.toString(),
              tag(m.extractMetadata(7), name),
              tag(m.extractMetadata(2), "Неизвестный исполнитель"),
              tag(m.extractMetadata(1), "Без альбома"),
              "Выбранные файлы",
              tag(context.getContentResolver().getType(uri), "audio/*"),
              duration,
              bytes,
              System.currentTimeMillis(),
              0,
              0,
              false);
      upsert(getWritableDatabase(), t);
    } finally {
      m.release();
    }
  }

  public void favorite(String id, boolean favorite) {
    ContentValues v = new ContentValues();
    v.put("favorite", favorite ? 1 : 0);
    getWritableDatabase().update("tracks", v, "id=?", new String[] {id});
  }

  public void record(
      String id,
      String track,
      String session,
      long started,
      long duration,
      long at,
      long delta,
      long mediaDelta,
      boolean finished,
      boolean skipped) {
    SQLiteDatabase d = getWritableDatabase();
    d.beginTransaction();
    try {
      ContentValues v = new ContentValues();
      v.put("id", id);
      v.put("track", track);
      v.put("session", session);
      v.put("started", started);
      v.put("duration", duration);
      d.insertWithOnConflict("plays", null, v, SQLiteDatabase.CONFLICT_IGNORE);
      d.execSQL(
          "UPDATE plays SET"
              + " heard=heard+?,media_heard=media_heard+?,finished=MAX(finished,?),skipped=MAX(skipped,?)"
              + " WHERE id=?",
          new Object[] {delta, mediaDelta, finished ? 1 : 0, skipped ? 1 : 0, id});
      if (delta > 0) {
        ContentValues slice = new ContentValues();
        slice.put("play", id);
        slice.put("at", at);
        slice.put("ms", delta);
        d.insertOrThrow("slices", null, slice);
      }
      d.setTransactionSuccessful();
    } finally {
      d.endTransaction();
    }
  }

  public String lyrics(String id) {
    try (Cursor c =
        getReadableDatabase()
            .rawQuery("SELECT body FROM lyrics WHERE track=?", new String[] {id})) {
      return c.moveToFirst() ? c.getString(0) : "";
    }
  }

  public int offset(String id) {
    try (Cursor c =
        getReadableDatabase()
            .rawQuery("SELECT offset FROM lyrics WHERE track=?", new String[] {id})) {
      return c.moveToFirst() ? c.getInt(0) : 0;
    }
  }

  public void saveLyrics(String id, String body, int offset) {
    ContentValues v = new ContentValues();
    v.put("track", id);
    v.put("body", body);
    v.put("offset", offset);
    getWritableDatabase().insertWithOnConflict("lyrics", null, v, SQLiteDatabase.CONFLICT_REPLACE);
  }

  public Map<Long, String> playlists() {
    Map<Long, String> r = new LinkedHashMap<>();
    try (Cursor c =
        getReadableDatabase().rawQuery("SELECT id,name FROM playlists ORDER BY name", null)) {
      while (c.moveToNext()) r.put(c.getLong(0), c.getString(1));
    }
    return r;
  }

  public long createPlaylist(String name) {
    ContentValues v = new ContentValues();
    v.put("name", name);
    return getWritableDatabase().insertOrThrow("playlists", null, v);
  }

  public void addToPlaylist(long list, String track) {
    getWritableDatabase()
        .execSQL(
            "INSERT OR IGNORE INTO playlist_tracks(list,track,position) VALUES(?,?,(SELECT"
                + " COALESCE(MAX(position),0)+1 FROM playlist_tracks WHERE list=?))",
            new Object[] {list, track, list});
  }

  public List<String> playlist(long id) {
    List<String> r = new ArrayList<>();
    try (Cursor c =
        getReadableDatabase()
            .rawQuery(
                "SELECT track FROM playlist_tracks WHERE list=? ORDER BY position",
                new String[] {"" + id})) {
      while (c.moveToNext()) r.add(c.getString(0));
    }
    return r;
  }

  public void removeFromPlaylist(long list, String track) {
    getWritableDatabase()
        .delete("playlist_tracks", "list=? AND track=?", new String[] {"" + list, track});
  }

  public void deletePlaylist(long id) {
    SQLiteDatabase d = getWritableDatabase();
    d.beginTransaction();
    try {
      d.delete("playlist_tracks", "list=?", new String[] {"" + id});
      d.delete("playlists", "id=?", new String[] {"" + id});
      d.setTransactionSuccessful();
    } finally {
      d.endTransaction();
    }
  }

  public void clearHistory() {
    SQLiteDatabase d = getWritableDatabase();
    d.beginTransaction();
    try {
      d.delete("slices", null, null);
      d.delete("plays", null, null);
      d.setTransactionSuccessful();
    } finally {
      d.endTransaction();
    }
  }

  public static final class Stats {
    public long heard,
        today,
        sessionCount,
        qualified,
        completed,
        early,
        other,
        replayed,
        newPlays,
        longest,
        average,
        todayTracks,
        totalBytes;
    public int unique, streak, longestStreak, peak = -1;
    public final long[] hours = new long[24], week = new long[7];
    public final Map<String, Long> artists = new LinkedHashMap<>(),
        trackMs = new HashMap<>(),
        counts = new HashMap<>(),
        last = new HashMap<>(),
        days = new TreeMap<>();
    public String obsession = "", insight = "Your listening history starts with track 1.";
  }

  public Stats stats(long from) {
    Stats s = new Stats();
    SQLiteDatabase d = getReadableDatabase();
    ZoneId zone = ZoneId.systemDefault();
    LocalDate today = LocalDate.now(zone);
    long todayStart = today.atStartOfDay(zone).toInstant().toEpochMilli();
    Map<String, Long> artists = new HashMap<>(),
        sessions = new HashMap<>(),
        todayArtists = new HashMap<>();
    Set<String> distinct = new HashSet<>(), todayIds = new HashSet<>();
    Map<String, Long> first = new HashMap<>();
    try (Cursor c =
        d.rawQuery(
            "SELECT track,MIN(started) FROM plays WHERE heard>=MIN(30000,MAX(1000,duration/2))"
                + " GROUP BY track",
            null)) {
      while (c.moveToNext()) first.put(c.getString(0), c.getLong(1));
    }
    // Slices represent audible wall time; split at local-hour boundaries (including midnight/DST).
    try (Cursor c =
        d.rawQuery(
            "SELECT s.at,s.ms,p.track,p.session,COALESCE(t.artist,'Неизвестный исполнитель') FROM"
                + " slices s JOIN plays p ON p.id=s.play LEFT JOIN tracks t ON t.id=p.track WHERE"
                + " s.at+s.ms>CAST(? AS INTEGER) ORDER BY s.at",
            new String[] {"" + from})) {
      while (c.moveToNext()) {
        long at = c.getLong(0), end = at + c.getLong(1);
        at = Math.max(at, from);
        String track = c.getString(2);
        long amount = end - at;
        if (amount <= 0) continue;
        s.heard += amount;
        artists.merge(c.getString(4), amount, Long::sum);
        sessions.merge(c.getString(3), amount, Long::sum);
        s.trackMs.merge(track, amount, Long::sum);
        distinct.add(track);
        while (at < end) {
          ZonedDateTime z = Instant.ofEpochMilli(at).atZone(zone);
          long next =
              z.truncatedTo(java.time.temporal.ChronoUnit.HOURS)
                  .plusHours(1)
                  .toInstant()
                  .toEpochMilli();
          long part = Math.min(end, next) - at;
          if (part <= 0) break;
          s.hours[z.getHour()] += part;
          String day = z.toLocalDate().toString();
          s.days.merge(day, part, Long::sum);
          if (at >= todayStart) {
            s.today += part;
            todayIds.add(track);
            todayArtists.merge(c.getString(4), part, Long::sum);
          }
          long age = java.time.temporal.ChronoUnit.DAYS.between(z.toLocalDate(), today);
          if (age >= 0 && age < 7) s.week[(int) (6 - age)] += part;
          at += part;
        }
      }
    }
    try (Cursor c =
        d.rawQuery(
            "SELECT track,started,heard,media_heard,duration,finished,skipped FROM plays WHERE"
                + " started>=? ORDER BY started",
            new String[] {"" + from})) {
      Map<String, Integer> occurrence = new HashMap<>();
      while (c.moveToNext()) {
        String id = c.getString(0);
        long started = c.getLong(1),
            heard = c.getLong(2),
            media = c.getLong(3),
            duration = c.getLong(4);
        s.last.put(id, started);
        if (ListeningMath.qualifies(heard, duration)) {
          s.qualified++;
          s.counts.merge(id, 1L, Long::sum);
          if (first.getOrDefault(id, -1L) == started) s.newPlays++;
          if (occurrence.merge(id, 1, Integer::sum) > 1) s.replayed++;
        }
        if (ListeningMath.completed(media, duration)) s.completed++;
        else if (c.getInt(6) == 1 && heard < 30000) s.early++;
        else if (c.getInt(5) == 1 || c.getInt(6) == 1) s.other++;
      }
    }
    s.unique = distinct.size();
    s.todayTracks = todayIds.size();
    s.sessionCount = sessions.size();
    for (long n : sessions.values()) s.longest = Math.max(s.longest, n);
    s.average = s.sessionCount == 0 ? 0 : s.heard / s.sessionCount;
    artists.entrySet().stream()
        .sorted(
            Map.Entry.<String, Long>comparingByValue()
                .reversed()
                .thenComparing(Map.Entry.comparingByKey()))
        .forEach(e -> s.artists.put(e.getKey(), e.getValue()));
    s.obsession =
        s.counts.entrySet().stream()
            .max(
                Map.Entry.<String, Long>comparingByValue()
                    .thenComparing(Map.Entry.comparingByKey()))
            .map(Map.Entry::getKey)
            .orElse("");
    for (int h = 0; h < 24; h++)
      if (s.hours[h] > 0 && (s.peak < 0 || s.hours[h] > s.hours[s.peak])) s.peak = h;
    Set<LocalDate> days = new TreeSet<>();
    for (var e : s.days.entrySet())
      if (e.getValue() >= 60000) days.add(LocalDate.parse(e.getKey()));
    LocalDate prev = null;
    int streak = 0;
    for (LocalDate day : days) {
      streak = prev != null && prev.plusDays(1).equals(day) ? streak + 1 : 1;
      s.longestStreak = Math.max(s.longestStreak, streak);
      prev = day;
    }
    LocalDate day = days.contains(today) ? today : today.minusDays(1);
    while (days.contains(day)) {
      s.streak++;
      day = day.minusDays(1);
    }
    if (s.today > 0) {
      String top =
          todayArtists.entrySet().stream()
              .max(
                  Map.Entry.<String, Long>comparingByValue()
                      .thenComparing(Map.Entry.comparingByKey()))
              .map(Map.Entry::getKey)
              .orElse("");
      s.insight = "Сегодня вы слушали " + formatTime(s.today) + ". Чаще всего — " + top + ".";
    }

    return s;
  }

  public static String formatTime(long ms) {
    long m = ms / 60000;
    return m >= 60 ? m / 60 + " ч " + m % 60 + " мин" : m > 0 ? m + " мин" : Math.max(0, ms / 1000) + " сек";
  }

  public String exportJson() throws Exception {
    org.json.JSONObject root = new org.json.JSONObject();
    root.put("schema", 1);
    root.put("exportedAt", Instant.now().toString());
    for (String table :
        new String[] {"tracks", "plays", "slices", "lyrics", "playlists", "playlist_tracks"}) {
      org.json.JSONArray arr = new org.json.JSONArray();
      try (Cursor c = getReadableDatabase().rawQuery("SELECT * FROM " + table, null)) {
        while (c.moveToNext()) {
          org.json.JSONObject row = new org.json.JSONObject();
          for (int i = 0; i < c.getColumnCount(); i++) {
            if (c.getType(i) == Cursor.FIELD_TYPE_INTEGER)
              row.put(c.getColumnName(i), c.getLong(i));
            else row.put(c.getColumnName(i), c.getString(i));
          }
          arr.put(row);
        }
      }
      root.put(table, arr);
    }
    return root.toString(2);
  }

  public int importJson(String json) throws Exception {
    org.json.JSONObject root = new org.json.JSONObject(json);
    SQLiteDatabase d = getWritableDatabase();
    int count = 0;
    d.beginTransaction();
    try {
      if (root.has("tracks")) {
        org.json.JSONArray tracksArr = root.getJSONArray("tracks");
        for (int i = 0; i < tracksArr.length(); i++) {
          org.json.JSONObject tr = tracksArr.getJSONObject(i);
          ContentValues v = new ContentValues();
          v.put("id", tr.optString("id"));
          v.put("uri", tr.optString("uri"));
          v.put("title", tr.optString("title"));
          v.put("artist", tr.optString("artist"));
          v.put("album", tr.optString("album"));
          v.put("folder", tr.optString("folder"));
          v.put("mime", tr.optString("mime", "audio/*"));
          v.put("duration", tr.optLong("duration", 0));
          v.put("bytes", tr.optLong("bytes", 0));
          v.put("added", tr.optLong("added", System.currentTimeMillis()));
          v.put("album_id", tr.optLong("album_id", 0));
          v.put("number", tr.optInt("number", 0));
          v.put("favorite", tr.optInt("favorite", 0));
          v.put("available", tr.optInt("available", 1));
          if (d.update("tracks", v, "id=?", new String[] {tr.optString("id")}) == 0) {
            d.insert("tracks", null, v);
          }
          count++;
        }
      }
      if (root.has("plays")) {
        org.json.JSONArray playsArr = root.getJSONArray("plays");
        for (int i = 0; i < playsArr.length(); i++) {
          org.json.JSONObject pl = playsArr.getJSONObject(i);
          ContentValues v = new ContentValues();
          v.put("id", pl.optString("id"));
          v.put("track", pl.optString("track"));
          v.put("session", pl.optString("session"));
          v.put("started", pl.optLong("started", 0));
          v.put("heard", pl.optLong("heard", 0));
          v.put("media_heard", pl.optLong("media_heard", 0));
          v.put("duration", pl.optLong("duration", 0));
          v.put("finished", pl.optInt("finished", 0));
          v.put("skipped", pl.optInt("skipped", 0));
          d.insertWithOnConflict("plays", null, v, SQLiteDatabase.CONFLICT_IGNORE);
          count++;
        }
      }
      if (root.has("slices")) {
        org.json.JSONArray slicesArr = root.getJSONArray("slices");
        for (int i = 0; i < slicesArr.length(); i++) {
          org.json.JSONObject sl = slicesArr.getJSONObject(i);
          ContentValues v = new ContentValues();
          v.put("play", sl.optString("play"));
          v.put("at", sl.optLong("at", 0));
          v.put("ms", sl.optLong("ms", 0));
          d.insertWithOnConflict("slices", null, v, SQLiteDatabase.CONFLICT_IGNORE);
          count++;
        }
      }
      if (root.has("lyrics")) {
        org.json.JSONArray lyricsArr = root.getJSONArray("lyrics");
        for (int i = 0; i < lyricsArr.length(); i++) {
          org.json.JSONObject ly = lyricsArr.getJSONObject(i);
          ContentValues v = new ContentValues();
          v.put("track", ly.optString("track"));
          v.put("body", ly.optString("body"));
          v.put("offset", ly.optInt("offset", 0));
          d.insertWithOnConflict("lyrics", null, v, SQLiteDatabase.CONFLICT_REPLACE);
        }
      }
      d.setTransactionSuccessful();
    } finally {
      d.endTransaction();
    }
    return count;
  }

  public String exportLibraryJson() throws Exception {
    org.json.JSONObject root = new org.json.JSONObject();
    root.put("schema", 1);
    root.put("type", "library");
    root.put("exportedAt", Instant.now().toString());
    org.json.JSONArray arr = new org.json.JSONArray();
    try (Cursor c = getReadableDatabase().rawQuery("SELECT * FROM tracks WHERE available=1", null)) {
      while (c.moveToNext()) {
        org.json.JSONObject row = new org.json.JSONObject();
        for (int i = 0; i < c.getColumnCount(); i++) {
          if (c.getType(i) == Cursor.FIELD_TYPE_INTEGER)
            row.put(c.getColumnName(i), c.getLong(i));
          else row.put(c.getColumnName(i), c.getString(i));
        }
        arr.put(row);
      }
    }
    root.put("tracks", arr);
    return root.toString();
  }

  public String exportStatsJson() throws Exception {
    org.json.JSONObject root = new org.json.JSONObject();
    root.put("schema", 1);
    root.put("type", "stats");
    root.put("exportedAt", Instant.now().toString());
    for (String table : new String[] {"plays", "slices"}) {
      org.json.JSONArray arr = new org.json.JSONArray();
      try (Cursor c = getReadableDatabase().rawQuery("SELECT * FROM " + table, null)) {
        while (c.moveToNext()) {
          org.json.JSONObject row = new org.json.JSONObject();
          for (int i = 0; i < c.getColumnCount(); i++) {
            if (c.getType(i) == Cursor.FIELD_TYPE_INTEGER)
              row.put(c.getColumnName(i), c.getLong(i));
            else row.put(c.getColumnName(i), c.getString(i));
          }
          arr.put(row);
        }
      }
      root.put(table, arr);
    }
    return root.toString();
  }
}
