"""RiffOff studio: a localhost UI for turning Spotify links into playlist clips.

    .venv\\Scripts\\python studio.py          (or `npm run studio` from the repo root)
    then open http://127.0.0.1:8765

Paste one or more Spotify links. A playlist link is read in the background and
each of its tracks is queued, except songs already in the playlist or the
queue (matched by Spotify track, or by title and artist against
private/songs.json). Songs are prepared in the background as a pipeline:
two downloads at a time (`riff.py download`, network-bound and the slow part)
stay ahead of the GPU, which separates one song at a time (`riff.py prepare
--downloaded`: BS-Roformer SW guitar stem). When a song is ready, play its
guitar stem in the browser, mark the clip, fix the title/artist/language/decade
and save. The save is checked at once and then runs in the background, so the
editor moves straight on to the next ready song: the studio runs `riff.py
snip`, copies the clip to private/audio/NN.mp3, appends it to
private/songs.json and publishes the library to Cloudflare R2, one save at a
time. Discard gives up on a song at any point and deletes its files.

The queue is kept in studio-queue.json (git-ignored: it names the songs).
Folders already in riffs/ that have no clip yet show up as ready.
Binds to 127.0.0.1 only.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
REPO_DIR = TOOL_DIR.parent.parent
# The env overrides exist for testing against scratch folders.
RIFFS_DIR = Path(os.environ.get("RIFF_RIFFS_DIR", TOOL_DIR / "riffs"))
DOWNLOADS_DIR = RIFFS_DIR / "_downloads"  # songs downloaded ahead, one folder per job id
STATIC_DIR = TOOL_DIR / "studio"
STATE_FILE = Path(os.environ.get("STUDIO_STATE_FILE", TOOL_DIR / "studio-queue.json"))
# Spotify track id -> "Artist – Title" of songs given up on, so re-pasting a playlist skips them.
GIVEN_UP_FILE = STATE_FILE.with_name(STATE_FILE.stem + "-given-up.json")
PRIVATE_DIR = Path(os.environ.get("RIFFOFF_PRIVATE_DIR", REPO_DIR / "private"))
PLAYLIST_FILE = PRIVATE_DIR / "songs.json"
AUDIO_DIR = PRIVATE_DIR / "audio"
HOST, PORT = "127.0.0.1", int(os.environ.get("STUDIO_PORT", 8765))
LOG_LINES = 40

STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}

lock = threading.RLock()  # guards `jobs` and the state file
playlist_lock = threading.Lock()  # one save (snip + playlist + upload) at a time
wake_download = threading.Event()
wake_separate = threading.Event()
jobs = []  # list of dicts, in the order they were added
running = {}  # job id -> Popen of its current riff.py step


# ---------------------------------------------------------------- state


def save_state():
    with lock:
        STATE_FILE.write_text(json.dumps(jobs, indent=2, ensure_ascii=False), encoding="utf-8")


def read_given_up():
    try:
        return json.loads(GIVEN_UP_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_given_up(given_up):
    GIVEN_UP_FILE.write_text(json.dumps(given_up, indent=2, ensure_ascii=False), encoding="utf-8")


def find(job_id):
    with lock:
        return next((j for j in jobs if j["id"] == job_id), None)


def update(job, **fields):
    with lock:
        job.update(fields)
        save_state()


def new_job(source, status="queued", **fields):
    return {
        "id": uuid.uuid4().hex[:10],
        "source": source,
        "status": status,  # queued | running | ready | saved | failed
        "step": None,
        "dir": None,
        "meta": None,
        "error": None,
        "log": [],
        "added": time.time(),
        **fields,
    }


def read_meta(dir_name):
    path = RIFFS_DIR / dir_name / "meta.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def load_state():
    global jobs
    if STATE_FILE.is_file():
        jobs = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    for job in jobs:  # pick up whatever a restart interrupted
        if job["status"] in ("downloading", "downloaded", "running"):
            done = (DOWNLOADS_DIR / job["id"] / "song.flac").is_file() and job["status"] != "downloading"
            job.update(status="downloaded" if done else "queued", step=None)
        elif job["status"] == "saving":
            if job.get("savedAs"):  # in the playlist already; only the upload may be missing
                job.update(status="saved", publishError="The studio restarted before publishing. "
                           "The next save publishes it, or run npm run library:upload.")
            else:
                job.update(status="ready", saveError="The studio restarted while saving: save again.")
        elif job["status"] == "listing":
            job.update(status="failed", step=None, error="Interrupted by a studio restart: click Retry")
    # Prepared songs that were never clipped (e.g. made with the CLI) are ready to mark.
    known = {j["dir"] for j in jobs if j["dir"]}
    if RIFFS_DIR.is_dir():
        for folder in sorted(RIFFS_DIR.iterdir()):
            meta = read_meta(folder.name)
            if folder.name in known or not meta or meta.get("clip") or not (folder / "guitar.mp3").is_file():
                continue
            jobs.append(new_job(meta.get("spotify_url") or folder.name, "ready", dir=folder.name, meta=meta))
    save_state()


# ---------------------------------------------------------------- worker

# Each song goes queued -> downloading -> downloaded -> running (separating) -> ready.
# Downloads (several minutes each, network-bound) run DOWNLOAD_AHEAD at a time, ahead
# of the GPU, which separates one song at a time (~1-2 min), so it rarely waits.
DOWNLOAD_AHEAD = 2
DOWNLOADED = re.compile(r"^Downloaded (.+) \((\d+) s\)$")
SEPARATING = re.compile(r"^Separating (.+) \((\d+) s\) on ")
WROTE_GUITAR = re.compile(r"^Wrote (.+[\\/]guitar\.mp3)$")


def safe_name(text):
    # Same as riff.py: the song folder is safe_name("Artist - Title").
    return re.sub(r'[<>:"/\\|?*]', "", text).strip(" .")


def download_dir(job):
    return DOWNLOADS_DIR / job["id"]


def minutes(seconds):
    return f"{int(seconds) // 60}:{int(seconds) % 60:02d}"


def run_step(job, args, status, step):
    """Runs one riff.py step for a job, streaming its output into the job's log. Returns the exit code."""
    proc = subprocess.Popen(
        [sys.executable, "-X", "utf8", "-u", "riff.py", *args],
        cwd=TOOL_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    with lock:
        running[job["id"]] = proc
    update(job, status=status, step=step, error=None)

    for raw in proc.stdout:
        line = raw.rstrip()
        if not line:
            continue
        with lock:
            job["log"] = (job["log"] + [line])[-LOG_LINES:]
        if m := DOWNLOADED.match(line):
            update(job, label=m.group(1), length=int(m.group(2)))
        elif m := SEPARATING.match(line):
            update(job, label=m.group(1), dir=safe_name(m.group(1)),
                   step=f"Separating the guitar ({minutes(m.group(2))} song)")
        elif m := WROTE_GUITAR.match(line):
            update(job, dir=Path(m.group(1)).parent.name)
    code = proc.wait()
    with lock:
        running.pop(job["id"], None)
    return code


def fail_job(job, code):
    errors = [l for l in job["log"] if l.lower().startswith("error")]
    update(job, status="failed", step=None, error=(errors or job["log"] or [f"exit code {code}"])[-1])


def download_job(job):
    shutil.rmtree(download_dir(job), ignore_errors=True)  # a retry starts clean
    update(job, log=[])
    code = run_step(job, ["download", job["source"], str(download_dir(job))], "downloading", "Downloading")
    with lock:
        if job not in jobs:  # discarded meanwhile
            return
    if code == 0 and (download_dir(job) / "song.flac").is_file():
        update(job, status="downloaded", step=None)
    else:
        fail_job(job, code)


def separate_job(job):
    args = ["prepare", "--downloaded", str(download_dir(job))]
    if job.get("language"):
        args += ["--language", job["language"]]
    code = run_step(job, args, "running", "Separating the guitar")
    with lock:
        if job not in jobs:
            return
    meta = read_meta(job["dir"]) if job["dir"] else None
    if code == 0 and meta:
        update(job, status="ready", step=None, meta=meta)
    else:
        fail_job(job, code)


def claim_job(wanted, claim, limit=None):
    """Takes the oldest job in status `wanted` and marks it `claim`, so no other worker takes it too.

    With a `limit`, nothing is taken while that many songs are already downloading or downloaded.
    """
    with lock:
        if limit is not None and sum(j["status"] in ("downloading", "downloaded") for j in jobs) >= limit:
            return None
        job = next((j for j in jobs if j["status"] == wanted), None)
        if job:
            job["status"] = claim
        return job


def worker(wanted, claim, step, event, limit=None):
    while True:
        job = claim_job(wanted, claim, limit)
        if job is None:
            event.wait(timeout=5)  # the timeout covers a wake-up another worker cleared first
            event.clear()
            continue
        try:
            step(job)
        except Exception as exc:  # keep the worker alive whatever happens
            update(job, status="failed", step=None, error=str(exc))
        wake_workers()


def wake_workers():
    wake_download.set()
    wake_separate.set()


def kill_tree(proc):
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        # Also kills spotdl / ffmpeg children.
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.kill()


def discard(job):
    with lock:
        if job not in jobs:
            return
        jobs.remove(job)
        proc = running.pop(job["id"], None)
        save_state()
        tid = track_id(job["source"]) or track_id((job["meta"] or {}).get("spotify_url"))
        if job.get("kind") != "playlist" and job["status"] not in ("saved", "saving") and tid:
            meta = job["meta"] or {}
            label = f"{meta['artist']} – {meta['title']}" if meta.get("title") else job["source"]
            write_given_up({**read_given_up(), tid: label})
    if proc:
        kill_tree(proc)
        proc.wait(timeout=30)
    folders = [download_dir(job)]
    if job["status"] not in ("saved", "saving") and job["dir"]:
        folders.append(RIFFS_DIR / job["dir"])
    for folder in folders:
        for _ in range(10):  # Windows may hold the files open for a moment after the kill
            shutil.rmtree(folder, ignore_errors=True)
            if not folder.exists():
                break
            time.sleep(0.5)
    wake_workers()  # a download slot may have opened up


# ---------------------------------------------------------------- playlists

PLAYLIST_LINK = re.compile(r"https://open\.spotify\.com/(?:intl-\w+/)?playlist/")
TRACK_ID = re.compile(r"open\.spotify\.com/(?:intl-\w+/)?track/([A-Za-z0-9]+)")


def track_id(url):
    m = TRACK_ID.search(url or "")
    return m.group(1) if m else None


def normalize(text):
    """Comparable form of a title or artist: "Some Song - 2013 Remaster" -> "some song"."""
    text = re.sub(r"\(.*?\)|\[.*?\]", "", text.casefold()).split(" - ")[0]
    return " ".join(re.findall(r"\w+", text.replace("&", " and ")))


def same_song(title_a, artist_a, title_b, artist_b):
    if not normalize(title_a) or normalize(title_a) != normalize(title_b):
        return False
    hebrew = lambda s: bool(re.search(r"[֐-׿]", s))
    if hebrew(artist_a) != hebrew(artist_b):
        return True  # a Hebrew name vs its Latin spelling: can't compare, trust the title
    a, b = normalize(artist_a), normalize(artist_b)
    return a == b or a in b or b in a  # "Rockers" vs "The Rockers"


def known_songs():
    """Track ids already in the playlist / in the queue, plus the playlist's (title, artist) pairs."""
    in_playlist, in_queue = set(), set()
    with lock:
        for job in jobs:
            if job.get("kind") == "playlist":
                continue
            ids = {track_id(job["source"]), track_id((job["meta"] or {}).get("spotify_url"))} - {None}
            (in_playlist if job["status"] == "saved" else in_queue).update(ids)
    if RIFFS_DIR.is_dir():  # songs clipped with the CLI or by earlier studio runs
        for folder in RIFFS_DIR.iterdir():
            meta = read_meta(folder.name)
            if meta and meta.get("clip") and track_id(meta.get("spotify_url")):
                in_playlist.add(track_id(meta["spotify_url"]))
    try:
        songs = json.loads(PLAYLIST_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        songs = []
    names = [(s.get("title", ""), s.get("artist", "")) for s in songs]
    return in_playlist, in_queue - in_playlist, names


def expand_playlist(job):
    """Reads a playlist link in the background and queues the tracks we don't have yet."""
    update(job, status="listing", step="Reading the playlist", error=None, summary=None)
    result = subprocess.run(
        [sys.executable, "-X", "utf8", "riff.py", "tracks", job["source"]],
        cwd=TOOL_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        lines = (result.stderr or result.stdout).strip().splitlines()
        return update(job, status="failed", step=None, error=lines[-1] if lines else f"exit code {result.returncode}")
    listing = json.loads(result.stdout)

    in_playlist, in_queue, names = known_songs()
    with lock:
        given_up_ids = read_given_up()
    added, have, queued, given_up, seen = [], [], [], [], set()
    for track in listing["tracks"]:
        tid, label = track_id(track["url"]), f"{track['artist']} – {track['title']}"
        if tid in seen:
            continue
        seen.add(tid)
        if tid in in_playlist or any(same_song(track["title"], track["artist"], t, a) for t, a in names):
            have.append(label)
        elif tid in in_queue:
            queued.append(label)
        elif tid in given_up_ids:
            given_up.append(label)
        else:
            added.append(new_job(track["url"], language=job.get("language")))

    with lock:
        if job not in jobs:  # dismissed while reading
            return
        jobs.extend(added)
    update(job, status="listed", step=None, name=listing["name"], summary={
        "total": len(listing["tracks"]), "added": len(added), "inPlaylist": have, "inQueue": queued,
        "givenUp": given_up,
    })
    wake_workers()


def start_playlist(job):
    def run_safely():
        try:
            expand_playlist(job)
        except Exception as exc:  # never leave the row stuck on "listing"
            update(job, status="failed", step=None, error=str(exc))

    threading.Thread(target=run_safely, daemon=True).start()


# ---------------------------------------------------------------- saving


def run(args, cwd):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        lines = (result.stderr or result.stdout).strip().splitlines()
        # Node ends a crash with its version line; the useful part is the "...Error: message" line.
        errors = [l.strip() for l in lines if re.match(r"\s*(\w*Error\b|error:)", l)]
        raise RuntimeError((errors or lines or [f"exit code {result.returncode}"])[-1])
    return result.stdout


def check_form(form):
    """The save form's fields, validated. Raises ValueError/KeyError with a message for the user."""
    title, artist = form["title"].strip(), form["artist"].strip()
    language, decade = form["language"], str(form["decade"])
    if re.search(r"[֐-׿]", title + artist):
        language = "he"  # a Hebrew title or artist always means a Hebrew song
    start, end = float(form["start"]), float(form["end"])
    if not title or not artist:
        raise ValueError("title and artist are required")
    if language not in ("he", "en"):
        raise ValueError("choose the song language")
    if decade not in ("60", "70", "80", "90", "00", "10", "20"):
        raise ValueError("choose the decade")
    if not 0 <= start < end:
        raise ValueError("mark a clip: start must be before end")
    return title, artist, language, decade, start, end


def save_in_background(job, fields):
    """Saves while the user moves on. Saves run one at a time, in the order they were clicked."""
    def run_safely():
        try:
            save_clip(job, *fields)
        except Exception as exc:
            if job.get("savedAs"):  # the song is in the playlist; only publishing failed
                update(job, status="saved", publishError=f"Publishing failed: {exc}. "
                       "The next save publishes it, or run npm run library:upload.")
            else:
                update(job, status="ready", saveError=f"Saving failed: {exc}")

    update(job, status="saving", saveError=None, publishError=None)
    threading.Thread(target=run_safely, daemon=True).start()


def save_clip(job, title, artist, language, decade, start, end):
    with playlist_lock:
        run([sys.executable, "-X", "utf8", "riff.py", "snip", str(RIFFS_DIR / job["dir"]),
             "--start", f"{start:.3f}", "--end", f"{end:.3f}"], TOOL_DIR)

        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        songs = json.loads(PLAYLIST_FILE.read_text(encoding="utf-8")) if PLAYLIST_FILE.is_file() else []
        numbers = [int(p.stem) for p in AUDIO_DIR.glob("*.mp3") if p.stem.isdigit()]
        number = max(numbers, default=0) + 1
        audio_name = f"{number:02d}.mp3"
        shutil.copyfile(RIFFS_DIR / job["dir"] / "clip.mp3", AUDIO_DIR / audio_name)

        ids = [s["id"] for s in songs if isinstance(s.get("id"), int)]
        entry = {
            "id": max(ids, default=0) + 1,
            "title": title,
            "artist": artist,
            "language": language,
            "decade": decade,
            "audioFile": f"/audio/{audio_name}",
        }
        spotify_url = (job["meta"] or {}).get("spotify_url")
        if spotify_url:
            entry["spotifyUrl"] = spotify_url
        songs.append(entry)
        PLAYLIST_FILE.write_text(json.dumps(songs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        # From here on the song is in the playlist: a later failure must not let it be saved twice.
        update(job, savedAs=audio_name, clip={"start": start, "end": end},
               meta={**(job["meta"] or {}), "title": title, "artist": artist, "language": language, "decade": decade})

        node = shutil.which("node")
        if not node:
            raise RuntimeError("node was not found")
        run([node, "scripts/upload-library.mjs"], REPO_DIR)

    update(job, status="saved")


def playlist_size():
    try:
        return len(json.loads(PLAYLIST_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return 0


# ---------------------------------------------------------------- HTTP


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep the console quiet
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, content_type):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path in STATIC_FILES:
            name, content_type = STATIC_FILES[path]
            return self.send_file(STATIC_DIR / name, content_type)
        if path == "/api/jobs":
            with lock:
                public = [{k: v for k, v in j.items()} for j in jobs]
            return self.send_json({"jobs": public, "playlistSize": playlist_size()})
        if m := re.fullmatch(r"/api/jobs/(\w+)/guitar\.mp3", path):
            job = find(m.group(1))
            if job and job["dir"] and (RIFFS_DIR / job["dir"] / "guitar.mp3").is_file():
                return self.send_file(RIFFS_DIR / job["dir"] / "guitar.mp3", "audio/mpeg")
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
        except ValueError:
            return self.send_json({"error": "invalid JSON"}, 400)

        if path == "/api/jobs":
            sources = [s.strip() for s in body.get("sources", []) if s.strip()]
            language = body.get("language") if body.get("language") in ("he", "en") else None
            with lock:
                active = {j["source"] for j in jobs if j["status"] in ("queued", "running", "ready", "listing")}
                fresh = [s for s in dict.fromkeys(sources) if s not in active]
                added = [new_job(s, language=language) for s in fresh if not PLAYLIST_LINK.match(s)]
                playlists = [new_job(s, "listing", kind="playlist", language=language) for s in fresh if PLAYLIST_LINK.match(s)]
                jobs.extend(added + playlists)
                save_state()
                # Pasting a given-up song's own link means you want it after all.
                given_up = read_given_up()
                back = {track_id(j["source"]) for j in added} & given_up.keys()
                if back:
                    write_given_up({k: v for k, v in given_up.items() if k not in back})
            for job in playlists:
                start_playlist(job)
            wake_workers()
            return self.send_json({"added": len(added), "playlists": len(playlists), "skipped": len(sources) - len(fresh)})

        m = re.fullmatch(r"/api/jobs/(\w+)/(discard|retry|save)", path)
        job = find(m.group(1)) if m else None
        if not job:
            return self.send_json({"error": "not found"}, 404)
        action = m.group(2)
        if action == "discard":
            threading.Thread(target=discard, args=(job,), daemon=True).start()
            return self.send_json({"ok": True})
        if action == "retry":
            if job["status"] == "failed" and job.get("kind") == "playlist":
                start_playlist(job)
            elif job["status"] == "failed":
                update(job, status="queued", error=None, log=[])
                wake_workers()
            return self.send_json({"ok": True})
        if job["status"] != "ready" or job.get("kind") == "playlist":
            return self.send_json({"error": "this song is not ready to save"}, 409)
        try:
            fields = check_form(body)
        except (ValueError, KeyError) as exc:
            return self.send_json({"error": str(exc)}, 400)
        save_in_background(job, fields)
        return self.send_json({"ok": True})


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg was not found on PATH. Install it (winget install Gyan.FFmpeg) and open a new terminal")
    load_state()
    for _ in range(DOWNLOAD_AHEAD):  # parallel downloads; the limit keeps them from running further ahead
        threading.Thread(target=worker, args=("queued", "downloading", download_job, wake_download, DOWNLOAD_AHEAD),
                         daemon=True).start()
    threading.Thread(target=worker, args=("downloaded", "running", separate_job, wake_separate), daemon=True).start()
    wake_workers()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"RiffOff studio: http://{HOST}:{PORT}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with lock:
            procs = list(running.values())
        for proc in procs:
            kill_tree(proc)


if __name__ == "__main__":
    main()
