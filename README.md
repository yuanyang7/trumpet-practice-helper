# 🎺 Trumpet Practice Helper

Paste a YouTube music link → the app extracts the audio, detects the musical key,
and shows **Bb trumpet fingering charts** for common scales in that key.

It shows:
- **Concert key** — what the recording is actually in.
- **Trumpet (Bb) key** — transposed up a whole step, which is what a trumpet
  player reads and fingers. Fingerings are for this written key.
- **Tempo (BPM)** — estimated from the track.
- For each scale: **primary + alternate fingerings**, and a **▶ Play** button
  that synthesizes the scale (Web Audio API) with a synced note highlight.

## Two pages

The app is split into two pages so you can practice from your phone:

- **Processing page** — `templates/index.html`, served by Flask on your Mac
  (`http://127.0.0.1:5001`). Paste a YouTube link → **Analyze** → **💾 Save**.
  Saving writes the result to **Supabase**. Analysis must run here because it
  needs `yt-dlp`/`ffmpeg`/`librosa`.
- **Practice page** — `static/practice.html`, a static page you deploy to
  **Vercel**. It lists your saved songs straight from Supabase and shows the
  fingering charts + scale playback. Open this on your phone, anywhere — it
  works even when your Mac is off.

Shared rendering/playback/Supabase code lives in `static/shared.js`; styling in
`static/styles.css`.

### One-time setup (Supabase + Vercel)

1. **Supabase table.** In your project, open SQL Editor and run
   [`supabase_schema.sql`](supabase_schema.sql).
2. **Credentials.** Copy your Project URL and anon key from Supabase
   (Settings → API) into [`static/config.js`](static/config.js).
3. **Deploy the practice page.** `vercel deploy` from the repo root (see
   [`vercel.json`](vercel.json)). The deployed `/` serves the practice page.
   Set the Vercel project's Framework Preset to **Other** if asked.

Now: add songs on the Mac, practice them from the Vercel URL on your phone.

## Requirements

- Python 3.9+
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and `ffmpeg` on your PATH
  (`brew install yt-dlp ffmpeg`)

## Setup

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

`madmom` (the optional CNN key-detection backend) needs Cython available
*before* it builds, and doesn't support build isolation. If its install
fails, run:

```bash
./venv/bin/pip install "numpy<2" "Cython<3" wheel
./venv/bin/pip install --no-build-isolation madmom
```

The app works fine without it — the key-detection method picker just falls
back to "Krumhansl-Schmuckler" only.

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
