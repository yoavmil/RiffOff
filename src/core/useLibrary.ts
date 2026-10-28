import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyFilters, filtersKey, loadSongs, parsePlaylist, readFilters, readSolo, saveFilters, saveSolo } from './songs';
import type { Filters, Song } from './songs';
import { fetchCloudLibrary, openCloudWithPassword, openCloudWithSavedSession } from './cloudLibrary';
import type { CloudLibrary } from './cloudLibrary';

export interface Library {
  /** All songs from the cloud library (or demo songs.json), or null while loading / locked. */
  songs: Song[] | null;
  /** The cloud library needs a password: show a password screen and call unlock(). */
  locked: boolean;
  /** Try a password; resolves false when it is wrong. */
  unlock: (password: string) => Promise<boolean>;
  /** Load/validation failure; show it with `playlistErrorText(loadError, t)`. */
  loadError: unknown;
  filters: Filters;
  /** Songs that pass the filters, in playlist order (empty while loading). */
  playlist: Song[];
  /**
   * Key for the game component: `<Game key={library.gameKey} …/>`. Changes when
   * the filters change, so the game remounts with a fresh audio element and preview.
   */
  gameKey: string;
  /** Solo mode: the song is never shown at the start, only on REVEAL. Pass to useGame. */
  solo: boolean;
  /** Applies immediately (no remount) and is remembered. */
  setSolo: (solo: boolean) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  /** Close the settings UI, applying the edited filters. */
  closeSettings: (filters: Filters) => void;
}

/** App-level state: the playlist, the active filters and whether settings are open. */
export function useLibrary(): Library {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [solo, setSoloState] = useState(readSolo);
  const [locked, setLocked] = useState(false);
  const cloudRef = useRef<CloudLibrary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cloud = await fetchCloudLibrary();
      if (cancelled) return null;
      if (cloud) {
        cloudRef.current = cloud;
        const data = await openCloudWithSavedSession(cloud);
        if (cancelled) return null;
        if (data === null) {
          setLocked(true);
          return null;
        }
        return parsePlaylist(data);
      }
      return loadSongs();
    })().then(
      (result) => {
        if (!cancelled && result) setSongs(result);
      },
      (err) => {
        if (!cancelled) setLoadError(err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async (password: string) => {
    const cloud = cloudRef.current;
    if (!cloud) return false;
    try {
      const data = await openCloudWithPassword(cloud, password);
      if (data === null) return false;
      setSongs(parsePlaylist(data));
      setLocked(false);
      return true;
    } catch (err) {
      setLoadError(err);
      return true;
    }
  }, []);

  const playlist = useMemo(() => (songs ? applyFilters(songs, filters) : []), [songs, filters]);

  const setSolo = useCallback((value: boolean) => {
    setSoloState(value);
    saveSolo(value);
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback((next: Filters) => {
    setSettingsOpen(false);
    setFilters((prev) => (filtersKey(prev) === filtersKey(next) ? prev : next));
    saveFilters(next);
  }, []);

  return {
    songs,
    locked,
    unlock,
    loadError,
    filters,
    playlist,
    gameKey: filtersKey(filters),
    solo,
    setSolo,
    settingsOpen,
    openSettings,
    closeSettings,
  };
}
