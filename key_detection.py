"""Audio key detection using the Krumhansl-Schmuckler key-finding algorithm.

We compute a chromagram, average it over time to get the overall pitch-class
distribution, then correlate that against the 24 (12 major + 12 minor) key
profiles. The best-correlating key wins.
"""

import numpy as np
import librosa

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


def analyze(audio_path):
    """Analyze an audio file once and return key + tempo.

    Returns a dict: {pitch_class, mode, confidence, bpm}.
    pitch_class is 0-11 (0 = C); mode is "major"/"minor"; confidence ~0-1;
    bpm is the estimated tempo in beats per minute (rounded int).
    """
    y, sr = librosa.load(audio_path, sr=22050, mono=True)

    # Separate harmonic (for pitch) and percussive (for tempo) components.
    y_harmonic, y_percussive = librosa.effects.hpss(y)

    chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr)
    chroma_mean = chroma.mean(axis=1)

    major_corrs = _correlate(chroma_mean, _MAJOR_PROFILE)
    minor_corrs = _correlate(chroma_mean, _MINOR_PROFILE)

    best_major_pc = int(np.argmax(major_corrs))
    best_minor_pc = int(np.argmax(minor_corrs))
    best_major = major_corrs[best_major_pc]
    best_minor = minor_corrs[best_minor_pc]

    if best_major >= best_minor:
        pc, mode, conf = best_major_pc, "major", float(best_major)
    else:
        pc, mode, conf = best_minor_pc, "minor", float(best_minor)

    tempo, _ = librosa.beat.beat_track(y=y_percussive, sr=sr)
    bpm = int(round(float(np.atleast_1d(tempo)[0])))

    return {"pitch_class": pc, "mode": mode, "confidence": conf, "bpm": bpm}
