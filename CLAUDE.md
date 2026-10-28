# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RiffOff is a mobile-first music quiz PoC (React 18 + TypeScript + Vite, plus a small Cloudflare Worker serving a private R2 song library). A single quiz host holds a big button to play an isolated guitar riff, and the players guess the song out loud. The top priority is **reliable hold-to-play on iOS Safari and Android Chrome**, then simplicity and visual polish. The PoC deliberately has no scoring, accounts or multiplayer, and its only frontend runtime dependencies are React and self-hosted `@fontsource` fonts.

## Commands

```bash
npm install
npm run dev               # Vite dev server on :5173, exposed on the LAN (--host) for phone testing
npm run build             # tsc -b (type-check) + vite build -> dist/
npm run preview           # serve dist/ on :4173 (LAN too); the service worker is only active in prod builds
npm run typecheck         # tsc -b only
npm run generate:samples  # regenerate synthesized demo riffs (public/audio/*.wav) and PWA icons (public/icons/*.png)
```

**Deployment:** pushing to `main` deploys to https://yoavmil.github.io/RiffOff/ through `.github/workflows/deploy.yml`, which builds with `BASE_PATH=/RiffOff/` and publishes to the `gh-pages` branch. All runtime URLs must go through `import.meta.env.BASE_URL` (see `resolveAudioUrl`), or they break under the sub-path. Under Git Bash on Windows, prefix local sub-path builds with `MSYS_NO_PATHCONV=1`, or `/RiffOff/` gets rewritten to a Windows path.

There is no linter. `npm run test:library` checks the Worker and cloud client; `npm run library:verify` checks all live migrated MP3 hashes and range/auth behavior against the ignored migration export. Playback behavior was verified with ad-hoc Playwright scripts driving installed Chrome. When changing playback logic, re-verify with touch emulation (CDP `Input.dispatchTouchEvent`) and `--autoplay-policy=user-gesture-required`.

## Architecture

**Core logic and the UI are separate.** All logic lives in `src/core/` as hooks with no markup: `useLibrary` (playlist, filters, settings), `useGame` (position, preview, reveal, player), `useAudioPlayer`, `useHoldGesture`, `useSettingsDraft` and the `text.ts` helpers. The UI is the "Stage Amp" design in `src/designs/amp/` (vintage amp: stomp-box pedal hold control, VU meter, nameplate answer card), which is presentation only and is served from `pages/index.html`. Vite's root is `pages/`, every `pages/*/index.html` is a build input, and `/src/` is aliased to the source folder, so page scripts use `/src/designs/<slug>/main.tsx`. An alternative design can be added as another `src/designs/<slug>/` served from `pages/<slug>/index.html`. Every design must implement the `data-testid` contract in `src/designs/README.md`. Keep logic out of the design layer: put it in `src/core/`.

**Data flow:** `public/songs.json` → `loadSongs()` in `src/core/songs.ts` (fetch, validate, normalize the `language`/`decade` tags, preserve order) → `useLibrary` applies the `Filters` → a design's `Game` component calls `useGame(playlist)`, which owns the position, preview and reveal state and calls `useAudioPlayer(src, nextSrc)`. `Game` must be keyed on `library.gameKey`, so a filter change remounts it with a fresh audio element and a new preview. `useSettingsDraft` edits a draft and applies it on close, so the game remounts only once.

- **The playlist JSON is the only source of song data.** Never hardcode titles in the UI, and never shuffle the order. `resolveAudioUrl` prefixes `import.meta.env.BASE_URL`, so the app also works from a sub-path.
- **Saved state:** `localStorage` holds the current song as `Song.key` (its position in the full `songs.json`, not in the filtered list) under `riffoff:songIndex`, plus `riffoff:filters`, `riffoff:uiLang` and `riffoff:solo`. Playback position and reveal state are intentionally not persisted.
- **i18n:** `src/core/i18n.tsx` holds both dictionaries (`he` is the default and sets `dir=rtl` on `<html>`). Every user-facing string goes through `useI18n().t`, including errors: `useAudioPlayer` and `loadSongs` return codes (`AudioErrorCode`, `PlaylistError`) that the UI translates. Each design picks its own Hebrew-capable font, usually applied through `:lang(he)`; song titles carry `lang={song.language}` and `dir="auto"`. Wrap numeric runs such as `3 / 20` in `<bdi dir="ltr">`, or RTL reverses them.
- **Tags are hints:** a song's language and decade appear only while the answer is visible.
- **Setup screen:** after the playlist loads (right after the password, and on every app launch), designs show a setup page while `library.setupDone` is false: game mode, song language and decades (pre-filled from the saved choices), then START calls `library.startGame(filters)`. It is not persisted, so a refresh shows it again.
- **Solo mode** (`library.solo`, passed as `useGame(songs, { solo })`) skips the preview entirely: the answer appears only on reveal. It applies immediately without remounting the game.
- **Song preview timer:** the 3-second answer preview is a timeout keyed on a `selection` counter that `goTo()` increments. It starts on selection, not on playback. Designs render the title and artist only while `game.answerVisible` is true.

### `src/core/useAudioPlayer.ts`: the core and the most delicate code

**One player element.** A single persistent `HTMLAudioElement` is created once and is never attached to the DOM. A second, muted element is used only to preload the next track and is never played.

