import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Decade, SongLanguage } from './songs';

export type UiLang = 'he' | 'en';

const en = {
  tagline: 'Hear the riff. Name the hit.',
  song: 'Song',
  settings: 'Settings',
  tuningUp: 'Tuning up…',
  playlistProblem: 'Playlist problem',
  lockTitle: 'Private game',
  lockPrompt: 'Enter the password you got from the host.',
  passwordLabel: 'Password',
  unlockButton: 'Let me in',
  unlocking: 'Unlocking…',
  wrongPassword: 'Wrong password. Try again.',
  needsHttps: 'Open this game over HTTPS (for example on github.io) to unlock it.',

  // Song card
  hostOnly: 'Host only, memorize it!',
  theAnswer: 'The answer',
  mysteryRiff: 'Mystery riff',
  songHidden: 'Song hidden',

  // Hold button
  holdToPlay: 'HOLD TO PLAY',
  pressAndHold: 'Press & hold',
  replayFromTop: 'Replay from the top',
  playing: 'PLAYING',
  releaseToPause: 'Release to pause',
  loading: 'LOADING',
  keepHolding: 'Keep holding…',
  noAudio: 'NO AUDIO',
  fileUnavailable: 'File unavailable',

  // Status line
  statusLoading: 'Loading riff…',
  statusReady: 'Ready',
  statusBuffering: 'Buffering…',
  statusPlaying: 'Playing',
  statusPaused: 'Paused',
  statusEnded: 'End of riff',
  soundBlocked: 'Sound was blocked by the browser. Tap once, then hold again.',
  audioErrors: {
    network: 'Network error while loading the audio file.',
    decode: 'The audio file is corrupt or could not be decoded.',
    unsupported: 'Audio file missing or in an unsupported format.',
    notFound: 'Audio file not found.',
    unknown: 'The audio file could not be loaded.',
  },

  // Actions
  restartRiff: 'RESTART RIFF',
  revealAnswer: 'REVEAL ANSWER',
  answerRevealed: 'ANSWER REVEALED',
  previous: 'PREVIOUS',
  next: 'NEXT',

  // Settings
  songLanguage: 'Song language',
  decades: 'Decades',
  all: 'All',
  both: 'Both',
  interfaceLanguage: 'Interface language',
  gameMode: 'Game mode',
  modeHost: 'Host',
  modeSolo: 'Solo',
  modeHostHint: 'The host sees the song for 3 seconds at the start.',
  modeSoloHint: 'The song stays hidden until you reveal it.',
  done: 'Done',
  matchCount: (n: number) => (n === 1 ? '1 song matches' : `${n} songs match`),
  noMatches: 'No songs match these filters.',
  changeFilters: 'Change filters',

  languageName: { he: 'Hebrew', en: 'English' } as Record<SongLanguage, string>,
  decadeName: {
    '60': '60s',
    '70': '70s',
    '80': '80s',
    '90': '90s',
    '00': '2000s',
    '10': '2010s',
    '20': '2020s',
  } as Record<Decade, string>,
  /** Short labels for the decade filter chips. */
  decadeChip: { '60': '60s', '70': '70s', '80': '80s', '90': '90s', '00': '00s', '10': '10s', '20': '20s' } as Record<Decade, string>,

  // songs.json problems
  playlistErrors: {
    http: (status?: number) => `Could not load songs.json (HTTP ${status}).`,
    invalidJson: 'songs.json is not valid JSON. Check for missing commas or quotes.',
    notArray: 'songs.json must contain a JSON array of songs.',
    empty: 'songs.json is empty. Add at least one song.',
    notObject: (entry?: number) => `songs.json entry #${entry} is not an object.`,
    missingFields: (entry?: number, fields?: string[]) =>
      `songs.json entry #${entry} is missing ${fields?.map((f) => `"${f}"`).join(', ')}.`,
    invalidLanguage: (entry?: number, value?: string) =>
      `songs.json entry #${entry}: "language" must be "he" or "en" (got ${value}).`,
    invalidDecade: (entry?: number, value?: string) =>
      `songs.json entry #${entry}: "decade" must be one of 60, 70, 80, 90, 00, 10, 20 (got ${value}).`,
  },
};

export type Dict = typeof en;

