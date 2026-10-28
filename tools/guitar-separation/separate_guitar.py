"""Extract the guitar stem from a song with a local source-separation model.

Usage:
    python separate_guitar.py "C:\\Music\\song.mp3" --output "C:\\Music\\output"
    python separate_guitar.py --list-models

Writes <name>_guitar.wav and <name>_other.wav (everything except guitar).
Runs offline once the model files are in ./models.
"""

import argparse
import logging
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf

SCRIPT_DIR = Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
DEFAULT_MODEL = "BS-Roformer-SW.ckpt"
INPUT_EXTENSIONS = {".mp3", ".wav", ".flac"}
MODEL_EXTENSIONS = {".ckpt", ".pth", ".onnx", ".th"}


def installed_models():
    return sorted(p.name for p in MODELS_DIR.glob("*") if p.suffix in MODEL_EXTENSIONS)


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def stem_name(path):
    # audio-separator names files like "song_(Guitar)_BS-Roformer-SW.wav"
    groups = re.findall(r"_\(([^)]+)\)_", path.stem)
    return groups[-1].lower() if groups else path.stem.lower()


def fit_length(audio, frames):
    if len(audio) >= frames:
        return audio[:frames]
    return np.pad(audio, ((0, frames - len(audio)), (0, 0)))


def write_wav(path, audio, sample_rate):
    peak = float(np.abs(audio).max())
    if peak > 1.0:
        print(f"warning: {path.name} peaked at {peak:.3f}; scaled down to avoid clipping")
        audio = audio / peak
    sf.write(path, audio, sample_rate, subtype="PCM_24")
    return peak


def device_name():
    import torch

    return torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU (no CUDA GPU found)"


def separate(input_path, model, input_duration):
    """Run one model on input_path. Returns ({stem: float32 array}, sample_rate, seconds).

    Every stem is trimmed or padded to input_duration. Exits with a clear error on failure.
    """
    # Imported late so --help and argument errors stay fast.
    import torch
    from audio_separator.separator import Separator

    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            separator = Separator(
                log_level=logging.WARNING,
                model_file_dir=str(MODELS_DIR),
                output_dir=temp_dir,
                output_format="WAV",
                normalization_threshold=1.0,  # only rescale if a stem would clip
            )
            separator.load_model(model)
            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()
            start = time.perf_counter()
            separator.separate(str(input_path))
            elapsed = time.perf_counter() - start
        except Exception as e:
            fail(f"separation with {model} failed: {type(e).__name__}: {e}")

        stems = {}
        sample_rate = None
        for path in Path(temp_dir).glob("*.wav"):
            audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
            stems[stem_name(path)] = audio

    if "guitar" not in stems:
        fail(f"model {model} produced no guitar stem (got: {', '.join(stems) or 'nothing'})")

    frames = round(input_duration * sample_rate)
    return {name: fit_length(audio, frames) for name, audio in stems.items()}, sample_rate, elapsed


def main():
    parser = argparse.ArgumentParser(description="Extract the guitar stem from an MP3, WAV or FLAC file.")
    parser.add_argument("input", nargs="?", help="input audio file (.mp3, .wav, .flac)")
    parser.add_argument("--output", default="output", help="output folder (default: ./output)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"model file in ./models (default: {DEFAULT_MODEL})")
    parser.add_argument("--list-models", action="store_true", help="list installed models and exit")
    args = parser.parse_args()

    if args.list_models:
        print("\n".join(installed_models()) or f"no models found in {MODELS_DIR}")
        return
    if not args.input:
        parser.error("input file is required")

    input_path = Path(args.input).resolve()
    if not input_path.is_file():
        fail(f"input file not found: {input_path}")
    if input_path.suffix.lower() not in INPUT_EXTENSIONS:
        fail(f"unsupported input format {input_path.suffix}; use MP3, WAV or FLAC")
    if args.model not in installed_models():
        fail(f"model {args.model!r} is not installed in {MODELS_DIR}. Installed: {', '.join(installed_models()) or 'none'}")

    if not shutil.which("ffmpeg"):
        fail("ffmpeg was not found on PATH. Install it (winget install Gyan.FFmpeg) and open a new terminal")

    try:
        input_duration = sf.info(str(input_path)).duration
    except Exception as e:
        fail(f"could not read {input_path.name}: {e}")

    print(f"Model:  {args.model}")
    print(f"Device: {device_name()}")
    print(f"Input:  {input_path.name} ({input_duration:.1f} s)")

    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    stems, sample_rate, elapsed = separate(input_path, args.model, input_duration)
    guitar = stems.pop("guitar")
    other = sum(stems.values())

    name = input_path.stem
    guitar_path = output_dir / f"{name}_guitar.wav"
    other_path = output_dir / f"{name}_other.wav"
    write_wav(guitar_path, guitar, sample_rate)
    write_wav(other_path, other, sample_rate)

    print(f"Processing time: {elapsed:.1f} s ({input_duration / elapsed:.1f}x real time)")
    import torch

    if torch.cuda.is_available():
        print(f"Peak GPU memory: {torch.cuda.max_memory_allocated() / 2**30:.2f} GiB")
    print(f"Wrote {guitar_path}")
    print(f"Wrote {other_path}")


if __name__ == "__main__":
    main()
