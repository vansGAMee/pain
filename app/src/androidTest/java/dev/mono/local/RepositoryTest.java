package dev.mono.local;

import static org.junit.Assert.*;

import android.content.*;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.*;
import java.time.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RepositoryTest {
  Context context;
  Repository repo;
  File audio;

  @Before
  public void setup() throws Exception {
    context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    context.deleteDatabase("mono-test.db");
    repo = new Repository(context, "mono-test.db");
    audio = new File(context.getCacheDir(), "test-tone.wav");
    writeWav(audio, 3);
    repo.importUri(Uri.fromFile(audio));
  }

  @After
  public void cleanup() {
    repo.close();
    context.deleteDatabase("mono-test.db");
    audio.delete();
  }

  static void writeWav(File file, int seconds) throws Exception {
    int n = 44100 * seconds;
    ByteBuffer b = ByteBuffer.allocate(44 + n * 2).order(ByteOrder.LITTLE_ENDIAN);
    b.put("RIFF".getBytes());
    b.putInt(36 + n * 2);
    b.put("WAVEfmt ".getBytes());
    b.putInt(16);
    b.putShort((short) 1);
    b.putShort((short) 1);
    b.putInt(44100);
    b.putInt(88200);
    b.putShort((short) 2);
    b.putShort((short) 16);
    b.put("data".getBytes());
    b.putInt(n * 2);
    for (int i = 0; i < n; i++)
      b.putShort((short) (Math.sin(2 * Math.PI * 440 * i / 44100) * 1500));
    try (FileOutputStream out = new FileOutputStream(file)) {
      out.write(b.array());
    }
  }

  @Test
  public void importsUpsertPreserveFavoritesAndLyrics() throws Exception {
    assertEquals(1, repo.tracks().size());
    Track t = repo.tracks().get(0);
    assertTrue(t.duration >= 2900);
    repo.favorite(t.id, true);
    repo.saveLyrics(t.id, "[00:01.00]Example", 180);
    repo.importUri(Uri.fromFile(audio));
    assertEquals(1, repo.tracks().size());
    assertTrue(repo.tracks().get(0).favorite);
    assertEquals(180, repo.offset(t.id));
    assertEquals(1, Lrc.parse(repo.lyrics(t.id)).size());
  }

  @Test
  public void listeningSplitsMidnightAndCountsSessions() {
    String id = repo.tracks().get(0).id;
    ZoneId zone = ZoneId.systemDefault();
    long midnight = LocalDate.now().atStartOfDay(zone).toInstant().toEpochMilli();
    repo.record(
        "p1", id, "s1", midnight - 60000, 60000, midnight - 30000, 60000, 60000, true, false);
    Repository.Stats s = repo.stats(0);
    assertEquals(60000, s.heard);
    assertEquals(30000, s.today);
    assertEquals(2, s.days.size());
    assertEquals(1, s.sessionCount);
    assertEquals(1, s.completed);
    assertEquals(1, s.qualified);
    assertEquals(1, s.newPlays);
    assertEquals(0, s.replayed);
    repo.record(
        "p2", id, "s1", midnight + 60000, 60000, midnight + 60000, 30000, 30000, false, true);
    s = repo.stats(0);
    assertEquals(90000, s.heard);
    assertEquals(2, s.qualified);
    assertEquals(1, s.newPlays);
    assertEquals(1, s.replayed);
    assertEquals(1, s.sessionCount);
    assertEquals(90000, s.longest);
    Repository.Stats today = repo.stats(midnight);
    assertEquals(60000, today.heard);
    assertEquals(1, today.qualified);
    assertEquals(0, today.newPlays);
  }

  @Test
  public void playlistsAreUniqueAndHistoryClearPreservesUserData() throws Exception {
    String id = repo.tracks().get(0).id;
    long list = repo.createPlaylist("Favorites set");
    repo.addToPlaylist(list, id);
    repo.addToPlaylist(list, id);
    assertEquals(1, repo.playlist(list).size());
    repo.saveLyrics(id, "My words", -100);
    repo.favorite(id, true);
    repo.record("one", id, "one", 1000, 3000, 1000, 3000, 3000, true, false);
    repo.clearHistory();
    assertEquals(0, repo.stats(0).heard);
    assertEquals(1, repo.playlists().size());
    assertTrue(repo.tracks().get(0).favorite);
    assertEquals("My words", repo.lyrics(id));
    assertTrue(repo.exportJson().contains("playlist_tracks"));
    repo.removeFromPlaylist(list, id);
    assertTrue(repo.playlist(list).isEmpty());
    repo.deletePlaylist(list);
    assertTrue(repo.playlists().isEmpty());
  }
  @Test
  public void syncRetriesPreserveCoverageAndDoNotDoubleListening() throws Exception {
    String track = repo.tracks().get(0).id;
    org.json.JSONObject play = new org.json.JSONObject().put("id", "pc_retry").put("track", track)
        .put("session", "pc_companion").put("started", 1000).put("heard", 60000)
        .put("media_heard", 20000).put("duration", 180000).put("skipped", true).put("finished", false);
    String json = new org.json.JSONObject().put("plays", new org.json.JSONArray().put(play)).toString();
    repo.importJson(json); repo.importJson(json);
    org.json.JSONObject stats = new org.json.JSONObject(repo.exportStatsJson());
    assertEquals(1, stats.getJSONArray("plays").length());
    assertEquals(20000, stats.getJSONArray("plays").getJSONObject(0).getLong("media_heard"));
    assertEquals(1, stats.getJSONArray("plays").getJSONObject(0).getInt("skipped"));
    assertEquals(60000, repo.stats(0).heard);
    repo.importJson(stats.toString()); repo.importJson(stats.toString());
    assertEquals(60000, repo.stats(0).heard);
    // An updated total adds only the difference, even if relayed with an old ID.
    play.put("id", "pc_legacy_alias").put("heard", 90000).put("media_heard", 40000);
    json = new org.json.JSONObject().put("plays", new org.json.JSONArray().put(play)).toString();
    repo.importJson(json); repo.importJson(json);
    assertEquals(90000, repo.stats(0).heard);
    stats = new org.json.JSONObject(repo.exportStatsJson());
    assertEquals(1, stats.getJSONArray("plays").length());
    assertEquals(40000, stats.getJSONArray("plays").getJSONObject(0).getLong("media_heard"));
    repo.importJson(stats.toString());
    assertEquals(90000, repo.stats(0).heard);
  }

}
