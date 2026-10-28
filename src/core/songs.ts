export type SongLanguage = 'he' | 'en';

export const DECADES = ['60', '70', '80', '90', '00', '10', '20'] as const;
export type Decade = (typeof DECADES)[number];

export interface Song {
  /** Position in songs.json; stable identity used for the saved "current song". */
  key: number;
  id: number | string;
  title: string;
  artist: string;
  audioFile: string;
  language: SongLanguage;
  decade: Decade;
}

export type PlaylistErrorCode =
  | 'http'
  | 'invalidJson'
  | 'notArray'
  | 'empty'
  | 'notObject'
  | 'missingFields'
  | 'invalidLanguage'
  | 'invalidDecade';

/** Carries a code + details so the UI can show the message in the current language. */
export class PlaylistError extends Error {
  code: PlaylistErrorCode;
  details: { entry?: number; status?: number; fields?: string[]; value?: string };

  constructor(code: PlaylistErrorCode, details: PlaylistError['details'] = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

/** Turns a playlist path into a URL that also works when the app is served from a sub-path. */
export function resolveAudioUrl(path: string): string {
  if (/^([a-z]+:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  return import.meta.env.BASE_URL + path.replace(/^\.?\//, '');
}

/** Accepts "he"/"en" plus forgiving variants such as "Hebrew" or "English". */
function parseLanguage(value: unknown): SongLanguage | null {
  const v = String(value ?? '').trim().toLowerCase();
  if (['he', 'heb', 'hebrew', 'עברית'].includes(v)) return 'he';
  if (['en', 'eng', 'english', 'אנגלית'].includes(v)) return 'en';
  return null;
}

/** Accepts "80", 80, "80s", "'80s", 1985, "00", 0, 2000... */
function parseDecade(value: unknown): Decade | null {
  const v = String(value ?? '').trim().replace(/^'/, '').replace(/s$/i, '');
  if (!/^(0|\d{2}|\d{4})$/.test(v)) return null;
  let n = Number(v);
  if (n >= 1900) n %= 100;
  n -= n % 10;
  const d = String(n).padStart(2, '0');
  return (DECADES as readonly string[]).includes(d) ? (d as Decade) : null;
}

/** Loads public/songs.json. Order is preserved exactly as written. */
export async function loadSongs(): Promise<Song[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}songs.json`, { cache: 'no-cache' });
  if (!res.ok) throw new PlaylistError('http', { status: res.status });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new PlaylistError('invalidJson');
  }
  return parsePlaylist(data);
}

/** Validates and normalizes a playlist (from the cloud service or demo songs.json). */
export function parsePlaylist(data: unknown): Song[] {
  if (!Array.isArray(data)) throw new PlaylistError('notArray');
  if (data.length === 0) throw new PlaylistError('empty');

  return data.map((item, i) => {
    const entry = i + 1;
    const s = item as Record<string, unknown> | null;
    if (!s || typeof s !== 'object') throw new PlaylistError('notObject', { entry });

    const missing = ['title', 'artist', 'audioFile', 'language', 'decade'].filter((f) => {
      const v = s[f];
      return v === undefined || v === null || String(v).trim() === '';
    });
    if (missing.length) throw new PlaylistError('missingFields', { entry, fields: missing });

    const language = parseLanguage(s.language);
    if (!language) throw new PlaylistError('invalidLanguage', { entry, value: JSON.stringify(s.language) });
    const decade = parseDecade(s.decade);
    if (!decade) throw new PlaylistError('invalidDecade', { entry, value: JSON.stringify(s.decade) });

    return {
      key: i,
      id: (s.id as number | string | undefined) ?? entry,
      title: String(s.title).trim(),
      artist: String(s.artist).trim(),
      audioFile: String(s.audioFile).trim(),
      language,
      decade,
    };
  });
}

// ---------------------------------------------------------------- filters

export interface Filters {
  language: SongLanguage | 'both';
  decades: Decade[];
}

export const DEFAULT_FILTERS: Filters = { language: 'both', decades: [...DECADES] };

export function applyFilters(songs: Song[], f: Filters): Song[] {
  return songs.filter((s) => (f.language === 'both' || s.language === f.language) && f.decades.includes(s.decade));
}

/** Stable string for a filter set (decades kept in canonical order). */
export function filtersKey(f: Filters): string {
  return `${f.language}|${DECADES.filter((d) => f.decades.includes(d)).join(',')}`;
}

// ---------------------------------------------------------------- storage

const SONG_KEY = 'riffoff:songIndex';
const FILTERS_KEY = 'riffoff:filters';

/** The current song's position in songs.json, or null. */
export function readSavedSongKey(): number | null {
  try {
    const n = Number.parseInt(localStorage.getItem(SONG_KEY) ?? '', 10);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveSongKey(key: number): void {
  try {
    localStorage.setItem(SONG_KEY, String(key));
  } catch {
    /* private mode / storage disabled */
  }
}

export function readFilters(): Filters {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? 'null') as Partial<Filters> | null;
    if (!raw) return DEFAULT_FILTERS;
    const language = raw.language === 'he' || raw.language === 'en' ? raw.language : 'both';
    const decades = Array.isArray(raw.decades) ? DECADES.filter((d) => raw.decades!.includes(d)) : [...DECADES];
    return { language, decades };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(f: Filters): void {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* storage disabled */
  }
}

const SOLO_KEY = 'riffoff:solo';

/** Solo mode: no answer preview when a song is selected. */
export function readSolo(): boolean {
  try {
    return localStorage.getItem(SOLO_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSolo(solo: boolean): void {
  try {
    localStorage.setItem(SOLO_KEY, solo ? '1' : '0');
  } catch {
    /* storage disabled */
  }
}
