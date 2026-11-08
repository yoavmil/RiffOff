"""Turn a Spotify track into a guitar-only RiffOff clip.

    python riff.py prepare "https://open.spotify.com/track/..."
        Downloads the song (spotdl, audio from YouTube Music) and writes its
        BS-Roformer SW guitar stem to riffs/<Artist - Title>/guitar.mp3. The
        download and all non-guitar stems are deleted.

    python riff.py download "https://open.spotify.com/track/..." <dir>
    python riff.py prepare --downloaded <dir>
        The same as prepare, in two steps, so the studio can download the next
        song while the GPU separates the current one.

    python riff.py snip "riffs/<Artist - Title>" --start 0:12.5 --end 0:42
        Cuts guitar.mp3 into clip.mp3 and records the times in meta.json.

    python riff.py tracks "https://open.spotify.com/playlist/..."
        Prints the playlist's tracks as JSON (used by the studio).

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


def is_hebrew(text):
    # A song whose title or artist has Hebrew letters is a Hebrew song.
    return bool(re.search(r"[֐-׿]", text))


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


def download(source, out_dir):
    """Downloads a song into out_dir (song.spotdl + song.flac) for a later `prepare --downloaded`."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    spotdl("save", spotdl_query(source), "--save-file", "song.spotdl", cwd=out_dir)
    song = json.loads((out_dir / "song.spotdl").read_text(encoding="utf-8"))[0]
    get = ("download", "song.spotdl", "--format", "flac", "--output", "song.{output-ext}")
    spotdl(*get, cwd=out_dir)
    if not (out_dir / "song.flac").is_file():
        # spotdl's strict matching often finds nothing for Hebrew titles (transliterated
        # differently on YouTube Music) or long "Live at ...; 2013 Remaster" titles.
        # Unfiltered, it takes YouTube Music's top hit, which is usually the right upload.
        print("\nNo strict YouTube Music match; retrying with spotdl's result filter off")
        spotdl(*get, "--dont-filter-results", cwd=out_dir)
        if not (out_dir / "song.flac").is_file():
            fail("spotdl produced no audio file, even unfiltered (song not on YouTube Music?)")
    duration = sf.info(str(out_dir / "song.flac")).duration
    print(f"\nDownloaded {song['artist']} - {song['name']} ({duration:.0f} s)")
    if abs(duration - song["duration"]) > 15:
        print(f"WARNING: Spotify says {song['duration']} s; this may be a different version. Listen before clipping.")


