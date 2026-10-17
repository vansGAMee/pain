package dev.mono.local;

import android.net.Uri;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

public final class Track {
  public final String id, uri, title, artist, album, folder, mime;
  public final long duration, bytes, added, albumId;
  public final int number;
  public boolean favorite;

  public Track(
      String id,
      String uri,
      String title,
      String artist,
      String album,
      String folder,
      String mime,
      long duration,
      long bytes,
      long added,
      long albumId,
      int number,
      boolean favorite) {
    this.id = id;
    this.uri = uri;
    this.title = title;
    this.artist = artist;
    this.album = album;
    this.folder = folder;
    this.mime = mime;
    this.duration = duration;
    this.bytes = bytes;
    this.added = added;
    this.albumId = albumId;
    this.number = number;
    this.favorite = favorite;
  }

  public MediaItem mediaItem() {
    MediaMetadata.Builder m =
        new MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle(album)
            .setIsPlayable(true);
    if (albumId > 0)
      m.setArtworkUri(Uri.parse("content://media/external/audio/albumart/" + albumId));
    return new MediaItem.Builder().setMediaId(id).setUri(uri).setMediaMetadata(m.build()).build();
  }

  public String albumKey() {
    return artist + "\u0000" + album;
  }
}
