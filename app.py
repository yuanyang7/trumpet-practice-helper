"""Trumpet Practice Helper — local web app.

Paste a YouTube link, the app extracts the audio, detects the musical key,
and shows trumpet (Bb) fingering charts for scales in that key.
"""

import os
import shutil

from flask import Flask, render_template, request, jsonify

from audio import download_audio
from key_detection import detect_key
import fingerings as fng

app = Flask(__name__)


@app.after_request
def add_cors(resp):
    # Allow the page to call /analyze even when it's opened from a preview pane
    # (a different origin than the Flask server).
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return resp


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/analyze", methods=["OPTIONS"])
def analyze_preflight():
    return ("", 204)


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "Please provide a YouTube URL."}), 400

    wav_path = None
    try:
        wav_path = download_audio(url)
        concert_pc, mode, confidence = detect_key(wav_path)
    except Exception as e:  # surface a readable message to the UI
        return jsonify({"error": str(e)}), 500
    finally:
        if wav_path and os.path.isdir(os.path.dirname(wav_path)):
            shutil.rmtree(os.path.dirname(wav_path), ignore_errors=True)

    trumpet_pc = fng.transpose_for_trumpet(concert_pc)
    scales = fng.build_scales(trumpet_pc, mode)

    return jsonify(
        {
            "concert_key": fng.key_name(concert_pc, mode),
            "trumpet_key": fng.key_name(trumpet_pc, mode),
            "mode": mode,
            "confidence": round(confidence, 3),
            "scales": scales,
        }
    )


if __name__ == "__main__":
    print("Trumpet Practice Helper running at http://127.0.0.1:5001")
    app.run(host="127.0.0.1", port=5001, debug=True)