const he: Dict = {
  tagline: 'שומעים את הריף. מנחשים את השיר.',
  song: 'שיר',
  settings: 'הגדרות',
  tuningUp: 'מכוונים את הגיטרה…',
  playlistProblem: 'בעיה ברשימת השירים',
  lockTitle: 'משחק פרטי',
  lockPrompt: 'הזינו את הסיסמה שקיבלתם מהמנחה.',
  passwordLabel: 'סיסמה',
  unlockButton: 'כניסה',
  unlocking: 'פותחים…',
  wrongPassword: 'סיסמה שגויה. נסו שוב.',
  needsHttps: 'כדי לפתוח את המשחק, היכנסו אליו בכתובת HTTPS (למשל ב־github.io).',

  hostOnly: 'רק למנחה, לזכור!',
  theAnswer: 'התשובה',
  mysteryRiff: 'ריף מסתורי',
  songHidden: 'השיר מוסתר',

  holdToPlay: 'החזיקו לניגון',
  pressAndHold: 'לחיצה ארוכה',
  replayFromTop: 'ניגון מההתחלה',
  playing: 'מנגן',
  releaseToPause: 'שחררו להשהיה',
  loading: 'טוען',
  keepHolding: 'המשיכו להחזיק…',
  noAudio: 'אין שמע',
  fileUnavailable: 'הקובץ לא זמין',

  statusLoading: 'טוען ריף…',
  statusReady: 'מוכן',
  statusBuffering: 'טוען…',
  statusPlaying: 'מנגן',
  statusPaused: 'מושהה',
  statusEnded: 'סוף הריף',
  soundBlocked: 'הדפדפן חסם את השמע. הקישו פעם אחת ואז החזיקו שוב.',
  audioErrors: {
    network: 'שגיאת רשת בטעינת קובץ השמע.',
    decode: 'קובץ השמע פגום או שלא ניתן לפענח אותו.',
    unsupported: 'קובץ השמע חסר או בפורמט שאינו נתמך.',
    notFound: 'קובץ השמע לא נמצא.',
    unknown: 'לא ניתן לטעון את קובץ השמע.',
  },

  restartRiff: 'ריף מההתחלה',
  revealAnswer: 'חשיפת התשובה',
  answerRevealed: 'התשובה נחשפה',
  previous: 'הקודם',
  next: 'הבא',

  songLanguage: 'שפת השירים',
  decades: 'עשורים',
  all: 'הכול',
  both: 'שתיהן',
  interfaceLanguage: 'שפת הממשק',
  gameMode: 'מצב משחק',
  modeHost: 'מנחה',
  modeSolo: 'סולו',
  modeHostHint: 'המנחה רואה את השיר ל־3 שניות בהתחלה.',
  modeSoloHint: 'השיר נשאר מוסתר עד שחושפים אותו.',
  done: 'סיום',
  matchCount: (n: number) => (n === 1 ? 'שיר אחד מתאים' : `${n} שירים מתאימים`),
  noMatches: 'אין שירים שמתאימים לסינון הזה.',
  changeFilters: 'שינוי הסינון',

  languageName: { he: 'עברית', en: 'אנגלית' },
  decadeName: {
    '60': 'שנות ה־60',
    '70': 'שנות ה־70',
    '80': 'שנות ה־80',
    '90': 'שנות ה־90',
    '00': 'שנות ה־2000',
    '10': 'שנות ה־2010',
    '20': 'שנות ה־2020',
  },
  decadeChip: { '60': '60', '70': '70', '80': '80', '90': '90', '00': '2000', '10': '2010', '20': '2020' },

  playlistErrors: {
    http: (status?: number) => `לא ניתן לטעון את songs.json (HTTP ${status}).`,
    invalidJson: 'הקובץ songs.json אינו JSON תקין. בדקו פסיקים או מירכאות חסרים.',
    notArray: 'הקובץ songs.json חייב להכיל מערך JSON של שירים.',
    empty: 'הקובץ songs.json ריק. הוסיפו לפחות שיר אחד.',
    notObject: (entry?: number) => `רשומה מס׳ ${entry} ב־songs.json אינה אובייקט.`,
    missingFields: (entry?: number, fields?: string[]) =>
      `ברשומה מס׳ ${entry} ב־songs.json חסר: ${fields?.map((f) => `"${f}"`).join(', ')}.`,
    invalidLanguage: (entry?: number, value?: string) =>
      `רשומה מס׳ ${entry} ב־songs.json: ‏"language" חייב להיות "he" או "en" (התקבל ${value}).`,
    invalidDecade: (entry?: number, value?: string) =>
      `רשומה מס׳ ${entry} ב־songs.json: ‏"decade" חייב להיות 60, 70, 80, 90, 00, 10 או 20 (התקבל ${value}).`,
  },
};

const dictionaries: Record<UiLang, Dict> = { he, en };
const STORAGE_KEY = 'riffoff:uiLang';

function readUiLang(): UiLang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'en' || v === 'he' ? v : 'he';
  } catch {
    return 'he';
  }
}

interface I18n {
  lang: UiLang;
  t: Dict;
  setLang: (lang: UiLang) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(readUiLang);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = useCallback((next: UiLang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage disabled */
    }
  }, []);

  const value = useMemo(() => ({ lang, t: dictionaries[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
