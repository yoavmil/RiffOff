# Guitar separation

Extracts the guitar stem from a song locally, for making RiffOff clips. It uses **BS-Roformer SW**, the model MVSep currently lists as its best guitar separator, run through [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator). It runs offline on the GPU once set up.

## Setup (PowerShell, from this folder)

Requires Python 3.11, ffmpeg on `PATH`, and an NVIDIA driver supporting CUDA 12.8 or newer. It falls back to the CPU, much more slowly.

```powershell
winget install Python.Python.3.11 Gyan.FFmpeg     # skip what you already have
& "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" -m venv .venv
.venv\Scripts\python -m pip install -r requirements.lock.txt   # or requirements.txt for unpinned

# Model weights + config (≈700 MB), then verify the checksum
mkdir models
$rel = "https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs"
Invoke-WebRequest "$rel/BS-Roformer-SW.ckpt" -OutFile models\BS-Roformer-SW.ckpt
Invoke-WebRequest "$rel/BS-Roformer-SW.yaml" -OutFile models\BS-Roformer-SW.yaml
Invoke-WebRequest "https://raw.githubusercontent.com/TRvlvr/application_data/main/filelists/download_checks.json" -OutFile models\download_checks.json
(Get-FileHash models\BS-Roformer-SW.ckpt).Hash   # expect 24E7D35EE9C64415673D3FD33E06A67CAC2C103C5DF6267BA1576459C775916E
```

## Usage

```powershell
.venv\Scripts\python separate_guitar.py "C:\Music\song.mp3" --output "C:\Music\output"
.venv\Scripts\python separate_guitar.py --list-models
.venv\Scripts\python separate_guitar.py "C:\Music\song.flac" --model BS-Roformer-SW.ckpt
```

This writes `<song>_guitar.wav` and `<song>_other.wav` (everything except guitar) as 44.1 kHz stereo 24-bit WAV files trimmed to the input's exact duration. Then make a game clip with the `ffmpeg` command in the main README.

`--model` accepts any audio-separator model file placed in `models/` that outputs a guitar stem.

You may see an onnxruntime "CUDA 13" warning at startup. It's harmless because Roformer models run on PyTorch, not ONNX.

## Studio: a web UI for adding songs (`studio.py`)

```powershell
.venv\Scripts\python studio.py      # or `npm run studio` from the repo root
```

Then open http://127.0.0.1:8765 (localhost only).

1. **Add songs:** paste one or more Spotify links (a search link or "Artist - Title" also works), one per line. Optionally set the language for all of them.
2. **Queue:** songs are prepared one at a time in the background (download + guitar separation, about 2.5 min for a 5-minute song). You can keep adding songs while it works.
3. **Mark the clip:** click a *ready* song. Play its guitar stem, then drag across the waveform to select the clip, drag the edges to adjust, or set start and end to the playhead (`[` and `]`). Fine-tune by ½ s or type the times. *Play clip* (or `C`) plays just the selection, optionally looping.
4. **Save:** check the title, artist, language and decade (pre-filled from Spotify), then *Save clip to playlist*. The studio cuts the clip (`riff.py snip`), copies it to `private/audio/NN.mp3`, appends it to `private/songs.json` and uploads the MP3 library to private Cloudflare R2 storage. Configure the local administrator token as described in [the library README](../../cloudflare/library/README.md). Playlist changes need no Git commit or site rebuild.
5. **Give up** on a song at any point, whether it's queued, being separated, ready or failed. It stops the work and deletes that song's files. A failed song can also be retried, and its log shows what went wrong.

The queue is saved in `studio-queue.json` (git-ignored, because it names the songs), so it survives a restart. Folders in `riffs\` that were prepared with the CLI but never clipped show up as ready.

## Spotify link → game clip, from the command line (`riff.py`)

```powershell
# 1. Download and write the guitar stem to riffs\<Artist - Title>\guitar.mp3
.venv\Scripts\python riff.py prepare "https://open.spotify.com/track/<track id>"
#    Also accepts a Spotify search link or plain "Artist - Title" (top Spotify match is used),
#    plus optional --year 1994 (original release; Spotify's may be a remaster) and --language en|he

