"""Download audio from a YouTube link using yt-dlp + ffmpeg."""

import os
import subprocess
import tempfile
import shutil


def download_audio(url, max_seconds=180):
    """Download (a slice of) the audio track from a YouTube URL.

    Returns the path to a wav file in a temp dir. Caller is responsible for
    cleaning up the returned directory (its parent). We cap the duration to keep
    key detection fast; the harmonic content of a few minutes is plenty.
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
    # Limit how much we download/process for speed.
    if max_seconds:
        cmd += ["--download-sections", f"*0-{max_seconds}"]
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