**Invariants to keep when editing:**
- **`holdingRef` is the user's intent and the source of truth.** Every async path checks it and pauses if it is false: the `play()` promise resolution, the `playing` event and `timeupdate`. `release()` always calls `pause()`, even when the element is already paused, because that aborts a pending `play()` request.
- **`loadTokenRef` invalidates stale work.** It increments on every source change, so late promises and `HEAD` checks from a previous song are ignored.
- **`press()` must call `audio.play()` synchronously** inside the pointer handler, to satisfy mobile autoplay rules.
- **A one-time "unlock" runs on the first `pointerup`/`touchend`/`click`/`keydown` on the document.** It briefly plays the element muted, because Chrome on Android doesn't treat a touch `pointerdown` as user activation. It listens in the bubble phase on purpose, so the hold button's own release runs first.
- **Missing files are detected with a `HEAD` request**, because iOS doesn't fetch media until the first play. A `text/html` response counts as missing too, since SPA hosts and the dev server fall back to `index.html`.
- **Song details must never leak.** The Media Session always gets generic metadata, the lock-screen `play` action is a no-op, and `<title>` stays "RiffOff". Error messages must not include the file name, because file names may reveal the answer.
- **Pause on any loss of the page:** `blur`, `visibilitychange` (hidden), `pagehide` and `freeze`.

### `src/core/useHoldGesture.ts`

Designs spread its bindings on their hold element and must not add their own pointer handlers to it.

**Pointer tracking:** it uses Pointer Events with `setPointerCapture` and tracks a single pointer id. With capture on, `pointerleave` never fires, so "finger slid off the button" is detected in `pointermove` with a 16 px slop. A press also ends on `pointerup`, `pointercancel` and `lostpointercapture`.

**Long-press suppression:** a native non-passive `touchstart` `preventDefault` is needed, because React's `touchstart` handlers are passive. CSS adds `touch-action: none` and `-webkit-touch-callout: none`.

**Hold state comes from the player.** When `active` turns false (track ended, song changed, window blurred), the button forgets the tracked pointer, so a finger that is still down never restarts playback.

### PWA: `public/sw.js`

- The service worker is registered only in production, from `src/core/mount.tsx`.
- **It must not intercept `/audio/` or any `Range` request.** iOS Safari breaks if a service worker answers a media range request with a plain 200.
- `songs.json` and page navigations are network-first, and navigations are cached per URL because each design is its own page; other assets are cache-first.
- Bump `CACHE` when changing the app-shell caching.

## Content notes

- **The real playlist lives in private Cloudflare R2 storage as MP3s.** `private/` is git-ignored and holds the local playlist (`private/songs.json`), clips (`private/audio/NN.mp3`) and administrator credentials (`private/cloudflare-admin.json`, plus a local Worker secrets recovery file). Never commit, push or copy these into `public/`, and never write passwords or tokens into tracked files. `npm run library:upload` uploads content-hashed MP3s followed by `songs.json` to the `riffoff-songs` bucket through the `riffoff-library` Worker. `public/library.json` contains only the HTTPS Worker origin. `src/core/cloudLibrary.ts` exchanges the player's password for a signed 30-day session, remembers that session, and loads the playlist with signed audio URLs. The Worker authenticates audio GET/HEAD and serves byte ranges for mobile browsers; the frontend never decrypts clips. Without `library.json`, `public/songs.json` and synthesized demo riffs are used; tests can select demos by answering `library.json` with 404. Configured service failures must remain errors. See `cloudflare/library/README.md` for deployment, secrets, and verification. Historical Git commits still contain the old encrypted vault; do not rewrite history as part of routine song updates.
- **`separated/`** is git-ignored local separation output. Only one song's `guitar.wav` is left there.
- **Never put real playlist song names in tracked files** (docs, examples, test fixtures, commit messages): the repo is public, and the names are the quiz answers. `tools/guitar-separation/picks.csv` is git-ignored for this reason.
- **`tools/guitar-separation/`** is a standalone Python 3.11 tool (own `.venv`) that extracts guitar stems with BS-Roformer SW. Its `.venv`, `models/` and `output/` are git-ignored. See its README.
- **Studio:** `npm run studio` (`tools/guitar-separation/studio.py`, stdlib HTTP server on 127.0.0.1:8765, plain-JS UI in `studio/`) is the user's main way to add songs: a queue that runs `riff.py prepare` one job at a time as a child process (so 'give up' can kill it and delete the song folder), a waveform editor to mark the clip, and save = `riff.py snip` + copy to `private/audio/NN.mp3` + append to `private/songs.json` + `npm run library:upload`. State is in git-ignored `studio-queue.json`. Test it against scratch folders with `RIFF_RIFFS_DIR`, `RIFFOFF_PRIVATE_DIR`, `STUDIO_STATE_FILE`, `STUDIO_PORT`, and a test library endpoint/token, never against the real `private/` or production bucket.
- **Adding a song from a Spotify link:** run `riff.py prepare <link> [--year Y --language en|he]` from `tools/guitar-separation` with its `.venv` python. A search link or "Artist - Title" also works. Each job uses ~2.5 GB of the 8 GB GPU, so run at most 2 at a time. It needs ffmpeg on PATH. It writes one `guitar.mp3`, the BS-Roformer SW guitar stem. The user settled on this toolchain on 2026-10-26 after comparing other candidates (see `picks.csv`); don't add candidates back. With their start/end times, run `riff.py snip <dir> --start … [--end …]` (no `--end` means the end of the song). Then copy `clip.mp3` to the next free `private/audio/NN.mp3`, append an entry to `private/songs.json` and run `npm run library:upload`, using the user's title/artist spelling and the decade from `meta.json`. If the clip ends in silence (e.g. a vocal-only outro), trim to just after the last guitar sound.
