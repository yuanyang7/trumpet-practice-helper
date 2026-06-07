# 🎺 Trumpet Practice Helper

Paste a YouTube music link → the app extracts the audio, detects the musical key,
and shows **Bb trumpet fingering charts** for common scales in that key.

It shows two keys:
- **Concert key** — what the recording is actually in.
- **Trumpet (Bb) key** — transposed up a whole step, which is what a trumpet
  player reads and fingers. Fingerings are for this written key.

## Requirements

- Python 3.9+
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and `ffmpeg` on your PATH
  (`brew install yt-dlp ffmpeg`)

## Setup

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

## Run

```bash
./venv/bin/python app.py
```

Then open http://127.0.0.1:5001 and paste a YouTube URL.

## How it works

- `audio.py` — downloads the first ~3 min of audio with `yt-dlp` and converts to WAV.
- `key_detection.py` — computes a chromagram with `librosa` and finds the best-fitting
  key via the Krumhansl-Schmuckler key-finding algorithm.
- `fingerings.py` — standard Bb-trumpet fingering chart + scale generation.
- `app.py` — Flask server; `templates/index.html` is the UI.

## Notes & limitations

- Key detection is statistical. It's reliable for clearly tonal music but can be
  off by a related key (e.g. relative major/minor) for ambiguous or heavily
  produced tracks. The confidence score reflects this.
- Fingerings are the primary/standard ones; many notes have valid alternates.
- Range shown is the trumpet's practical written range (F#3–C6).
