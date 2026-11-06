import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer } from './useAudioPlayer';
import type { AudioPlayer } from './useAudioPlayer';
import { readSavedSongKey, resolveAudioUrl, saveSongKey } from './songs';
import type { Song } from './songs';

export const PREVIEW_MS = 3000;
/** Seconds of playback after which the language and decade are shown as hints. */
export const HINT_AFTER_S = 10;

export interface Game {
  song: Song;
  /** 0-based position in the (filtered) playlist. */
  index: number;
  count: number;
  /** True for the first PREVIEW_MS after a song is selected (never in solo mode). */
  previewing: boolean;
  /** True after REVEAL until the next navigation. */
  revealed: boolean;
  /** previewing || revealed: render title/artist only when this is true. */
  answerVisible: boolean;
  /**
   * answerVisible, or the song has played for HINT_AFTER_S seconds: render the
   * language and decade tags only when this is true. Stays on until the next navigation.
   */
  hintsVisible: boolean;
  /** Increments on each selection; use as a React `key` to restart preview animations. */
  selection: number;
  previewMs: number;
  canPrevious: boolean;
  canNext: boolean;
  previous: () => void;
  next: () => void;
  reveal: () => void;
  /** Playback position 0..1 (0 when the duration is unknown). */
  progress: number;
  player: AudioPlayer;
}

/**
 * Per-playlist game state. Mount it in a component keyed on `library.gameKey`
 * and pass the non-empty filtered playlist. In `solo` mode the answer is never
 * previewed: it stays hidden until reveal().
 */
export function useGame(songs: Song[], { solo = false }: { solo?: boolean } = {}): Game {
  const [index, setIndex] = useState(() => Math.max(0, songs.findIndex((s) => s.key === readSavedSongKey())));
  const [selection, setSelection] = useState(0);
  const [previewing, setPreviewing] = useState(!solo);
  const soloRef = useRef(solo);
  soloRef.current = solo;
  const [revealed, setRevealed] = useState(false);
  const [hinted, setHinted] = useState(false);

  const song = songs[index];
  const next = index + 1 < songs.length ? songs[index + 1] : null;
  const src = resolveAudioUrl(song.audioFile);
  const nextSrc = next ? resolveAudioUrl(next.audioFile) : null;
  const player = useAudioPlayer(src, nextSrc);

  // The 3-second preview starts when a song is selected, not when it plays.
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewing(false), PREVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [selection]);

  // Switching solo on mid-preview hides the answer right away.
  useEffect(() => {
    if (solo) setPreviewing(false);
  }, [solo]);

  // Hints unlock after HINT_AFTER_S seconds of playback (or at the end of a
  // shorter clip) and survive RESTART. Keyed on the player's values only: right
  // after a song change they still describe the previous song until the player
  // resets them, and those stale values must not unlock the new song's hints.
  useEffect(() => {
    if (player.currentTime >= HINT_AFTER_S || player.status === 'ended') setHinted(true);
  }, [player.currentTime, player.status]);

  useEffect(() => saveSongKey(song.key), [song.key]);

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= songs.length) return;
      player.release();
      setIndex(i);
      setPreviewing(!soloRef.current);
      setRevealed(false);
      setHinted(false);
      setSelection((n) => n + 1);
    },
    [player, songs.length],
  );

  return {
    song,
    index,
    count: songs.length,
    previewing,
    revealed,
    answerVisible: previewing || revealed,
    hintsVisible: previewing || revealed || hinted,
    selection,
    previewMs: PREVIEW_MS,
    canPrevious: index > 0,
    canNext: index < songs.length - 1,
    previous: () => goTo(index - 1),
    next: () => goTo(index + 1),
    reveal: () => setRevealed(true),
    progress: player.duration > 0 ? player.currentTime / player.duration : 0,
    player,
  };
}
