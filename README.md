# RiffOff

**Hear the riff. Name the hit.** RiffOff is a mobile-first music quiz for a single quiz host. The host holds a big button to play an isolated guitar riff, and the players shout out the song.

This is a proof of concept with no accounts, scoring or multiplayer. A React + TypeScript app built with Vite runs as an installable PWA. A small Cloudflare Worker protects the playlist and streams MP3 clips from a private R2 bucket.

## Quick start

Requires Node.js 22 or newer (including the Cloudflare development tools).

```bash
npm install
npm run dev
```

Open the **Local** URL that Vite prints (http://localhost:5173).

### Playing from a phone on the same Wi-Fi

`npm run dev` already listens on your network. Vite prints a second URL:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.23:5173/
```

1. Connect the phone to the same Wi-Fi network as the computer.
2. Open the **Network** URL in Chrome (Android) or Safari (iPhone).
3. If the page doesn't load, allow Node.js through the computer's firewall. On Windows, accept the "Windows Defender Firewall" prompt for private networks the first time.

## Production build

```bash
npm run build      # type-checks and outputs a static site in dist/
npm run preview    # serves dist/ on http://localhost:4173 and on the LAN
```

`dist/` is plain static files. You can host it on any static host, such as Netlify, Vercel, GitHub Pages, or Nginx. To serve it from a sub-path, set `BASE_PATH` when building, for example `BASE_PATH=/RiffOff/ npm run build`.

### GitHub Pages

The live app is at **https://yoavmil.github.io/RiffOff/**. Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which builds with `BASE_PATH=/RiffOff/` and publishes `dist/` to the `gh-pages` branch. GitHub Pages serves the site from that branch.

**Installing as an app (PWA):** browsers only enable the service worker and the "Install app" prompt on HTTPS (or `localhost`). For a real home-screen app, deploy `dist/` to an HTTPS host:

- **Android Chrome:** menu ⋮ → *Install app* / *Add to Home screen*.
- **iPhone Safari:** Share → *Add to Home Screen*. This also works over plain LAN HTTP, without offline support.

## Editing the playlist

The deployed playlist is password-protected; see [The private playlist](#the-private-playlist-password-protected) below. The format is the same everywhere. The demo playlist is [public/songs.json](public/songs.json): edit it and refresh the page; no code changes or rebuild are needed while running `npm run dev`. For a production build, edit `dist/songs.json` or rebuild.

```json
[
  {
    "id": 1,
    "title": "Neon Highway",
    "artist": "The Sample Rates",
    "language": "en",
    "decade": "80",
    "audioFile": "/audio/01.mp3"
  },
  {
    "id": 2,
    "title": "יושב על הגדר",
    "artist": "משינה",
    "language": "he",
    "decade": "80",
    "audioFile": "/audio/02.mp3"
  }
]
```

- **Order matters.** Songs play exactly in the order they appear in the file. Nothing is shuffled. Filtering only skips songs; it never reorders them.
- `title`, `artist`, `audioFile`, `language` and `decade` are required. `id` is optional.
- `language` is `"he"` (Hebrew) or `"en"` (English). `"Hebrew"` and `"English"` are accepted too.
- `decade` is one of `"60"`, `"70"`, `"80"`, `"90"`, `"00"`, `"10"` or `"20"`. A year such as `1985` or a form such as `"80s"` is accepted too.
- `audioFile` is a path inside `public/` (for example, `/audio/my-riff.mp3`) or a full `https://` URL.
- If the file has a mistake, such as a missing comma, field or tag, the app shows which entry is wrong instead of starting.

### Where to put audio files

Put audio files in `private/audio/` (real songs) or [public/audio/](public/audio/) (demo or royalty-free clips only) and reference them as `/audio/<file name>`.

- **Recommended format:** MP3 (128–192 kbps) or AAC/M4A. Both play everywhere, including iOS Safari.
- **WAV** works but is large. Ogg/Opus doesn't play on older iPhones.
- **Keep clips short and trimmed** to the riff itself. Small files start instantly.
- **Tip:** use neutral file names such as `01.mp3` and `02.mp3`. The app never shows file names, but neutral names stop a curious player from spotting the answer in the URL.

For cleaner guitar stems than Demucs, use the local BS-Roformer tool in [tools/guitar-separation](tools/guitar-separation/README.md).

To convert a separated stem (for example, Demucs output in `separated/…/guitar.wav`) to a compact MP3 with [ffmpeg](https://ffmpeg.org/):

```bash
ffmpeg -i "separated/htdemucs_6s/Artist - Title/guitar.wav" -ss 0 -t 30 -b:a 192k private/audio/01.mp3
```

`-ss` sets the start time and `-t` sets the clip length in seconds. Recordings of commercial songs are for your private game night only; don't redistribute them.

### The private playlist (password-protected)

The real playlist is guitar-only clips of real songs, made with [tools/guitar-separation](tools/guitar-separation/README.md). Those recordings must not be published, so they never go into git or `public/` as plain files:

```text
private/                  git-ignored, stays on your computer
  songs.json              the real playlist (same format as above; audioFile: "/audio/01.mp3")
  audio/01.mp3 …          the clips
  cloudflare-admin.json   local Worker URL and administrator upload token
```

The easiest way to add songs is the studio: run `npm run studio`, open http://127.0.0.1:8765, paste Spotify links, mark each clip on its guitar waveform and save. It updates `private/` and uploads the library to Cloudflare (see [tools/guitar-separation](tools/guitar-separation/README.md)).

After changing anything in `private/`, run:

```bash
npm run library:upload    # uploads MP3s and publishes the private playlist to R2
```

The recordings are ordinary `.mp3` objects in the private `riffoff-songs` R2 bucket, with content hashes as filenames. The `riffoff-library` Worker checks the player's password and serves the playlist and audio through signed session URLs. `public/library.json` contains only its public endpoint. Share the game password with your players; their devices remember a session for 30 days. The password and administrator upload token are Worker secrets and never ship with the app.

The Worker supports MP3 byte-range requests for iOS Safari and Android Chrome. The app shell can work offline, but the private library requires a network connection. See [Cloudflare library setup and maintenance](cloudflare/library/README.md) for credentials, deployment, migration, and verification.

Without `public/library.json`, the app falls back to [public/songs.json](public/songs.json), which uses synthesized demo riffs in `public/audio/*.wav` (`npm run generate:samples` regenerates them and the app icons). An unavailable configured cloud service shows an error instead of silently switching playlists.

## How to host a round

1. When a song is selected, its **title and artist show for 3 seconds**. Read them privately. The 3-second bar at the bottom of the card shows the time left.
2. The card switches to **??? / ???**. Turn the phone to the players.
3. **Hold** the big button to play. Lift your finger to pause. Hold again to continue from the same spot.
4. **REVEAL ANSWER** shows the answer until you move to another song.
5. **RESTART RIFF** jumps back to the start without playing.
6. **NEXT** / **PREVIOUS** stop the music and load the other song from its beginning.

The current song is saved, so a page refresh returns to the same song. It doesn't autoplay, and it shows the 3-second preview again.

### Settings: filters and interface language

Tap the sliders button in the header to open **Settings** (הגדרות):

- **Game mode:** *Host* (מנחה) shows each song for 3 seconds when it is selected. *Solo* (סולו) never shows it at the start, so you can play along yourself; the answer appears only when you tap REVEAL ANSWER. This applies immediately.
- **Song language:** Hebrew, English, or both.
- **Decades:** pick any combination, or *All*.
- **Interface language:** the UI is Hebrew (right-to-left) by default. Switch to English here.

The sheet shows how many songs match while you choose. Filters apply when you tap **Done** (סיום): the game then plays only the matching songs, still in playlist order. If the current song still matches, you stay on it; otherwise the game starts at the first matching song. Filters, the game mode and the interface language are remembered on the device. The song's language and decade tags are shown only while the answer is visible, because they would be hints.

## How the hold-to-play button stays reliable

The playback logic is in [src/core/useAudioPlayer.ts](src/core/useAudioPlayer.ts), and the touch handling is in [src/core/useHoldGesture.ts](src/core/useHoldGesture.ts). Every design uses both unchanged.

- **One audio element:** the app uses a single persistent `HTMLAudioElement`, outside the DOM and with no native controls.
- **Intent flag:** a "holding" flag records the host's intent and is checked on every async path. If `audio.play()` resolves after the finger has lifted, the audio is paused immediately. If a `playing` or `timeupdate` event arrives while nothing is held, the audio is paused too.
- **Always pause on release:** `pause()` is called on every release, which also aborts a pending play request.
- **Load token:** each song load gets a token, so a late promise from a previous song can't affect the new one.
- **Pointer handling:** the button uses Pointer Events with pointer capture. A press is cancelled by sliding more than 16 px off the button, `pointercancel`, or `lostpointercapture`. It also ends when the window loses focus, the page becomes hidden (`visibilitychange`, `pagehide` or `freeze`), or the track ends.
- **No long-press side effects:** `touch-action: none`, a non-passive `touchstart` handler, `-webkit-touch-callout: none`, `user-select: none` and a blocked `contextmenu` stop iOS and Android long-press menus, magnifiers and scrolling.
- **Mobile autoplay rules:** `play()` is called synchronously inside the `pointerdown` handler. Chrome on Android doesn't count a touch `pointerdown` as a user gesture, so the first tap anywhere (including the release of the first hold) also briefly plays the element muted to unlock it.
- **Media Session privacy:** generic metadata ("RiffOff / Mystery riff") replaces the song name on lock screens and in media notifications. The lock-screen *play* action is disabled, and the page title is always "RiffOff".
- **Error handling:** a missing file is detected up front with a `HEAD` request, because iOS doesn't load media until the first play. Missing and undecodable files both show a clear error on the button and the status line, without revealing the file name.
- **Preloading:** the next song is preloaded into a separate, muted, never-played element after the current song settles.

## Project structure

```text
public/
  library.json            Cloudflare library endpoint (no credentials)
  audio/                  audio clips (01.mp3, 02.mp3, …)
  icons/                  PWA / home-screen icons
  songs.json              the playlist, in play order
  manifest.webmanifest    PWA manifest
  sw.js                   service worker (caches the app shell, never audio)
scripts/
  generate-samples.mjs    regenerates the icons (and test-only demo riffs)
pages/
  index.html              the app page (served at /)
src/
  core/                   all game logic, shared by every design
    useAudioPlayer.ts     the single audio element and its state machine
    useHoldGesture.ts     pointer / keyboard press-and-hold handling
    useGame.ts            current song, 3-second preview, reveal, navigation
    useLibrary.ts         playlist loading, filters, settings open/close
    useSettingsDraft.ts   draft filters for a settings screen
    songs.ts              playlist validation, filters, saved state and demo loading
    cloudLibrary.ts       password/session flow and private cloud playlist loading
    i18n.tsx              Hebrew / English strings and the language context (RTL switch)
    text.ts               labels and status / error text helpers
    mount.tsx             entry point, service worker registration
  designs/
    README.md             how to build a design: core API and the required test IDs
    amp/                  the "Stage Amp" UI, presentation only: App.tsx, components, styles, main.tsx
```

### UI designs

The UI is the **Stage Amp** design: a vintage amp with a stomp-box pedal as the hold control, a VU meter that tracks playback, and an amp nameplate as the answer card. It contains no game logic, so the look can be redesigned without touching playback. To try an alternative design side by side, follow [src/designs/README.md](src/designs/README.md).

## Manual test checklist (real phones)

Automated headless-Chrome checks cover these flows, but please also try them on a real iPhone and Android phone:

1. The first song's title shows for 3 seconds, then hides.
2. Holding plays the audio, and releasing pauses it.
3. Holding again resumes from the same position.
4. Rapid taps never leave the audio playing.
5. Sliding the finger off the button pauses it.
6. NEXT and PREVIOUS stop playback and start the other song from 0:00.
7. REVEAL stays visible until you navigate.
8. RESTART RIFF returns to 0:00 without playing.
9. A refresh keeps the song number.
10. An entry pointing to a missing file shows an error (temporarily add one to `songs.json` to check).
11. Switching apps or locking the phone while holding stops the sound.
12. Nothing ever starts playing on its own.
