"""Turn a Spotify track into a guitar-only RiffOff clip.

    python riff.py prepare "https://open.spotify.com/track/..."
        Downloads the song (spotdl, audio from YouTube Music) and writes its
        BS-Roformer SW guitar stem to riffs/<Artist - Title>/guitar.mp3. The
        download and all non-guitar stems are deleted.

    python riff.py snip "riffs/<Artist - Title>" --start 0:12.5 --end 0:42
        Cuts guitar.mp3 into clip.mp3 and records the times in meta.json.

Other candidates (SW guitar + "other", Demucs htdemucs_6s) were compared on 11
songs and dropped on 2026-10-26; the results are in picks.csv.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote

import soundfile as sf

from separate_guitar import SCRIPT_DIR, device_name, fail, separate, write_wav

RIFFS_DIR = Path(os.environ.get("RIFF_RIFFS_DIR", SCRIPT_DIR / "riffs"))  # env override: tests
SW_MODEL = "BS-Roformer-SW.ckpt"
GUITAR_FILE = "guitar.mp3"
# Everything is mono (-ac 1): plenty for a riff on a phone speaker, and smaller files.
GUITAR_BITRATE = "192k"
CLIP_BITRATE = "128k"
FADE_IN, FADE_OUT = 0.02, 0.3  # seconds; avoids clicks at the cut points


def ffmpeg(*args):
    result = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if result.returncode != 0:
        fail(f"ffmpeg failed: {result.stderr.strip()}")


def spotdl(*args, cwd):
    # UTF-8 mode so Hebrew titles don't crash on a cp1252 Windows console.
    result = subprocess.run([sys.executable, "-X", "utf8", "-m", "spotdl", *args], cwd=cwd)
    if result.returncode != 0:
        fail(f"spotdl {args[0]} failed (exit code {result.returncode}); see its output above")


def safe_name(text):
    return re.sub(r'[<>:"/\\|?*]', "", text).strip(" .")


def decade(year):
    # songs.json accepts 60, 70, 80, 90, 00, 10, 20
    return f"{year % 100 // 10}0" if year and year >= 1960 else None


def write_mp3(path, audio, sample_rate, bitrate):
    with tempfile.TemporaryDirectory() as temp_dir:
        wav = Path(temp_dir) / f"{path.stem}.wav"
        write_wav(wav, audio, sample_rate)
        ffmpeg("-i", str(wav), "-ac", "1", "-b:a", bitrate, str(path))


def parse_time(text):
    """Accepts seconds ("75.5") or m:ss / h:mm:ss ("1:15.5", ":36")."""
    try:
        seconds = 0.0
        for part in text.split(":"):
            seconds = seconds * 60 + float(part or 0)
        return seconds
    except ValueError:
        fail(f"invalid time {text!r}; use seconds (75.5) or m:ss (1:15.5)")


def spotdl_query(source):
    """A track link passes through; a search link or plain text becomes a search query."""
    if re.match(r"https://open\.spotify\.com/(intl-\w+/)?track/", source):
        return source
    search = re.match(r"https://open\.spotify\.com/search/([^?#]+)", source)
    if search:
        return unquote(search.group(1))
    if source.startswith("http"):
        fail("expected a Spotify track or search link, or plain 'Artist - Title' text")
    return source


def prepare(source, year=None, language=None):
    with tempfile.TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        spotdl("save", spotdl_query(source), "--save-file", "song.spotdl", cwd=temp)
        song = json.loads((temp / "song.spotdl").read_text(encoding="utf-8"))[0]
        spotdl("download", "song.spotdl", "--format", "flac", "--output", "song.{output-ext}", cwd=temp)
        source = temp / "song.flac"
        if not source.is_file():
            fail("spotdl finished but produced no audio file (no matching YouTube Music track?)")

        song_dir = RIFFS_DIR / safe_name(f"{song['artist']} - {song['name']}")
        song_dir.mkdir(parents=True, exist_ok=True)
        duration = sf.info(str(source)).duration
        print(f"\nDownloaded {song['artist']} - {song['name']} ({duration:.0f} s). Separating on {device_name()}...")

        stems, sample_rate, elapsed = separate(source, SW_MODEL, duration)
    # The download and the non-guitar stems are gone with the temp folder.

    guitar = song_dir / GUITAR_FILE
    write_mp3(guitar, stems["guitar"], sample_rate, GUITAR_BITRATE)

    year = year or song.get("year")
    meta = {
        "title": song["name"],
        "artist": song["artist"],
        "album": song.get("album_name"),
        "language": language,
        "year": year,
        "decade": decade(year),
        "duration": round(duration, 3),
        "spotify_url": song["url"],
        "clip": None,
    }
    (song_dir / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Separation took {elapsed:.0f} s (BS-Roformer SW)")
    print(f"Wrote {guitar}")


def snip(song_dir, start, end):
    song_dir = Path(song_dir).resolve()
    meta_path = song_dir / "meta.json"
    guitar = song_dir / GUITAR_FILE
    if not meta_path.is_file() or not guitar.is_file():
        fail(f"{song_dir} is missing meta.json or {GUITAR_FILE}; run 'prepare' first")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    start_s = parse_time(start)
    end_s = parse_time(end) if end else meta["duration"]
    if not 0 <= start_s < end_s <= meta["duration"]:
        fail(f"need 0 <= start < end <= {meta['duration']:.1f} s (got {start_s} to {end_s})")

    length = end_s - start_s
    clip = song_dir / "clip.mp3"
    # Trim inside the filter chain (sample-accurate), restart timestamps at 0, then fade.
    # An output -ss would trim *after* the fades and leave a silent clip.
    filters = (
        f"atrim=start={start_s:.3f}:end={end_s:.3f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:d={FADE_IN},afade=t=out:st={length - FADE_OUT:.3f}:d={FADE_OUT}"
    )
    ffmpeg("-i", str(guitar), "-af", filters, "-ac", "1", "-b:a", CLIP_BITRATE, str(clip))

    meta["clip"] = {"file": clip.name, "start": start_s, "end": end_s}
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {clip} ({length:.1f} s)")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Make a guitar-only RiffOff clip from a Spotify track.")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare", help="download a Spotify track and write its guitar stem")
    p.add_argument("source", help="Spotify track link, Spotify search link, or 'Artist - Title'")
    p.add_argument("--year", type=int, help="original release year (default: Spotify album year)")
    p.add_argument("--language", choices=["en", "he"], help="song language, as in songs.json")
    s = commands.add_parser("snip", help="cut guitar.mp3 into clip.mp3")
    s.add_argument("song_dir", help="folder created by 'prepare'")
    s.add_argument("--start", required=True, help="start time, seconds or m:ss")
    s.add_argument("--end", help="end time, seconds or m:ss (default: end of song)")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        fail("ffmpeg was not found on PATH. Install it (winget install Gyan.FFmpeg) and open a new terminal")
    if args.command == "prepare":
        prepare(args.source, args.year, args.language)
    else:
        snip(args.song_dir, args.start, args.end)


if __name__ == "__main__":
    main()
