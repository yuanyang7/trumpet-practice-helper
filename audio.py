"""Download audio from a YouTube link using yt-dlp + ffmpeg."""

import os
import subprocess
import tempfile
import shutil


def get_metadata(url):
    """Fetch title + id for a YouTube URL without downloading the audio (fast)."""
    if not shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp is not installed (brew install yt-dlp)")
    proc = subprocess.run(
        ["yt-dlp", "--skip-download", "--no-playlist",
         "--print", "%(id)s\t%(title)s", url],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Could not read video info:\n{proc.stderr[-800:]}")
    line = proc.stdout.strip().splitlines()[0] if proc.stdout.strip() else ""
    vid, _, title = line.partition("\t")
    if not title:
        title = vid or "untitled"
    return {"id": vid, "title": title}


def download_audio(url, max_seconds=180, start_seconds=0):
    """Download (a slice of) the audio track from a YouTube URL.

    Returns the path to a wav file in a temp dir. Caller is responsible for
    cleaning up the returned directory (its parent). By default we cap the
    duration to keep key detection fast; pass `start_seconds` (with
    `max_seconds` as the slice length) to fetch an arbitrary window, e.g. the
    bar range being transcribed.
    """
    if not shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp is not installed (brew install yt-dlp)")
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed (brew install ffmpeg)")

    workdir = tempfile.mkdtemp(prefix="trumpet_")
    out_template = os.path.join(workdir, "audio.%(ext)s")

    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "-o", out_template,
        "--no-playlist",
    ]
    # Limit which slice we download/process for speed: [start, start+length].
    if max_seconds:
        start = max(0, int(start_seconds))
        cmd += ["--download-sections", f"*{start}-{start + int(max_seconds)}"]
    cmd.append(url)

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        shutil.rmtree(workdir, ignore_errors=True)
        raise RuntimeError(f"yt-dlp failed:\n{proc.stderr[-1500:]}")

    wav_path = os.path.join(workdir, "audio.wav")
    if not os.path.exists(wav_path):
        # yt-dlp may have produced a different extension; find any audio file.
        files = [f for f in os.listdir(workdir)]
        if not files:
            shutil.rmtree(workdir, ignore_errors=True)
            raise RuntimeError("No audio file was produced")
        wav_path = os.path.join(workdir, files[0])

    return wav_path
