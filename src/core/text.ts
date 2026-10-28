import type { Dict } from './i18n';
import { PlaylistError } from './songs';
import type { AudioPlayer, PlayerStatus } from './useAudioPlayer';

/** Translated message for a `useLibrary().loadError`. */
export function playlistErrorText(err: unknown, t: Dict): string {
  if (!(err instanceof PlaylistError)) return err instanceof Error ? err.message : String(err);
  const { entry, status, fields, value } = err.details;
  const e = t.playlistErrors;
  switch (err.code) {
    case 'http':
      return e.http(status);
    case 'invalidJson':
      return e.invalidJson;
    case 'notArray':
      return e.notArray;
    case 'empty':
      return e.empty;
    case 'notObject':
      return e.notObject(entry);
    case 'missingFields':
      return e.missingFields(entry, fields);
    case 'invalidLanguage':
      return e.invalidLanguage(entry, value);
    case 'invalidDecade':
      return e.invalidDecade(entry, value);
  }
}

/** Main and secondary label for the hold control. */
export function holdLabels(player: AudioPlayer, t: Dict): { label: string; sublabel: string } {
  const { status, holding } = player;
  if (status === 'error') return { label: t.noAudio, sublabel: t.fileUnavailable };
  if (holding) {
    return status === 'playing'
      ? { label: t.playing, sublabel: t.releaseToPause }
      : { label: t.loading, sublabel: t.keepHolding };
  }
  return { label: t.holdToPlay, sublabel: status === 'ended' ? t.replayFromTop : t.pressAndHold };
}

export const formatTime = (seconds: number) => {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

/** One-line playback status ("Paused · 0:07", audio errors, the blocked-sound hint). */
export function statusText(player: AudioPlayer, t: Dict): string {
  if (player.notice === 'blocked') return t.soundBlocked;
  const statuses: Record<PlayerStatus, string> = {
    loading: t.statusLoading,
    ready: t.statusReady,
    buffering: t.statusBuffering,
    playing: `${t.statusPlaying} · ${formatTime(player.currentTime)}`,
    paused: `${t.statusPaused} · ${formatTime(player.currentTime)}`,
    ended: t.statusEnded,
    error: t.audioErrors[player.error ?? 'unknown'],
  };
  return statuses[player.status];
}
