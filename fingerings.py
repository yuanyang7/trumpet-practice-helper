"""Standard Bb trumpet fingerings and scale generation.

All note names here are WRITTEN pitch (what a trumpet player reads), not concert pitch.
Valve numbers: 1 = first valve (closest to mouthpiece), 2 = second, 3 = third.
An empty list means "open" (no valves pressed).
"""

# Twelve pitch classes. We use sharps internally and translate to flats for display
# when a key is a flat key, so the chart reads the way a musician expects.
SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Standard trumpet fingering chart over the practical written range (F#3 -> C6).
# Keyed by (pitch_class, octave) where pitch_class is the sharp spelling.
# Each value is a list of valve combinations: the first is the primary
# fingering, the rest are common alternates. The main alternate comes from the
# valve equivalence 1+2 == 3 (both lower the pitch ~3 semitones).
_CHART = {
    ("F#", 3): [[1, 2, 3]],
    ("G", 3): [[1, 3]],
    ("G#", 3): [[2, 3]],
    ("A", 3): [[1, 2], [3]],
    ("A#", 3): [[1]],
    ("B", 3): [[2]],
    ("C", 4): [[]],
    ("C#", 4): [[1, 2, 3]],
    ("D", 4): [[1, 3]],
    ("D#", 4): [[2, 3]],
    ("E", 4): [[1, 2], [3]],
    ("F", 4): [[1]],
    ("F#", 4): [[2]],
    ("G", 4): [[]],
    ("G#", 4): [[2, 3]],
    ("A", 4): [[1, 2], [3]],
    ("A#", 4): [[1]],
    ("B", 4): [[2]],
    ("C", 5): [[]],
    ("C#", 5): [[1, 2], [3]],
    ("D", 5): [[1]],
    ("D#", 5): [[2]],
    ("E", 5): [[]],
    ("F", 5): [[1]],
    ("F#", 5): [[2]],
    ("G", 5): [[]],
    ("G#", 5): [[2, 3]],
    ("A", 5): [[1, 2], [3]],
    ("A#", 5): [[1]],
    ("B", 5): [[2]],
    ("C", 6): [[]],
}

# Scale formulas as semitone offsets from the tonic.
SCALE_FORMULAS = {
    "Major (Ionian)": [0, 2, 4, 5, 7, 9, 11],
    "Natural Minor (Aeolian)": [0, 2, 3, 5, 7, 8, 10],
    "Harmonic Minor": [0, 2, 3, 5, 7, 8, 11],
    "Melodic Minor (asc)": [0, 2, 3, 5, 7, 9, 11],
    "Major Pentatonic": [0, 2, 4, 7, 9],
    "Minor Pentatonic": [0, 3, 5, 7, 10],
    "Blues": [0, 3, 5, 6, 7, 10],
    "Chromatic": list(range(12)),
}

# Which scales to show depending on whether the detected key is major or minor.
SCALES_FOR_MODE = {
    "major": ["Major (Ionian)", "Major Pentatonic", "Blues", "Chromatic"],
    "minor": [
        "Natural Minor (Aeolian)",
        "Harmonic Minor",
        "Melodic Minor (asc)",
        "Minor Pentatonic",
        "Blues",
        "Chromatic",
    ],
}

# Flat keys (by tonic pitch-class index) where flat spelling reads better.
_FLAT_TONICS = {1, 3, 5, 6, 8, 10}  # Db, Eb, F, Gb, Ab, Bb


def _spell(pc, prefer_flats):
    return (FLAT_NAMES if prefer_flats else SHARP_NAMES)[pc % 12]


def _fingering_for(pc, octave):
    """Look up fingerings for a sharp-spelled pitch class at an octave.

    Returns (primary, alternates) where primary is a valve list (possibly empty
    for an open note) and alternates is a list of valve lists. Returns
    (None, []) if the note is outside the playable range entirely. Falls back to
    the same pitch class one octave down/up so a scale never has a gap.
    """
    name = SHARP_NAMES[pc % 12]
    for oct_try in (octave, octave - 1, octave + 1):
        if (name, oct_try) in _CHART:
            combos = _CHART[(name, oct_try)]
            return combos[0], combos[1:]
    return None, []


def build_scales(tonic_pc, mode, start_octave=4):
    """Return a list of scales for the given (written, Bb-trumpet) tonic and mode.

    Each note is {"name", "octave", "valves", "alternates", "concert"} where
    "name" is the written pitch the player reads/fingers and "concert" is the
    pitch that actually sounds (a whole step lower).
    """
    prefer_flats = (tonic_pc % 12) in _FLAT_TONICS or mode == "minor"
    # The concert key is a whole step below the written/trumpet key; spell its
    # notes by the concert key's own flat/sharp preference.
    concert_tonic = (tonic_pc - 2) % 12
    concert_flats = (concert_tonic % 12) in _FLAT_TONICS or mode == "minor"
    scale_names = SCALES_FOR_MODE["major" if mode == "major" else "minor"]

    def make_note(pc, octave):
        primary, alternates = _fingering_for(pc, octave)
        return {
            "name": _spell(pc, prefer_flats),
            "octave": octave,
            "valves": primary,
            "alternates": alternates,
            "concert": _spell((pc - 2) % 12, concert_flats),
        }

    scales = []
    for sname in scale_names:
        formula = SCALE_FORMULAS[sname]
        notes = []
        prev_pc = None
        octave = start_octave
        for semitones in formula:
            pc = (tonic_pc + semitones) % 12
            # bump octave when we wrap past B
            if prev_pc is not None and pc <= prev_pc:
                octave += 1
            prev_pc = pc
            notes.append(make_note(pc, octave))
        # add the tonic an octave up to close the scale
        top_oct = octave + (1 if (tonic_pc % 12) <= prev_pc else 0)
        notes.append(make_note(tonic_pc, top_oct))
        scales.append({"name": sname, "notes": notes})
    return scales


def transpose_for_trumpet(concert_pc):
    """Concert pitch -> written Bb-trumpet pitch (up a major second)."""
    return (concert_pc + 2) % 12


def key_name(pc, mode, prefer_flats=None):
    if prefer_flats is None:
        prefer_flats = (pc % 12) in _FLAT_TONICS or mode == "minor"
    return f"{_spell(pc, prefer_flats)} {'major' if mode == 'major' else 'minor'}"
