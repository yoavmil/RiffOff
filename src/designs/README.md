# RiffOff UI designs

The UI is a "design" that reuses the game logic from `src/core/` and owns only presentation: markup, CSS, fonts, icons and animation. The app's design is **Stage Amp** (`src/designs/amp/`), served at the root URL. An alternative design can be added as an extra page to compare side by side.

| URL (dev / GitHub Pages)  | Page                         | Code                    |
| ------------------------- | ---------------------------- | ----------------------- |
| `/` · `/RiffOff/`         | `pages/index.html` (the app) | `src/designs/amp/`      |
| `/<slug>/` · `/RiffOff/<slug>/` | `pages/<slug>/index.html` | `src/designs/<slug>/`   |

Vite builds every `pages/*/index.html` automatically. Copy `pages/index.html` to `pages/<slug>/index.html` for a new design and change its script to `/src/designs/<slug>/main.tsx` (keep the `/src/` prefix, which is aliased to the source folder).

## Core API (don't edit `src/core/` from a design)

```tsx
import { mount } from '../../core/mount';            // main.tsx: mount(App)
import { useI18n } from '../../core/i18n';           // { t, lang, setLang }; t = translated strings
import { useLibrary } from '../../core/useLibrary';  // songs, loadError, playlist, filters, gameKey, settings open/close
import { useGame } from '../../core/useGame';        // per-playlist state; mount in <Game key={library.gameKey}>
import { useHoldGesture } from '../../core/useHoldGesture'; // spread on the hold element
import { useSettingsDraft } from '../../core/useSettingsDraft'; // draft filters for a settings UI
import { holdLabels, statusText, playlistErrorText, formatTime } from '../../core/text';
import { DECADES } from '../../core/songs';
```

`src/designs/amp/` is the reference implementation: read `App.tsx` and its `components/` first. The usual shape:

```tsx
function App() {
  const library = useLibrary();
  // loadError -> error screen; !songs -> loading screen;
  // playlist.length === 0 -> empty state (with a button to open settings);
  // else <Game key={library.gameKey} songs={library.playlist} … />
  // {library.settingsOpen && <Settings songs={library.songs} filters={library.filters} onClose={library.closeSettings} />}
}
function Game({ songs }) {
  const game = useGame(songs);          // game.player is the audio player
  const hold = useHoldGesture({ active: game.player.holding, disabled: game.player.status === 'error',
                                onPress: game.player.press, onRelease: game.player.release });
  return <button data-testid="hold" {...hold}>…</button>;
}
```

Key fields: `game.song` (`title`, `artist`, `language`, `decade`), `game.index`/`count`, `game.answerVisible`, `game.previewing` (first 3 s after selection; show a countdown using `game.previewMs` and restart it with `key={game.selection}`), `game.revealed`, `game.progress` (0..1), `game.next/previous/reveal`, `game.canNext/canPrevious`. Player: `status` (`loading | ready | buffering | playing | paused | ended | error`), `holding`, `currentTime`, `duration`, `restart()`, `release()`. Call `player.release()` before opening settings.

Strings come from `t` (Hebrew and English). A design may add a few design-specific words in its own folder, but it must provide both `he` and `en` and pick them with `useI18n().lang`.

## Test-ID contract (required)

The shared acceptance test drives every design through these attributes only:

| `data-testid`       | Element / requirement |
| ------------------- | --------------------- |
| `hold`              | The element with `{...useHoldGesture(...)}` spread on it (carries `aria-pressed`, `aria-disabled`). |
| `song-title`, `song-artist` | Text is the answer only while `game.answerVisible`; otherwise a placeholder. The answer, and the language/decade tags, must not be in the DOM while hidden. |
| `song-counter`      | Has `data-position={`${index + 1}/${count}`}`. |
| `status`            | Has `data-status={player.status}`; its text is `statusText(player, t)`. |
| `reveal`, `restart` | Buttons. |
| `prev`, `next`      | Buttons with the `disabled` attribute when they're unavailable. |
| `settings-open`     | Opens settings. |
| `settings-done`     | Applies and closes settings. |
| `lang-he`, `lang-en`, `lang-both` | Song-language filter options. |
| `decade-all`, `decade-60` … `decade-20` | Decade options (`DECADES`). |
| `match-count`       | Has `data-matches={matches}`. |
| `ui-he`, `ui-en`    | Interface-language options. |
| `mode-host`, `mode-solo` | Game-mode options (`library.solo` / `library.setSolo`; pass `{ solo }` to `useGame`). |
| `empty-state`       | Shown when no songs match. |
| `playlist-error`    | Shown when songs.json fails to load. |

## Non-negotiables

- **The hold control is the hero:** large, centred, usable one-handed without looking. Use `{...hold}` and never add your own pointer or click handlers to it. If it needs a `style` prop, merge it: `style={{ ...hold.style, ...yours }}`.
- **Clear states:** loading, ready, holding/playing, paused, end of riff, and error must each look distinct.
- **Right-to-left:** Hebrew is the default and sets `dir="rtl"` on `<html>`. Layouts must mirror correctly. Use logical CSS properties (`margin-inline-start`, `inset-inline-end`) and wrap numeric runs such as `3 / 20` in `<bdi dir="ltr">`. Song titles get `dir="auto"` and `lang={song.language}`.
- **Fonts:** self-hosted `@fontsource` packages only (already installed; check `package.json`). Hebrew text needs a font with Hebrew glyphs. No CDN, network fonts or new npm installs.
- **Phone first:** works at 360×640 through 430×932 with no horizontal scroll and no clipped controls. Respect `env(safe-area-inset-*)`. Touch targets are at least 44 px. Honour `prefers-reduced-motion`.
- **Secrecy:** `<title>` stays `RiffOff`. No `title=` tooltips with song data.
