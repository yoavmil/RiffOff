import { useEffect, useState } from 'react';
import { applyFilters, DECADES } from './songs';
import type { Decade, Filters, Song, SongLanguage } from './songs';

export interface SettingsDraft {
  draft: Filters;
  setLanguage: (language: SongLanguage | 'both') => void;
  toggleDecade: (decade: Decade) => void;
  /** Select all decades, or clear them all if all are selected. */
  toggleAllDecades: () => void;
  allDecades: boolean;
  /** How many songs the draft filters match. */
  matches: number;
  /** Apply the draft and close (call from Done, the backdrop, Escape…). */
  close: () => void;
}

/**
 * Draft state for a settings UI. Filters are edited as a draft and applied on
 * close, so the game remounts only once. Escape closes too, unless `closeOnEscape` is false.
 */
export function useSettingsDraft(
  songs: Song[],
  filters: Filters,
  onClose: (f: Filters) => void,
  { closeOnEscape = true }: { closeOnEscape?: boolean } = {},
): SettingsDraft {
  const [draft, setDraft] = useState<Filters>(filters);

  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(draft);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, onClose, closeOnEscape]);

  const allDecades = draft.decades.length === DECADES.length;

  return {
    draft,
    setLanguage: (language) => setDraft((f) => ({ ...f, language })),
    toggleDecade: (d) =>
      setDraft((f) => ({
        ...f,
        decades: f.decades.includes(d)
          ? f.decades.filter((x) => x !== d)
          : DECADES.filter((x) => x === d || f.decades.includes(x)),
      })),
    toggleAllDecades: () => setDraft((f) => ({ ...f, decades: allDecades ? [] : [...DECADES] })),
    allDecades,
    matches: applyFilters(songs, draft).length,
    close: () => onClose(draft),
  };
}
