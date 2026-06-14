"""Audio key detection using the Krumhansl-Schmuckler key-finding algorithm.

We compute a chromagram, average it over time to get the overall pitch-class
distribution, then correlate that against the 24 (12 major + 12 minor) key
profiles. The best-correlating key wins.
"""

import numpy as np
import librosa

# Optional CNN-based key detection (madmom). madmom 0.16 predates numpy's
# removal of the np.float/np.int/etc. aliases, so restore them before import
# if needed. If madmom isn't installed (it has a finicky build), we fall back
# to Krumhansl-Schmuckler only.
try:
    if not hasattr(np, "float"):
        np.float = float
        np.int = int
        np.bool = bool
        np.object = object
        np.complex = complex
    from madmom.features.key import CNNKeyRecognitionProcessor, key_prediction_to_label
    CNN_AVAILABLE = True
except ImportError:
    CNN_AVAILABLE = False

# Krumhansl-Kessler key profiles (perceived stability of each scale degree).
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def _correlate(chroma_vector, profile):
    """Pearson correlation between a 12-vector and a rotated profile, all 12 rotations."""
    results = []
    cv = chroma_vector - chroma_vector.mean()
    for shift in range(12):
        rotated = np.roll(profile, shift)
        rp = rotated - rotated.mean()
        denom = np.sqrt((cv ** 2).sum() * (rp ** 2).sum())
        results.append((cv * rp).sum() / denom if denom else 0.0)
    return np.array(results)


# madmom key labels use the same note spellings as fingerings.py's _spell().
_NOTE_TO_PC = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
    "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
}

# Methods available for the `method` argument of analyze(). The first entry
# is the default; CNN is preferred when available since it's generally more
# accurate than Krumhansl-Schmuckler.
METHODS = ["cnn", "krumhansl"] if CNN_AVAILABLE else ["krumhansl"]


def _analyze_krumhansl(y_harmonic, sr):
    chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr)
    chroma_mean = chroma.mean(axis=1)

    major_corrs = _correlate(chroma_mean, _MAJOR_PROFILE)
    minor_corrs = _correlate(chroma_mean, _MINOR_PROFILE)

    best_major_pc = int(np.argmax(major_corrs))
    best_minor_pc = int(np.argmax(minor_corrs))
    best_major = major_corrs[best_major_pc]
    best_minor = minor_corrs[best_minor_pc]

    if best_major >= best_minor:
        return best_major_pc, "major", float(best_major)
    return best_minor_pc, "minor", float(best_minor)


def _analyze_cnn(audio_path):
    """CNN key detection (madmom, trained on the GiantSteps dataset).

    Generally more accurate than Krumhansl-Schmuckler, especially for songs
    where the relative/parallel key gets picked instead of the true key.
    """
    pred = CNNKeyRecognitionProcessor()(audio_path)
    label = key_prediction_to_label(pred)
    root, mode = label.split(" ")
    return _NOTE_TO_PC[root], mode, float(np.atleast_2d(pred)[0].max())


def analyze(audio_path, method="krumhansl"):
    """Analyze an audio file once and return key + tempo.

    `method` is "krumhansl" (default, fast chroma-correlation) or "cnn" (a
    GiantSteps-trained CNN via madmom, generally more accurate but slower and
    only available if madmom is installed).

    Returns a dict: {pitch_class, mode, confidence, bpm, beat_offset}.
    pitch_class is 0-11 (0 = C); mode is "major"/"minor"; confidence ~0-1;
    bpm is the estimated tempo (float); beat_offset is the time in seconds of
    the first detected beat (a default "bar 1" anchor).
    """
    y, sr = librosa.load(audio_path, sr=22050, mono=True)

    # Separate harmonic (for pitch) and percussive (for tempo) components.
    y_harmonic, y_percussive = librosa.effects.hpss(y)

    if method == "cnn":
        if not CNN_AVAILABLE:
            raise ValueError("CNN key detection isn't available (madmom not installed).")
        pc, mode, conf = _analyze_cnn(audio_path)
    else:
        pc, mode, conf = _analyze_krumhansl(y_harmonic, sr)

    tempo, beats = librosa.beat.beat_track(y=y_percussive, sr=sr)
    bpm = round(float(np.atleast_1d(tempo)[0]), 3)
    # Time of the first detected beat — a sensible default "bar 1" anchor the
    # user can re-align by ear in the player. 0.0 if no beats were found.
    beat_times = librosa.frames_to_time(beats, sr=sr)
    beat_offset = round(float(beat_times[0]), 3) if len(beat_times) else 0.0

    return {"pitch_class": pc, "mode": mode, "confidence": conf,
            "bpm": bpm, "beat_offset": beat_offset}