# 2. Cut the clip (times in seconds or m:ss; omit --end to run to the end of the song)
.venv\Scripts\python riff.py snip "riffs\Artist - Title" --start 2:03 --end 2:46
```

- spotdl takes only metadata from Spotify. The audio is the matching YouTube Music upload, so check you got the right version.
- The download and all non-guitar stems are deleted.
- `meta.json` records the title, artist, album, year, the app's `decade` value and the clip times. `clip.mp3` is mono, 128 kbps, with a 20 ms fade-in and 300 ms fade-out.
- A 5-minute song takes about 2.5 minutes: download plus 2 min of separation. Run at most 2 at a time; one separation already keeps the GPU at ~99%.
- To add a CLI-made clip to the game, copy `clip.mp3` to `private/audio/NN.mp3`, add a `private/songs.json` entry and run `npm run library:upload`. The studio does all of this when you save.

### How the toolchain was chosen

Each song originally produced three candidates:
1. the SW guitar stem;
2. SW guitar plus SW "other";
3. Demucs htdemucs_6s guitar.

Over 11 songs (`picks.csv`, kept locally and git-ignored because it names the quiz songs), candidate 1 won or tied every time and Demucs never won, so only candidate 1 is kept. The first row predates the three-way setup: it was a straight SW vs Demucs comparison.

## Model source and license

| Item | Source | License |
|---|---|---|
| BS-Roformer SW weights | [python-audio-separator release `model-configs`](https://github.com/nomadkaraoke/python-audio-separator/releases/tag/model-configs), SHA-256 matches GitHub's published digest | **Unclear.** No license from the original author. The original HF repo `jarredou/BS-ROFO-SW-Fixed` now requires login, and third-party mirrors variously say CC-BY-NC-SA-4.0 or "unknown". Treat it as personal, non-commercial use and don't redistribute it. |
| Inference code | python-audio-separator 0.47.1 | MIT |
| Architecture | BS-RoFormer ([lucidrains](https://github.com/lucidrains/BS-RoFormer), [ZFTurbo MSST](https://github.com/ZFTurbo/Music-Source-Separation-Training)) | MIT |

## How this relates to MVSep

- MVSep's "MVSep Guitar" page lists **BS Roformer SW** as its top guitar model (guitar SDR 9.05, vs 7.51 for MVSep's older own BS+Mel-Roformer guitar ensemble and 5.22 for Demucs 6s). These are MVSep's scores, not ours.
- MVSep's older guitar models (MelRoformer 2024.06 and its ensembles) and newer leaderboard entries such as `bs_mega_53stem_guitar_mvsep` aren't publicly downloadable.
- MVSep doesn't publish its exact inference settings: overlap, chunk size, or whether it ensembles or post-processes for its guitar service. We use the model's shipped config (`num_overlap: 2`, chunk 588800). The weights match, but **identical output to MVSep isn't verified.** Compare by ear on the same song.

## Test results: a 5:19 rock song, RTX 2000 Ada Laptop (8 GB)

- Processing time: 129 s, which is 2.5× real time. Model loading adds a few seconds.
- Peak GPU memory: 1.44 GiB by PyTorch's count, ~2.5 GiB above idle by `nvidia-smi`.
- Output: duration matches the input (318.942 s), 44.1 kHz stereo, no clipped samples in the guitar stem.

Comparison with Demucs `htdemucs_6s`, using proxy measures only. There are no ground-truth stems, so these are **not SDR**:

| Proxy (lower = less leakage) | BS-Roformer SW | htdemucs_6s |
|---|---|---|
| Vocal energy found in the guitar stem by an independent vocal model (MelBand-Roformer), sung sections | **−45 dB** | −16 dB |
| Energy below 60 Hz (bass bleed) | **−40 dB** | −36 dB |
| Energy above 10 kHz (cymbal bleed, but also guitar air) | −71 dB | −51 dB |
| Percussive share (HPSS) | 13.8 % | 16.0 % |

Spectrograms show Demucs's guitar carrying vocal harmonics, drum transients and a broadband haze. SW is much cleaner but darker above ~6 kHz, with high frequencies gated between strums. That could sound slightly dull or "pumping" on some material. Matched 20-second A/B clips are in `output/compare/`.
