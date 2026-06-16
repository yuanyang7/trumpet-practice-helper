"""Monophonic melody transcription of a passage, rendered as a trumpet tab.

This does NOT isolate the trumpet from a full mix (no off-the-shelf tool does).
It tracks the single most prominent pitch line in the trumpet register, cleaned
with cheap DSP so drums/bass/sub-pads are suppressed:

    1. HPSS              -> drop drums/percussion (keep the harmonic part)
    2. band-pass 220-1000 Hz -> drop bass + sub-pads, bias toward trumpet range
    3. librosa.pyin      -> one fundamental per frame, range-limited
    4. confidence + onset gating, min-duration filter -> discrete notes

It works best on an exposed/solo trumpet passage, which is why the caller picks
a bar range. Notes come out as concert pitch, then get transposed to written
Bb-trumpet pitch and looked up in the fingering chart (see fingerings.py).
"""

import numpy as np
import librosa
from scipy.signal import butter, sosfiltfilt

import fingerings as fng

# Trumpet fundamental roughly spans concert Bb3 (~233 Hz) to Bb5 (~932 Hz).
# We pad slightly so notes at the edges aren't clipped.
FMIN = 220.0
FMAX = 1000.0
SR = 22050
HOP = 512

# Tuning knobs for the note segmentation. We trust pyin's own voiced/unvoiced
# decision (voiced_flag) and additionally drop very low-confidence frames; an
# absolute probability threshold turns out too strict even for clean tones.
VOICED_FLOOR = 0.1         # discard frames pyin is essentially unsure about
MIN_NOTE_SEC = 0.08        # drop blips / octave-jump glitches shorter than this
QUANTIZE = 0.25            # snap beats/durations to the nearest sixteenth note


def _bandpass(y, sr, lo=FMIN, hi=FMAX):
    """4th-order Butterworth band-pass; zero-phase so onsets don't shift."""
    nyq = sr / 2.0
    hi = min(hi, nyq * 0.99)
    sos = butter(4, [lo / nyq, hi / nyq], btype="band", output="sos")
    return sosfiltfilt(sos, y)


def _segment_notes(midi, voiced, times, onset_times):
    """Group consecutive same-pitch voiced frames into (start, end, midi) notes.

    A note is also forced to break at a detected onset, so re-articulated notes
    of the same pitch (a trumpet tonguing repeats) become separate notes.
    """
    onset_idx = set()
    if len(onset_times):
        for ot in onset_times:
            onset_idx.add(int(np.argmin(np.abs(times - ot))))

    notes = []
    cur_pitch = None
    cur_start = 0
    for i in range(len(midi)):
        on = voiced[i]
        pitch = int(round(midi[i])) if on else None
        breaks = (pitch != cur_pitch) or (i in onset_idx)
        if breaks:
            if cur_pitch is not None:
                notes.append((times[cur_start], times[i], cur_pitch))
            cur_pitch = pitch
            cur_start = i
    if cur_pitch is not None:
        notes.append((times[cur_start], times[-1], cur_pitch))
    return notes


def _bar_math(bpm, beat_offset, beats_per_measure):
    beat_len = 60.0 / bpm
    bar_len = beats_per_measure * beat_len
    bar_phase = ((beat_offset % bar_len) + bar_len) % bar_len
    return beat_len, bar_len, bar_phase


def _quantize(x, step=QUANTIZE):
    return round(x / step) * step


def analyze_range(audio_path, start_sec, bpm, beat_offset, beats_per_measure,
                  prefer_flats=False):
    """Transcribe an audio slice into a list of trumpet-tab note dicts.

    `audio_path` is a wav slice that begins at absolute time `start_sec` in the
    song. `bpm`, `beat_offset`, `beats_per_measure` describe the song's bar grid
    (matching the JS player) so notes can be placed on a bar/beat.

    Each note: {bar, beat, dur_beats, name, octave, valves, alternates, concert}
    where `name`/`octave` are WRITTEN Bb-trumpet pitch and `concert` is what
    sounds (a whole step lower). Notes outside the chart get valves=None.
    """
    y, sr = librosa.load(audio_path, sr=SR, mono=True)
    if len(y) == 0:
        return []

    y_harmonic, _ = librosa.effects.hpss(y)
    y_band = _bandpass(y_harmonic, sr)

    f0, voiced_flag, voiced_prob = librosa.pyin(
        y_band, fmin=FMIN, fmax=FMAX, sr=sr, hop_length=HOP)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP)
    midi = librosa.hz_to_midi(f0)             # NaN where unvoiced
    voiced = voiced_flag & (voiced_prob >= VOICED_FLOOR) & ~np.isnan(midi)
    midi = np.where(voiced, midi, 0.0)

    onset_times = librosa.onset.onset_detect(
        y=y_band, sr=sr, hop_length=HOP, units="time", backtrack=True)

    raw = _segment_notes(midi, voiced, times, onset_times)

    beat_len, bar_len, bar_phase = _bar_math(bpm, beat_offset, beats_per_measure)

    notes = []
    for rel_start, rel_end, concert_midi in raw:
        dur = rel_end - rel_start
        if dur < MIN_NOTE_SEC:
            continue
        # Concert -> written Bb-trumpet (up a major second).
        concert_pc = concert_midi % 12
        written_midi = concert_midi + 2
        written_pc = written_midi % 12
        written_oct = written_midi // 12 - 1
        primary, alternates = fng._fingering_for(written_pc, written_oct)

        # Place on the song's bar grid.
        t = start_sec + rel_start
        bars_in = (t - bar_phase) / bar_len
        bar = int(np.floor(bars_in)) + 1
        beat = _quantize(((t - bar_phase) % bar_len) / beat_len)
        dur_beats = max(QUANTIZE, _quantize(dur / beat_len))

        notes.append({
            "bar": max(1, bar),
            "beat": beat,
            "dur_beats": dur_beats,
            "name": fng._spell(written_pc, prefer_flats),
            "octave": int(written_oct),
            "valves": primary,
            "alternates": alternates,
            "concert": fng._spell(concert_pc, prefer_flats),
        })
    return notes
