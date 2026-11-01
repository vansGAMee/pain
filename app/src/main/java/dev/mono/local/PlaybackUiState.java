package dev.mono.local;

import androidx.media3.common.Player;

/** The transport action follows playback intent, including buffering. */
final class PlaybackUiState {
  static boolean showsPause(Player player) {
    return player != null && player.getCurrentMediaItem() != null
        && player.getPlayWhenReady() && player.getPlaybackState() != Player.STATE_ENDED
        && player.getPlayerError() == null;
  }
}
