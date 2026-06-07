"""Disk cache for analysis results, keyed by song title.

Each analyzed song is saved as a JSON file named after the song, so re-analyzing
the same link reads the file instead of downloading and processing the audio again.
"""

import os
import re
import json

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")


def _sanitize(title):
    """Turn a song title into a safe, readable filename (without extension)."""
    # Replace path-unfriendly characters; collapse whitespace.
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", title)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.strip(". ")  # no leading/trailing dots or spaces
    return (cleaned or "untitled")[:120]


def path_for(title):
    return os.path.join(CACHE_DIR, _sanitize(title) + ".json")


def load(title):
    """Return the cached result dict for a title, or None if not cached."""
    path = path_for(title)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def save(title, data):
    """Write a result dict to the cache. Returns the file path."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = path_for(title)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return path


def list_saved():
    """Return a sorted list of saved song titles."""
    if not os.path.isdir(CACHE_DIR):
        return []
    return sorted(
        os.path.splitext(f)[0] for f in os.listdir(CACHE_DIR) if f.endswith(".json")
    )