def prepare(source=None, year=None, language=None, downloaded=None):
    """Download (unless `downloaded` is a folder from `download`) and write the guitar stem."""
    with tempfile.TemporaryDirectory() as temp_dir:
        if downloaded is None:
            downloaded = Path(temp_dir)
            download(source, downloaded)
        downloaded = Path(downloaded)
        song = json.loads((downloaded / "song.spotdl").read_text(encoding="utf-8"))[0]
        audio = downloaded / "song.flac"
        if not audio.is_file():
            fail(f"no downloaded song in {downloaded}")

        song_dir = RIFFS_DIR / safe_name(f"{song['artist']} - {song['name']}")
        song_dir.mkdir(parents=True, exist_ok=True)
        duration = sf.info(str(audio)).duration
        print(f"Separating {song['artist']} - {song['name']} ({duration:.0f} s) on {device_name()}...")

        stems, sample_rate, elapsed = separate(audio, SW_MODEL, duration)
    # The temp download and the non-guitar stems are gone with the temp folder;
    # a separate download folder is deleted once the guitar stem is written.

    guitar = song_dir / GUITAR_FILE
    write_mp3(guitar, stems["guitar"], sample_rate, GUITAR_BITRATE)

    year = year or song.get("year")
    meta = {
        "title": song["name"],
        "artist": song["artist"],
        "album": song.get("album_name"),
        "language": "he" if is_hebrew(song["name"] + song["artist"]) else language,
        "year": year,
        "decade": decade(year),
        "duration": round(duration, 3),
        "spotify_url": song["url"],
        "clip": None,
    }
    (song_dir / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    if downloaded.exists():
        shutil.rmtree(downloaded, ignore_errors=True)

    print(f"Separation took {elapsed:.0f} s (BS-Roformer SW)")
    print(f"Wrote {guitar}")


def tracks(url):
    """Prints a Spotify playlist's tracks as JSON: {"name": ..., "tracks": [{url, title, artist}]}.

    Uses spotdl's playlist listing directly. `spotdl save` would also fetch every
    song's full metadata one by one, which takes minutes for a big playlist.
    """
    if not re.match(r"https://open\.spotify\.com/(intl-\w+/)?playlist/", url):
        fail("expected a Spotify playlist link like https://open.spotify.com/playlist/...")
    from spotdl.types.playlist import Playlist
    from spotdl.utils.config import SPOTIFY_OPTIONS
    from spotdl.utils.spotify import SpotifyClient

    try:
        SpotifyClient.init(**SPOTIFY_OPTIONS)
        info, songs = Playlist.get_metadata(url)
    except Exception as e:
        fail(f"could not read the playlist: {e}")
    listing = [{"url": s.url, "title": s.name, "artist": s.artist} for s in songs]
    print(json.dumps({"name": info["name"], "tracks": listing}, ensure_ascii=False))


def snip(song_dir, start, end):
    song_dir = Path(song_dir).resolve()
    meta_path = song_dir / "meta.json"
    guitar = song_dir / GUITAR_FILE
    if not meta_path.is_file() or not guitar.is_file():
        fail(f"{song_dir} is missing meta.json or {GUITAR_FILE}; run 'prepare' first")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    start_s = parse_time(start)
    end_s = parse_time(end) if end else meta["duration"]
    if meta["duration"] < end_s <= meta["duration"] + 0.5:
        end_s = meta["duration"]  # a rounded "end of song" (263.8 for 263.76) means the end
    if not 0 <= start_s < end_s <= meta["duration"]:
        fail(f"need 0 <= start < end <= {meta['duration']:.2f} s, the song's length (got {start_s} to {end_s})")

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
    p.add_argument("source", nargs="?", help="Spotify track link, Spotify search link, or 'Artist - Title'")
    p.add_argument("--downloaded", help="separate a folder made by 'download' instead of downloading")
    p.add_argument("--year", type=int, help="original release year (default: Spotify album year)")
    p.add_argument("--language", choices=["en", "he"], help="song language, as in songs.json")
    d = commands.add_parser("download", help="only download a track (for a later 'prepare --downloaded')")
    d.add_argument("source", help="Spotify track link, Spotify search link, or 'Artist - Title'")
    d.add_argument("out_dir", help="folder to download into")
    s = commands.add_parser("snip", help="cut guitar.mp3 into clip.mp3")
    s.add_argument("song_dir", help="folder created by 'prepare'")
    s.add_argument("--start", required=True, help="start time, seconds or m:ss")
    s.add_argument("--end", help="end time, seconds or m:ss (default: end of song)")
    t = commands.add_parser("tracks", help="list a Spotify playlist's tracks as JSON")
    t.add_argument("url", help="Spotify playlist link")
    args = parser.parse_args()

    if args.command == "tracks":
        return tracks(args.url)
    if not shutil.which("ffmpeg"):
        fail("ffmpeg was not found on PATH. Install it (winget install Gyan.FFmpeg) and open a new terminal")
    if args.command == "prepare":
        if bool(args.source) == bool(args.downloaded):
            fail("give either a source or --downloaded DIR")
        prepare(args.source, args.year, args.language, args.downloaded)
    elif args.command == "download":
        download(args.source, args.out_dir)
    else:
        snip(args.song_dir, args.start, args.end)


if __name__ == "__main__":
    main()
