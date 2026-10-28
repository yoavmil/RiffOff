"""RiffOff studio: a localhost UI for turning Spotify links into playlist clips.

    .venv\\Scripts\\python studio.py          (or `npm run studio` from the repo root)
    then open http://127.0.0.1:8765

Paste one or more Spotify links. Songs are prepared one at a time in the
background (`riff.py prepare`: download + BS-Roformer SW guitar stem). When a
song is ready, play its guitar stem in the browser, mark the clip, fix the
title/artist/language/decade and save: the studio runs `riff.py snip`, copies
the clip to private/audio/NN.mp3, appends it to private/songs.json and
publishes the library to Cloudflare R2. Discard gives up on a song at any
point and deletes its files.

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
STATIC_DIR = TOOL_DIR / "studio"
STATE_FILE = Path(os.environ.get("STUDIO_STATE_FILE", TOOL_DIR / "studio-queue.json"))
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
wake = threading.Event()
jobs = []  # list of dicts, in the order they were added
running = {}  # job id -> Popen of its `riff.py prepare`


# ---------------------------------------------------------------- state


def save_state():
    with lock:
        STATE_FILE.write_text(json.dumps(jobs, indent=2, ensure_ascii=False), encoding="utf-8")


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
    for job in jobs:
        if job["status"] == "running":  # interrupted by a restart
            job.update(status="queued", step=None)
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

DOWNLOADED = re.compile(r"^Downloaded (.+) \((\d+) s\)\. Separating")
WROTE_GUITAR = re.compile(r"^Wrote (.+[\\/]guitar\.mp3)$")


def safe_name(text):
    # Same as riff.py: the song folder is safe_name("Artist - Title").
    return re.sub(r'[<>:"/\\|?*]', "", text).strip(" .")


def run_prepare(job):
    args = [sys.executable, "-X", "utf8", "-u", "riff.py", "prepare", job["source"]]
    if job.get("language"):
        args += ["--language", job["language"]]
    proc = subprocess.Popen(
        args,
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
    update(job, status="running", step="Downloading", error=None, log=[])

    for raw in proc.stdout:
        line = raw.rstrip()
        if not line:
            continue
        with lock:
            job["log"] = (job["log"] + [line])[-LOG_LINES:]
        if m := DOWNLOADED.match(line):
            update(job, dir=safe_name(m.group(1)), step=f"Separating the guitar ({int(m.group(2)) // 60}:{int(m.group(2)) % 60:02d} song)")
        elif m := WROTE_GUITAR.match(line):
            update(job, dir=Path(m.group(1)).parent.name)
    code = proc.wait()

    with lock:
        running.pop(job["id"], None)
        if job not in jobs:  # discarded while running
            return
    meta = read_meta(job["dir"]) if job["dir"] else None
    if code == 0 and meta:
        update(job, status="ready", step=None, meta=meta)
    else:
        errors = [l for l in job["log"] if l.lower().startswith("error")]
        update(job, status="failed", step=None, error=(errors or job["log"] or [f"exit code {code}"])[-1])


def worker():
    while True:
        with lock:
            job = next((j for j in jobs if j["status"] == "queued"), None)
        if job is None:
            wake.wait()
            wake.clear()
            continue
        try:
            run_prepare(job)
        except Exception as exc:  # keep the worker alive whatever happens
            update(job, status="failed", step=None, error=str(exc))


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
    if proc:
        kill_tree(proc)
        proc.wait(timeout=30)
    if job["status"] != "saved" and job["dir"]:
        for _ in range(10):  # Windows may hold the files open for a moment after the kill
            shutil.rmtree(RIFFS_DIR / job["dir"], ignore_errors=True)
            if not (RIFFS_DIR / job["dir"]).exists():
                break
            time.sleep(0.5)


# ---------------------------------------------------------------- saving


def run(args, cwd):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        lines = (result.stderr or result.stdout).strip().splitlines()
        raise RuntimeError(lines[-1] if lines else f"exit code {result.returncode}")
    return result.stdout


def save_clip(job, form):
    title, artist = form["title"].strip(), form["artist"].strip()
    language, decade = form["language"], str(form["decade"])
    start, end = float(form["start"]), float(form["end"])
    if not title or not artist:
        raise ValueError("title and artist are required")
    if language not in ("he", "en"):
        raise ValueError("choose the song language")
    if decade not in ("60", "70", "80", "90", "00", "10", "20"):
        raise ValueError("choose the decade")
    if not 0 <= start < end:
        raise ValueError("mark a clip: start must be before end")

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
        songs.append({
            "id": max(ids, default=0) + 1,
            "title": title,
            "artist": artist,
            "language": language,
            "decade": decade,
            "audioFile": f"/audio/{audio_name}",
        })
        PLAYLIST_FILE.write_text(json.dumps(songs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        node = shutil.which("node")
        if not node:
            raise RuntimeError("saved to private/, but node was not found to publish the library")
        publish_output = run([node, "scripts/upload-library.mjs"], REPO_DIR).strip()

    update(job, status="saved", savedAs=audio_name, clip={"start": start, "end": end},
           meta={**(job["meta"] or {}), "title": title, "artist": artist, "language": language, "decade": decade})
    return publish_output


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
                active = {j["source"] for j in jobs if j["status"] in ("queued", "running", "ready")}
                added = [new_job(s, language=language) for s in dict.fromkeys(sources) if s not in active]
                jobs.extend(added)
                save_state()
            wake.set()
            return self.send_json({"added": len(added), "skipped": len(sources) - len(added)})

        m = re.fullmatch(r"/api/jobs/(\w+)/(discard|retry|save)", path)
        job = find(m.group(1)) if m else None
        if not job:
            return self.send_json({"error": "not found"}, 404)
        action = m.group(2)
        if action == "discard":
            threading.Thread(target=discard, args=(job,), daemon=True).start()
            return self.send_json({"ok": True})
        if action == "retry":
            if job["status"] == "failed":
                update(job, status="queued", error=None, log=[])
                wake.set()
            return self.send_json({"ok": True})
        if job["status"] != "ready":
            return self.send_json({"error": "this song is not ready to save"}, 409)
        try:
            published = save_clip(job, body)
        except (ValueError, KeyError) as exc:
            return self.send_json({"error": str(exc)}, 400)
        except RuntimeError as exc:
            return self.send_json({"error": f"saving failed: {exc}"}, 500)
        return self.send_json({"ok": True, "savedAs": job["savedAs"], "published": published})


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg was not found on PATH. Install it (winget install Gyan.FFmpeg) and open a new terminal")
    load_state()
    threading.Thread(target=worker, daemon=True).start()
    wake.set()
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
