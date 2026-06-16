"""Trumpet Practice Helper — local web app.

Paste a YouTube link, the app extracts the audio, detects the musical key,
and shows trumpet (Bb) fingering charts for scales in that key.
"""

import os
import shutil

from flask import Flask, render_template, request, jsonify

from audio import download_audio, get_metadata
from key_detection import analyze as analyze_audio, METHODS
from transcribe import analyze_range
import fingerings as fng

app = Flask(__name__)


@app.after_request
def add_cors(resp):
    # Allow the page to call the API even when opened from a preview pane
    # (a different origin than the Flask server).
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/<path:_any>", methods=["OPTIONS"])
def cors_preflight(_any):
    return ("", 204)


@app.route("/methods")
def methods():
    return jsonify({"methods": METHODS})


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    method = data.get("method") or METHODS[0]
    if not url:
        return jsonify({"error": "Please provide a YouTube URL."}), 400
    if method not in METHODS:
        return jsonify({"error": f"Unknown detection method '{method}'."}), 400

    wav_path = None
    try:
        meta = get_metadata(url)
        wav_path = download_audio(url)
        result = analyze_audio(wav_path, method=method)
    except Exception as e:  # surface a readable message to the UI
        return jsonify({"error": str(e)}), 500
    finally:
        if wav_path and os.path.isdir(os.path.dirname(wav_path)):
            shutil.rmtree(os.path.dirname(wav_path), ignore_errors=True)

    concert_pc = result["pitch_class"]
    mode = result["mode"]
    trumpet_pc = fng.transpose_for_trumpet(concert_pc)
    scales = fng.build_scales(trumpet_pc, mode)

    return jsonify(
        {
            "title": meta["title"],
            "url": url,
            "video_id": meta["id"],
            "concert_key": fng.key_name(concert_pc, mode),
            "trumpet_key": fng.key_name(trumpet_pc, mode),
            "mode": mode,
            "confidence": round(result["confidence"], 3),
            "method": method,
            "bpm": result["bpm"],
            "beat_offset": result.get("beat_offset", 0.0),
            "scales": scales,
        }
    )


def _prefer_flats(concert_key):
    """Spell the tab the way the written (Bb-trumpet) key reads."""
    if not concert_key:
        return False
    root, _, mode = concert_key.partition(" ")
    from key_detection import _NOTE_TO_PC
    concert_pc = _NOTE_TO_PC.get(root)
    if concert_pc is None:
        return False
    trumpet_pc = fng.transpose_for_trumpet(concert_pc)
    return trumpet_pc in fng._FLAT_TONICS or mode == "minor"


@app.route("/transcribe", methods=["POST"])
def transcribe():
    """Transcribe a bar range into a monophonic trumpet tab.

    Body: {url|video_id, from_bar, to_bar, bpm, beat_offset, beats_per_measure,
    concert_key?}. Returns {tab: {from_bar, to_bar, notes: [...]}}.
    """
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    video_id = (data.get("video_id") or "").strip()
    if not url and video_id:
        url = f"https://www.youtube.com/watch?v={video_id}"
    if not url:
        return jsonify({"error": "Provide a YouTube url or video_id."}), 400

    try:
        bpm = float(data.get("bpm") or 0)
        from_bar = max(1, int(data.get("from_bar") or 1))
        to_bar = max(from_bar, int(data.get("to_bar") or from_bar))
        beat_offset = float(data.get("beat_offset") or 0.0)
        beats_per_measure = int(data.get("beats_per_measure") or 4)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid bar/tempo parameters."}), 400
    if bpm <= 0:
        return jsonify({"error": "A positive BPM is required to place bars."}), 400

    # Bar grid (mirrors the JS player's bar math) -> the absolute time window.
    bar_len = beats_per_measure * 60.0 / bpm
    bar_phase = ((beat_offset % bar_len) + bar_len) % bar_len
    start_sec = int(bar_phase + (from_bar - 1) * bar_len)   # yt-dlp seeks to int seconds
    end_sec = bar_phase + to_bar * bar_len
    length = max(1, int(end_sec) - start_sec + 1)
    # Keep transcription bounded so a stray huge range can't hang the server.
    length = min(length, 120)

    wav_path = None
    try:
        wav_path = download_audio(url, max_seconds=length, start_seconds=start_sec)
        notes = analyze_range(
            wav_path, start_sec=start_sec, bpm=bpm, beat_offset=beat_offset,
            beats_per_measure=beats_per_measure,
            prefer_flats=_prefer_flats(data.get("concert_key")))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if wav_path and os.path.isdir(os.path.dirname(wav_path)):
            shutil.rmtree(os.path.dirname(wav_path), ignore_errors=True)

    return jsonify({"tab": {"from_bar": from_bar, "to_bar": to_bar, "notes": notes}})


if __name__ == "__main__":
    print("Trumpet Practice Helper running at http://127.0.0.1:5001")
    app.run(host="127.0.0.1", port=5001, debug=True)
