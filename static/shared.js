/* Shared logic for both the processing page (Mac/Flask) and the practice page
   (Vercel/static). Handles: rendering an analysis result, scale playback, and
   talking to Supabase for saved songs. Both pages must define window.CONFIG
   (see config.js) and contain #results and #status elements. */

/* ---------------- Supabase (saved songs) ----------------
   We talk to Supabase's built-in REST API (PostgREST) directly with fetch, so
   there's no SDK to load and the page works offline-cached. A row is:
     { id, title, video_id, data, created_at }
   where `data` is the full analysis JSON the app renders. */
const SB = {
  get url() { return window.CONFIG.SUPABASE_URL.replace(/\/$/, ''); },
  get key() { return window.CONFIG.SUPABASE_ANON_KEY; },
  headers(extra) {
    return Object.assign(
      { apikey: this.key, Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' },
      extra || {}
    );
  },
  configured() {
    return this.url && this.key && !this.url.includes('YOUR-') && !this.key.includes('YOUR-');
  },
  async list() {
    const r = await fetch(`${this.url}/rest/v1/songs?select=*&order=created_at.desc`, { headers: this.headers() });
    if (!r.ok) throw new Error(`Supabase list failed (${r.status}): ${await r.text()}`);
    return r.json();
  },
  async save(item) {
    // Upsert on video_id so re-analyzing a song updates its row instead of duplicating.
    const r = await fetch(`${this.url}/rest/v1/songs?on_conflict=video_id`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(item),
    });
    if (!r.ok) throw new Error(`Supabase save failed (${r.status}): ${await r.text()}`);
    return (await r.json())[0];
  },
  async update(id, fields) {
    const r = await fetch(`${this.url}/rest/v1/songs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(fields),
    });
    if (!r.ok) throw new Error(`Supabase update failed (${r.status}): ${await r.text()}`);
    return (await r.json())[0];
  },
  async remove(id) {
    const r = await fetch(`${this.url}/rest/v1/songs?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: this.headers(),
    });
    if (!r.ok) throw new Error(`Supabase delete failed (${r.status}): ${await r.text()}`);
  },
};

/* ---------------- Rendering ---------------- */
function valveDiagram(valves) {
  if (valves === null) {
    return '<div class="open-label">—</div>';
  }
  if (valves.length === 0) {
    let cells = '';
    for (let v = 1; v <= 3; v++) cells += `<div class="valve">${v}</div>`;
    return `<div class="valves">${cells}</div><div class="open-label">open</div>`;
  }
  let cells = '';
  for (let v = 1; v <= 3; v++) {
    const on = valves.includes(v) ? ' on' : '';
    cells += `<div class="valve${on}">${v}</div>`;
  }
  return `<div class="valves">${cells}</div>`;
}

function altDiagram(alternates) {
  if (!alternates || alternates.length === 0) return '';
  const diagrams = alternates.map(valves => {
    let cells = '';
    for (let v = 1; v <= 3; v++) {
      const on = valves.includes(v) ? ' on' : '';
      cells += `<div class="valve${on}">${v}</div>`;
    }
    return `<div class="valves">${cells}</div>`;
  }).join('');
  return `<div class="alt"><div class="alt-label">alt</div>${diagrams}</div>`;
}

/* ---------------- Music theory (mirrors fingerings.py) ----------------
   Lets the key-edit UI recompute fingering charts client-side, without a
   round trip to the Flask backend (which the static practice page can't
   reach anyway). */
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_TONICS = new Set([1, 3, 5, 6, 8, 10]); // Db, Eb, F, Gb, Ab, Bb

// Dropdown labels for picking a key root, indexed by pitch class 0-11.
const ROOT_OPTIONS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

const FINGERING_CHART = {
  'F#3': [[1, 2, 3]],
  'G3': [[1, 3]], 'G#3': [[2, 3]], 'A3': [[1, 2], [3]], 'A#3': [[1]], 'B3': [[2]],
  'C4': [[]], 'C#4': [[1, 2, 3]], 'D4': [[1, 3]], 'D#4': [[2, 3]], 'E4': [[1, 2], [3]],
  'F4': [[1]], 'F#4': [[2]], 'G4': [[]], 'G#4': [[2, 3]], 'A4': [[1, 2], [3]],
  'A#4': [[1]], 'B4': [[2]],
  'C5': [[]], 'C#5': [[1, 2], [3]], 'D5': [[1]], 'D#5': [[2]], 'E5': [[]],
  'F5': [[1]], 'F#5': [[2]], 'G5': [[]], 'G#5': [[2, 3]], 'A5': [[1, 2], [3]],
  'A#5': [[1]], 'B5': [[2]],
  'C6': [[]],
};

const SCALE_FORMULAS = {
  'Major (Ionian)': [0, 2, 4, 5, 7, 9, 11],
  'Natural Minor (Aeolian)': [0, 2, 3, 5, 7, 8, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Melodic Minor (asc)': [0, 2, 3, 5, 7, 9, 11],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const SCALES_FOR_MODE = {
  major: ['Major (Ionian)', 'Major Pentatonic', 'Blues', 'Chromatic'],
  minor: ['Natural Minor (Aeolian)', 'Harmonic Minor', 'Melodic Minor (asc)', 'Minor Pentatonic', 'Blues', 'Chromatic'],
};

function spell(pc, preferFlats) {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
}

function fingeringFor(pc, octave) {
  const name = SHARP_NAMES[((pc % 12) + 12) % 12];
  for (const oct of [octave, octave - 1, octave + 1]) {
    const combos = FINGERING_CHART[`${name}${oct}`];
    if (combos) return [combos[0], combos.slice(1)];
  }
  return [null, []];
}

function transposeForTrumpet(concertPc) {
  return ((concertPc + 2) % 12 + 12) % 12;
}

function keyName(pc, mode) {
  return `${spell(pc, FLAT_TONICS.has(((pc % 12) + 12) % 12) || mode === 'minor')} ${mode}`;
}

// Splits "E minor" -> { pc: 4, mode: 'minor' }.
function parseKey(keyStr) {
  const [root, mode] = keyStr.split(' ');
  return { pc: SEMITONES[root], mode };
}

function buildScales(tonicPc, mode, startOctave = 4) {
  const preferFlats = FLAT_TONICS.has(tonicPc % 12) || mode === 'minor';
  const concertTonic = (tonicPc - 2 + 12) % 12;
  const concertFlats = FLAT_TONICS.has(concertTonic % 12) || mode === 'minor';
  const scaleNames = SCALES_FOR_MODE[mode === 'major' ? 'major' : 'minor'];

  function makeNote(pc, octave) {
    const [primary, alternates] = fingeringFor(pc, octave);
    return {
      name: spell(pc, preferFlats),
      octave,
      valves: primary,
      alternates,
      concert: spell((pc - 2 + 12) % 12, concertFlats),
    };
  }

  return scaleNames.map(sname => {
    const formula = SCALE_FORMULAS[sname];
    const notes = [];
    let prevPc = null;
    let octave = startOctave;
    for (const semitones of formula) {
      const pc = (tonicPc + semitones) % 12;
      if (prevPc !== null && pc <= prevPc) octave += 1;
      prevPc = pc;
      notes.push(makeNote(pc, octave));
    }
    const topOct = octave + ((tonicPc % 12) <= prevPc ? 1 : 0);
    notes.push(makeNote(tonicPc, topOct));
    return { name: sname, notes };
  });
}

/* ---------------- Chromatic display + scale highlighting ----------------
   The note display is a fixed chromatic reference: every semitone across three
   octaves (home-1, home, home+1). Picking a scale highlights the notes that
   belong to it; "Play" runs that scale once, ascending, in the home octave. */
const BASE_OCTAVE = 4;       // the "home" (octave 0) row; rows above/below are ±1

// Scales the user can pick to practice. "Chromatic" highlights every note.
const PRACTICE_SCALES = [
  'Chromatic',
  'Major (Ionian)',
  'Natural Minor (Aeolian)',
  'Harmonic Minor',
  'Melodic Minor (asc)',
  'Major Pentatonic',
  'Minor Pentatonic',
  'Blues',
];

// Pitch classes (0-11) belonging to `scaleName` rooted at `tonicPc`.
function scalePcs(tonicPc, scaleName) {
  return new Set(SCALE_FORMULAS[scaleName].map(s => (tonicPc + s) % 12));
}

// Build the chromatic reference grid: three octave rows (home-1, home, home+1),
// each holding all 12 semitones C..B as written (Bb-trumpet) pitches.
function buildChromatic(tonicPc, mode, baseOctave = BASE_OCTAVE) {
  const preferFlats = FLAT_TONICS.has(tonicPc % 12) || mode === 'minor';
  const concertFlats = FLAT_TONICS.has((tonicPc - 2 + 12) % 12) || mode === 'minor';
  return [baseOctave - 1, baseOctave, baseOctave + 1].map(octave => {
    const notes = [];
    for (let pc = 0; pc < 12; pc++) {
      const [primary, alternates] = fingeringFor(pc, octave);
      notes.push({
        pc,
        name: spell(pc, preferFlats),
        octave,
        valves: primary,
        alternates,
        concert: spell((pc - 2 + 12) % 12, concertFlats),
      });
    }
    return { octave, rel: octave - baseOctave, notes };
  });
}

// The selected scale played once, ascending, starting at the tonic in the home
// octave and resolving on the octave tonic above.
function scalePlayNotes(tonicPc, mode, scaleName, baseOctave = BASE_OCTAVE) {
  const preferFlats = FLAT_TONICS.has(tonicPc % 12) || mode === 'minor';
  const notes = [];
  let prevPc = null;
  let octave = baseOctave;
  for (const semitones of SCALE_FORMULAS[scaleName]) {
    const pc = (tonicPc + semitones) % 12;
    if (prevPc !== null && pc <= prevPc) octave += 1;
    prevPc = pc;
    notes.push({ pc, octave, name: spell(pc, preferFlats) });
  }
  const topOct = octave + ((tonicPc % 12) <= prevPc ? 1 : 0);
  notes.push({ pc: tonicPc % 12, octave: topOct, name: spell(tonicPc, preferFlats) });
  return notes;
}

const COMMON_TEMPOS = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];

// Builds <option> tags for the metronome dropdown: the common tempos plus the
// song's own (rounded) BPM, selected by default so playback matches the song.
function tempoOptions(bpm) {
  const songBpm = Math.round(bpm);
  const tempos = Array.from(new Set([...COMMON_TEMPOS, songBpm])).sort((a, b) => a - b);
  return tempos.map(t =>
    `<option value="${t}"${t === songBpm ? ' selected' : ''}>${t} BPM</option>`).join('');
}

/* Render an analysis result into #results. `opts.onSave`, if given, adds a Save
   button next to the title and calls onSave(data, button) when clicked.
   `opts.onUpdate`, if given, adds an "Update saved song" button to the edit
   panel (shown once the key/tempo has been edited) and calls
   onUpdate(data, button) when clicked. */
function renderResult(data, opts) {
  opts = opts || {};
  window._lastOpts = opts;
  stopMetronome();
  clearRange();          // a previous song's range-loop watcher
  stopBarTicker();       // a previous song's position display ticker
  if (!opts._fromEdit) {
    window._detected = JSON.parse(JSON.stringify(data));
    window._selectedScale = 'Chromatic';  // reset to "show all" for each new song
  }
  const results = document.getElementById('results');
  window._lastResult = data;

  const saveBtn = opts.onSave
    ? `<button class="save-btn" id="saveBtn">💾 Save</button>` : '';
  const editBtn = `<button class="edit-btn" id="editBtn">✎ Edit key/tempo</button>`;
  const titleHtml = data.title
    ? `<div class="songtitle">${escapeHtml(data.title)}${saveBtn}${editBtn}</div>` : '';

  const detected = window._detected;
  const edited = data.concert_key !== detected.concert_key
    || Math.round(data.bpm) !== Math.round(detected.bpm)
    || JSON.stringify(data.tab || null) !== JSON.stringify(detected.tab || null);
  const { pc: concertPc, mode } = parseKey(data.concert_key);
  const updateBtn = opts.onUpdate
    ? `<button class="edit-apply" id="editUpdateBtn"${edited ? '' : ' disabled'}>💾 Update saved song</button>` : '';
  const editBar = `
    <div class="editbar" id="editBar"${opts._editOpen ? '' : ' hidden'}>
      <label>Key
        <select id="editRoot">${ROOT_OPTIONS.map((label, pc) =>
          `<option value="${pc}"${pc === concertPc ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <select id="editMode">
          <option value="major"${mode === 'major' ? ' selected' : ''}>major</option>
          <option value="minor"${mode === 'minor' ? ' selected' : ''}>minor</option>
        </select>
      </label>
      <label>Tempo <input type="number" id="editBpm" value="${Math.round(data.bpm)}" min="20" max="300"> BPM</label>
      <button class="edit-apply" id="editApply">Apply</button>
      <button class="edit-reset" id="editReset"${edited ? '' : ' disabled'}>Reset to detected</button>
      ${updateBtn}
      ${edited ? `<small class="edit-detected">detected: ${detected.concert_key}, ${Math.round(detected.bpm)} BPM</small>` : ''}
    </div>`;

  const keys = titleHtml + editBar + `
    <div class="keys">
      <div class="keycard">
        <div class="label">Concert Key</div>
        <div class="value">${data.concert_key}</div>
        <small>what the recording is in</small>
      </div>
      <div class="keycard">
        <div class="label">Trumpet Key (Bb)</div>
        <div class="value">${data.trumpet_key}</div>
        <small>what you read & play</small>
      </div>
      <div class="keycard">
        <div class="label">Tempo</div>
        <div class="value"><span id="bpmValue">${Math.round(data.bpm)}</span> <small style="font-size:1rem">BPM</small></div>
        <small>estimated</small>
        <div class="metro">
          <select id="metroSelect">${tempoOptions(data.bpm)}</select>
          <button class="metro-btn" id="metroBtn">▶ Click</button>
        </div>
      </div>
      <div class="keycard">
        <div class="label">Confidence</div>
        <div class="value">${Math.round(data.confidence * 100)}%</div>
        <small>detection certainty</small>
      </div>
    </div>`;

  const trumpetPc = transposeForTrumpet(concertPc);
  window._scaleTonic = trumpetPc;
  window._scaleMode = mode;
  const selected = window._selectedScale || 'Chromatic';
  const inScale = scalePcs(trumpetPc, selected);

  const relLabel = { '-1': '−1 octave', '0': 'home octave', '1': '+1 octave' };
  const rows = buildChromatic(trumpetPc, mode).map(row => {
    const cells = row.notes.map(n => {
      const cls = inScale.has(n.pc) ? 'note in-scale' : 'note dimmed';
      return `<div class="${cls}" data-pc="${n.pc}" data-oct="${n.octave}">
        <div class="nname">${n.name}<span class="noct">${n.octave}</span></div>
        <div class="concert">sounds <b>${n.concert}</b></div>
        ${valveDiagram(n.valves)}
        ${altDiagram(n.alternates)}
      </div>`;
    }).join('');
    return `<div class="octave-row${row.rel === 0 ? ' home' : ''}">
      <div class="octave-label">${relLabel[String(row.rel)]}</div>
      <div class="notes">${cells}</div>
    </div>`;
  }).join('');

  const pickerOpts = PRACTICE_SCALES.map(s =>
    `<option value="${s}"${s === selected ? ' selected' : ''}>${s}</option>`).join('');

  const scales = `<div class="scale chromatic">
    <h2>Notes &amp; Scales
      <select class="scale-picker" id="scalePicker">${pickerOpts}</select>
      <button class="play-btn" id="scalePlay">▶ Play</button>
    </h2>
    ${rows}
  </div>`;

  results.innerHTML = keys + transportPanel(data) + scales + tabSection(data);
  drawTabStaff(data);

  if (data.video_id) loadYouTube(data.video_id);
  else if (window._ytPlayer && window._ytPlayer.pauseVideo) window._ytPlayer.pauseVideo();

  const btn = document.getElementById('saveBtn');
  if (btn && opts.onSave) btn.addEventListener('click', () => opts.onSave(data, btn));

  const updBtn = document.getElementById('editUpdateBtn');
  if (updBtn && opts.onUpdate) updBtn.addEventListener('click', () => opts.onUpdate(data, updBtn));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------------- Web Audio scale playback ---------------- */
let audioCtx = null;
let playToken = 0;  // increments to cancel an in-progress playback

const SEMITONES = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
  'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
};

// Labels/fingerings are WRITTEN (Bb-trumpet) pitch; a trumpet sounds a whole
// step lower, so drop 2 semitones so playback matches the recording.
const WRITTEN_TO_CONCERT = -2;

function noteToFreq(name, octave) {
  const midi = (octave + 1) * 12 + SEMITONES[name] + WRITTEN_TO_CONCERT;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function playTone(freq, start, dur) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
  gain.gain.setValueAtTime(0.25, start + dur - 0.06);
  gain.gain.linearRampToValueAtTime(0, start + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + dur);
}

// Re-highlight the chromatic grid for the currently selected scale, in place
// (no full re-render, so the metronome and edit panel keep their state).
function updateScaleHighlight() {
  const inScale = scalePcs(window._scaleTonic, window._selectedScale || 'Chromatic');
  document.querySelectorAll('.chromatic .note').forEach(c => {
    const member = inScale.has(parseInt(c.dataset.pc, 10));
    c.classList.toggle('in-scale', member);
    c.classList.toggle('dimmed', !member);
  });
}

async function playSelectedScale(btn) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();

  const myToken = ++playToken;
  btn.classList.add('playing');
  btn.textContent = '■ Stop';

  const notes = scalePlayNotes(window._scaleTonic, window._scaleMode, window._selectedScale || 'Chromatic');
  const noteDur = 0.4;
  const step = 0.42;
  const t0 = audioCtx.currentTime + 0.05;

  notes.forEach((n, i) => {
    playTone(noteToFreq(n.name, n.octave), t0 + i * step, noteDur);
  });

  // Light up the matching chromatic cell as each note sounds.
  for (let i = 0; i < notes.length; i++) {
    setTimeout(() => {
      if (myToken !== playToken) return;
      document.querySelectorAll('.note.active').forEach(c => c.classList.remove('active'));
      const n = notes[i];
      const c = document.querySelector(`.note[data-pc="${n.pc}"][data-oct="${n.octave}"]`);
      if (c) c.classList.add('active');
    }, i * step * 1000);
  }
  setTimeout(() => {
    if (myToken !== playToken) return;
    document.querySelectorAll('.note.active').forEach(c => c.classList.remove('active'));
    btn.classList.remove('playing');
    btn.textContent = '▶ Play';
  }, notes.length * step * 1000 + 200);
}

// Play a single note card (click-to-hear). Computes the frequency straight from
// the card's pitch class + octave, so it works even for out-of-range cells.
async function playNote(card) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();
  const pc = parseInt(card.dataset.pc, 10);
  const octave = parseInt(card.dataset.oct, 10);
  const midi = (octave + 1) * 12 + pc + WRITTEN_TO_CONCERT;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  playTone(freq, audioCtx.currentTime + 0.02, 0.45);
  card.classList.add('active');
  setTimeout(() => card.classList.remove('active'), 450);
}

function stopPlayback() {
  playToken++;
  const sp = document.getElementById('scalePlay');
  if (sp) { sp.classList.remove('playing'); sp.textContent = '▶ Play'; }
  const tp = document.getElementById('tabPlay');
  if (tp) { tp.classList.remove('playing'); tp.textContent = '▶ Play tab'; }
  document.querySelectorAll('.note.active, .vf-note.active').forEach(c => c.classList.remove('active'));
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
}

/* ---------------- Trumpet line (tab) ----------------
   A best-effort monophonic transcription of a chosen bar range, rendered as a
   sequence of trumpet notes (written pitch + valves) grouped by bar. The notes
   are produced by the Flask backend (/transcribe, librosa pyin) and stored on
   data.tab so they save with the song and re-render anywhere. */
function tabSection(data) {
  if (!data.video_id) return '';
  const tab = data.tab;
  const hasNotes = tab && tab.notes && tab.notes.length;
  const playBtn = hasNotes
    ? `<button class="play-btn" id="tabPlay">▶ Play tab</button>` : '';
  return `<div class="scale tabsec" id="tabSec">
    <h2>Trumpet line (tab)
      <button class="play-btn" id="tabTranscribe">🎺 Transcribe loop bars</button>
      <button class="play-btn" id="tabWhole">🎺 Whole song</button>
      ${playBtn}
    </h2>
    <p class="tab-note">Best-effort, one note at a time, shown in written (Bb)
      pitch with the valve fingering under each note. <b>Loop bars</b> transcribes
      the looped range above (cleanest on an exposed passage); <b>Whole song</b>
      sweeps the whole track (slower, messier where the trumpet isn't the lead).
      Click a note to hear it.</p>
    <div id="tabNotes"><div id="tabStaff" class="tabstaff"></div></div>
  </div>`;
}

function valveText(valves) {
  if (valves === null) return '—';        // out of practical range
  if (valves.length === 0) return 'open';
  return valves.join('·');
}

// Map a duration in beats (assuming a quarter-note beat) to a VexFlow duration
// code + dot count, picking the closest representable value.
const VEX_DURATIONS = [
  [4, 'w', 0], [3, 'h', 1], [2, 'h', 0], [1.5, 'q', 1],
  [1, 'q', 0], [0.75, '8', 1], [0.5, '8', 0], [0.25, '16', 0],
];
function vexDuration(durBeats) {
  let best = VEX_DURATIONS[VEX_DURATIONS.length - 1];
  let bestDiff = Infinity;
  for (const row of VEX_DURATIONS) {
    const diff = Math.abs(row[0] - durBeats);
    if (diff < bestDiff) { bestDiff = diff; best = row; }
  }
  return { duration: best[1], dots: best[2] };
}

// "F#" -> "#", "Bb" -> "b", "C" -> null. VexFlow needs the accidental added as a
// modifier (the key string alone sets pitch position, not the drawn glyph).
function accidentalOf(name) {
  if (name.length < 2) return null;
  return name[1] === '#' ? '#' : 'b';
}

// Render the transcribed line as standard notation (treble clef) with the valve
// fingering annotated under each note. Drawn imperatively into #tabStaff via
// VexFlow after renderResult has set the DOM. Notes are grouped into measures;
// a non-strict voice tolerates measures that don't sum exactly to the bar
// (our transcription is approximate).
function drawTabStaff(data) {
  const host = document.getElementById('tabStaff');
  if (!host) return;
  host.innerHTML = '';
  const notes = (data && data.tab && data.tab.notes) || [];
  if (!notes.length) {
    host.innerHTML = '<p class="tab-empty">No trumpet line yet — pick the loop bars (or Whole song) and hit Transcribe.</p>';
    return;
  }
  if (!(window.Vex && Vex.Flow)) {
    host.innerHTML = '<p class="tab-empty error">Notation library failed to load (offline?).</p>';
    return;
  }
  const VF = Vex.Flow;
  const beatsPerBar = Number(data.beats_per_measure) || 4;

  // Group notes by bar, keeping each note's original index for play/highlight.
  const byBar = new Map();
  notes.forEach((n, i) => {
    if (!byBar.has(n.bar)) byBar.set(n.bar, []);
    byBar.get(n.bar).push({ n, i });
  });
  const bars = [...byBar.keys()].sort((a, b) => a - b);

  // Layout: wrap measures across as many lines as needed for the container.
  const width = Math.max(320, host.clientWidth || 800);
  const leftPad = 10, topPad = 12, lineH = 120;
  const firstW = 240, measW = 200;     // first measure of a line is wider (clef + time sig)
  const perLine = Math.max(1, 1 + Math.floor((width - leftPad - firstW) / measW));
  const numLines = Math.ceil(bars.length / perLine);

  const renderer = new VF.Renderer(host, VF.Renderer.Backends.SVG);
  renderer.resize(width, topPad * 2 + numLines * lineH);
  const ctx = renderer.getContext();

  bars.forEach((bar, idx) => {
    const col = idx % perLine;
    const row = Math.floor(idx / perLine);
    const isFirst = col === 0;
    const x = leftPad + (isFirst ? 0 : firstW + (col - 1) * measW);
    const y = topPad + row * lineH;
    const w = isFirst ? firstW : measW;

    try {
      const stave = new VF.Stave(x, y, w);
      if (isFirst) {
        stave.addClef('treble').addTimeSignature(`${beatsPerBar}/4`);
      }
      stave.setContext(ctx).draw();

      const placed = byBar.get(bar).sort((a, b) => a.n.beat - b.n.beat);
      const staveNotes = placed.map(({ n }) => {
        const { duration, dots } = vexDuration(n.dur_beats);
        const sn = new VF.StaveNote({
          clef: 'treble', keys: [`${n.name.toLowerCase()}/${n.octave}`], duration,
        });
        const acc = accidentalOf(n.name);
        if (acc) sn.addModifier(new VF.Accidental(acc), 0);
        for (let d = 0; d < dots; d++) VF.Dot.buildAndAttach([sn], { all: true });
        const ann = new VF.Annotation(valveText(n.valves))
          .setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM)
          .setFont('Arial', 9);
        sn.addModifier(ann, 0);
        return sn;
      });

      const voice = new VF.Voice({ num_beats: beatsPerBar, beat_value: 4 }).setStrict(false);
      voice.addTickables(staveNotes);
      const noteAreaStart = stave.getNoteStartX();
      new VF.Formatter().joinVoices([voice]).format([voice], Math.max(40, x + w - noteAreaStart - 12));
      voice.draw(ctx, stave);

      // Tag each drawn note's SVG group so playback can highlight it and clicks
      // can play it (best-effort: degrades gracefully if the element is absent).
      placed.forEach(({ i }, k) => {
        let el = null;
        try { el = staveNotes[k].getSVGElement(); } catch (_) { /* not drawn */ }
        if (el) { el.classList.add('vf-note'); el.setAttribute('data-idx', i); }
      });
    } catch (err) {
      // Skip a malformed measure rather than blanking the whole staff.
      console.warn('staff measure skipped', bar, err);
    }
  });
}

// Play the transcribed tab in the song's tempo, honoring each note's bar/beat
// position and duration; highlight each note card as it sounds.
async function playTab(btn) {
  const data = window._lastResult;
  if (!data || !data.tab || !(data.tab.notes || []).length) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();

  const myToken = ++playToken;
  btn.classList.add('playing');
  btn.textContent = '■ Stop';

  const m = songMeta();
  const beatSec = 60 / m.bpm;
  const notes = data.tab.notes;
  const fromBar = data.tab.from_bar || notes[0].bar;
  const t0 = audioCtx.currentTime + 0.05;

  const sched = notes.map((n, i) => {
    const startBeats = (n.bar - fromBar) * m.beatsPerBar + n.beat;
    return { i, n, start: startBeats * beatSec, dur: Math.max(0.12, n.dur_beats * beatSec) };
  });
  // Schedule each note independently: a single bad note must not abort the rest.
  sched.forEach(s => {
    const freq = noteToFreq(s.n.name, s.n.octave);
    if (!isFinite(freq)) return;
    try { playTone(freq, t0 + s.start, Math.min(s.dur, 1.5)); } catch (_) { /* skip */ }
  });
  sched.forEach(s => setTimeout(() => {
    if (myToken !== playToken) return;
    document.querySelectorAll('.vf-note.active').forEach(c => c.classList.remove('active'));
    const c = document.querySelector(`.vf-note[data-idx="${s.i}"]`);
    if (c) c.classList.add('active');
  }, s.start * 1000));

  const total = Math.max(...sched.map(s => s.start + s.dur));
  setTimeout(() => {
    if (myToken !== playToken) return;
    document.querySelectorAll('.vf-note.active').forEach(c => c.classList.remove('active'));
    btn.classList.remove('playing');
    btn.textContent = '▶ Play tab';
  }, total * 1000 + 300);
}

// Play a single transcribed note (click-to-hear on the staff), highlighting its
// notehead briefly.
async function playTabNote(idx) {
  const data = window._lastResult;
  const n = data && data.tab && (data.tab.notes || [])[idx];
  if (!n) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();
  const freq = noteToFreq(n.name, n.octave);
  if (isFinite(freq)) playTone(freq, audioCtx.currentTime + 0.02, 0.45);
  const el = document.querySelector(`.vf-note[data-idx="${idx}"]`);
  if (el) { el.classList.add('active'); setTimeout(() => el.classList.remove('active'), 450); }
}

// POST a transcription request to the Flask backend, then store the result on
// the song and re-render. `whole` sweeps the whole track; otherwise the current
// loop-bar range is used. Needs ANALYZE_API to reach the Mac (same origin on the
// processing page; the practice page can point at the Mac).
async function runTranscribe(btn, whole) {
  const data = window._lastResult;
  if (!data || !data.video_id) return;
  const valInt = (id, dflt) => Math.max(1, parseInt((document.getElementById(id) || {}).value, 10) || dflt);
  const fromBar = whole ? 1 : valInt('barFrom', 1);
  const toBar = whole ? 1 : Math.max(fromBar, valInt('barTo', fromBar));
  const api = (window.CONFIG.ANALYZE_API || '').replace(/\/$/, '');
  const m = songMeta();

  const other = document.getElementById(whole ? 'tabTranscribe' : 'tabWhole');
  btn.disabled = true;
  if (other) other.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Transcribing…';
  const notesEl = document.getElementById('tabNotes');
  if (notesEl) {
    notesEl.innerHTML = `<p class="tab-empty">Listening to ${whole ? 'the whole song… (up to ~2 min)' : `bars ${fromBar}–${toBar}… (20–40s)`}</p>`;
  }

  try {
    const res = await fetch(api + '/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: data.video_id, url: data.url, whole: !!whole,
        from_bar: fromBar, to_bar: toBar,
        bpm: m.bpm, beat_offset: Number(data.beat_offset) || 0,
        beats_per_measure: m.beatsPerBar, concert_key: data.concert_key,
      }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'Transcription failed');
    data.tab = out.tab;
    const editOpen = !(document.getElementById('editBar') || {}).hidden;
    renderResult(data, Object.assign({}, window._lastOpts, { _fromEdit: true, _editOpen: editOpen }));
  } catch (err) {
    if (notesEl) notesEl.innerHTML = `<p class="tab-empty error">${escapeHtml(err.message)}</p>`;
    btn.disabled = false;
    btn.textContent = orig;
    if (other) other.disabled = false;
  }
}

// Delegated scale play/note-click + scale-picker handling — attach once per page.
// (Transport/measure controls are handled separately in wireTransport.)
function wirePlayback() {
  const results = document.getElementById('results');
  results.addEventListener('click', (e) => {
    const btn = e.target.closest('#scalePlay');
    if (btn) {
      if (btn.classList.contains('playing')) stopPlayback();
      else playSelectedScale(btn);
      return;
    }
    const tabPlayBtn = e.target.closest('#tabPlay');
    if (tabPlayBtn) {
      if (tabPlayBtn.classList.contains('playing')) stopPlayback();
      else playTab(tabPlayBtn);
      return;
    }
    const transcribeBtn = e.target.closest('#tabTranscribe');
    if (transcribeBtn) { runTranscribe(transcribeBtn, false); return; }
    const wholeBtn = e.target.closest('#tabWhole');
    if (wholeBtn) { runTranscribe(wholeBtn, true); return; }
    const staffNote = e.target.closest('.vf-note');
    if (staffNote) { playTabNote(parseInt(staffNote.getAttribute('data-idx'), 10)); return; }
    const note = e.target.closest('.note');
    if (note) playNote(note);
  });
  results.addEventListener('change', (e) => {
    if (e.target.id !== 'scalePicker') return;
    window._selectedScale = e.target.value;
    stopPlayback();
    updateScaleHighlight();
  });
}

/* ---------------- Song playback + measures (小节) ----------------
   We drive a hidden YouTube IFrame player (by the stored video_id) as the audio
   engine, and compute bar boundaries from BPM + a "bar 1" offset, assuming a
   steady tempo and a chosen beats-per-bar. The offset is re-anchorable by ear,
   and BPM is editable (incl. ×2 / ÷2) to fix half/double-tempo detection. */
const DEFAULT_BEATS_PER_BAR = 4;
let ytRangeTimer = null;   // interval watching for the end of a play-range/loop
let ytTicker = null;       // interval updating the "current bar" readout

// Bar math reads straight from the live result object, so re-anchoring the
// offset or editing BPM takes effect immediately and persists when saved.
function songMeta() {
  const d = window._lastResult || {};
  return {
    bpm: Number(d.bpm) || 120,
    offset: Number(d.beat_offset) || 0,
    beatsPerBar: Number(d.beats_per_measure) || DEFAULT_BEATS_PER_BAR,
  };
}
function barLenSec(m) { return m.beatsPerBar * 60 / m.bpm; }
// Bar lines are a repeating grid; only the phase within a bar matters. Reduce
// the offset into [0, barLen) so bar 1 starts within the first measure (i.e.
// near the very beginning) while staying aligned to the detected beat.
function barPhase(m) { const L = barLenSec(m); return ((m.offset % L) + L) % L; }
function barStartSec(m, bar) { return barPhase(m) + (bar - 1) * barLenSec(m); }   // bar is 1-indexed
function secToBar(m, t) { return Math.floor((t - barPhase(m)) / barLenSec(m)) + 1; }

function fmtTime(s) {
  s = Math.max(0, s);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
}

// The player + measure controls, rendered only when we have a video_id.
function transportPanel(data) {
  if (!data.video_id) return '';
  const beats = Number(data.beats_per_measure) || DEFAULT_BEATS_PER_BAR;
  const initAlign = barPhase({ bpm: Number(data.bpm) || 120, offset: Number(data.beat_offset) || 0, beatsPerBar: beats });
  const beatOpts = [2, 3, 4, 6].map(n =>
    `<option value="${n}"${n === beats ? ' selected' : ''}>${n}</option>`).join('');
  return `<div class="player">
    <div class="transport">
      <button class="t-play" data-act="playpause" id="ppBtn">▶ Play</button>
      <span class="nowbar" id="nowBar">bar 1</span>
      <button class="t-btn" data-act="prevbar">⏮ bar</button>
      <button class="t-btn" data-act="nextbar">bar ⏭</button>
      <label>Go to bar <input type="number" id="barJump" class="t-num" min="1" value="1"></label>
      <button class="t-btn" data-act="jump">Go</button>
      <button class="t-btn" data-act="showvideo" id="showVideoBtn">Show video</button>
    </div>
    <div class="transport">
      <label>Loop bars <input type="number" id="barFrom" class="t-num" min="1" value="1"></label>
      <label>–<input type="number" id="barTo" class="t-num" min="1" value="4"></label>
      <label><input type="checkbox" id="barLoop" checked> loop</label>
      <button class="t-play" data-act="playrange" id="rangeBtn">▶ Play range</button>
      <button class="t-btn" data-act="anchor" title="Tap on a downbeat to align the bar grid to the music">⚓ Align beat here</button>
      <span class="offgrp" title="Nudge the bar grid to line it up by ear">
        <button class="t-btn" data-act="offminus">−</button>
        <span class="offval" id="offVal">align ${initAlign.toFixed(2)}s</span>
        <button class="t-btn" data-act="offplus">+</button>
      </span>
      <label>Beats/bar <select id="beatsPerBar" class="t-sel">${beatOpts}</select></label>
      <label>BPM <input type="number" id="barBpm" class="t-num" min="20" max="320" step="0.1" value="${(Number(data.bpm) || 120).toFixed(1)}"></label>
      <button class="t-btn" data-act="bpmdec" title="Fine −0.1 BPM — removes drift over the whole song">−</button>
      <button class="t-btn" data-act="bpminc" title="Fine +0.1 BPM — removes drift over the whole song">+</button>
      <button class="t-btn" data-act="bpmhalf" title="Half tempo">÷2</button>
      <button class="t-btn" data-act="bpm2" title="Double tempo">×2</button>
    </div>
  </div>`;
}

/* ---- YouTube IFrame player (hidden audio engine) ---- */
function ensureYtHost() {
  if (document.getElementById('ytHost')) return;
  const host = document.createElement('div');
  host.id = 'ytHost';
  host.className = 'yt-host hidden';
  const inner = document.createElement('div');
  inner.id = 'ytplayer';
  host.appendChild(inner);
  document.body.appendChild(host);
}

function ensureYouTubeAPI() {
  if (window.YT && window.YT.Player) return;
  if (document.getElementById('yt-iframe-api')) return;  // already loading
  const tag = document.createElement('script');
  tag.id = 'yt-iframe-api';
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

// Called by the IFrame API once it finishes loading.
window.onYouTubeIframeAPIReady = function () {
  window._ytReady = true;
  if (window._pendingVideoId) loadYouTube(window._pendingVideoId);
};

function loadYouTube(videoId) {
  ensureYtHost();
  if (!(window._ytReady && window.YT && window.YT.Player)) {
    window._pendingVideoId = videoId;   // create once the API is ready
    ensureYouTubeAPI();
    return;
  }
  if (window._ytPlayer && window._ytPlayer.cueVideoById) {
    if (window._ytCurrentVideo !== videoId) {
      window._ytCurrentVideo = videoId;
      window._ytPlayer.cueVideoById(videoId);
    }
  } else {
    window._ytCurrentVideo = videoId;
    window._ytPlayer = new YT.Player('ytplayer', {
      videoId,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: { onReady: startBarTicker, onStateChange: onYtStateChange },
    });
  }
  startBarTicker();
}

function onYtStateChange(e) {
  const btn = document.getElementById('ppBtn');
  if (!btn || !window.YT) return;
  const playing = e.data === YT.PlayerState.PLAYING;
  btn.textContent = playing ? '⏸ Pause' : '▶ Play';
  btn.classList.toggle('playing', playing);
}

function startBarTicker() {
  stopBarTicker();
  ytTicker = setInterval(updateNowBar, 200);
  updateNowBar();
}
function stopBarTicker() {
  if (ytTicker) { clearInterval(ytTicker); ytTicker = null; }
}
function updateNowBar() {
  const el = document.getElementById('nowBar');
  const p = window._ytPlayer;
  if (!el || !p || !p.getCurrentTime) return;
  let t;
  try { t = p.getCurrentTime(); } catch (_) { return; }
  const m = songMeta();
  const bar = Math.max(1, secToBar(m, t));
  el.textContent = `bar ${bar} · ${fmtTime(t)}`;
}

function clearRange() {
  if (ytRangeTimer) { clearInterval(ytRangeTimer); ytRangeTimer = null; }
}

function seekToBar(bar, play) {
  const p = window._ytPlayer;
  if (!p || !p.seekTo) return;
  p.seekTo(barStartSec(songMeta(), Math.max(1, bar)), true);
  if (play) p.playVideo();
}

function stepBar(delta) {
  const p = window._ytPlayer;
  if (!p || !p.getCurrentTime) return;
  clearRange();
  const m = songMeta();
  seekToBar(Math.max(1, secToBar(m, p.getCurrentTime()) + delta), true);
}

function playRange(fromBar, toBar, loop) {
  const p = window._ytPlayer;
  if (!p || !p.seekTo) return;
  clearRange();
  // Stash the range, not absolute times, so nudging the offset / editing BPM
  // mid-loop re-aligns the next pass live.
  window._range = { lo: Math.max(1, Math.min(fromBar, toBar)), hi: Math.max(fromBar, toBar), loop };
  p.seekTo(barStartSec(songMeta(), window._range.lo), true);
  p.playVideo();
  ytRangeTimer = setInterval(() => {
    const pl = window._ytPlayer;
    if (!pl || !pl.getCurrentTime || !window._range) { clearRange(); return; }
    const m = songMeta();
    const endT = barStartSec(m, window._range.hi + 1);   // through the end of the last bar
    if (pl.getCurrentTime() >= endT - 0.03) {
      if (window._range.loop) pl.seekTo(barStartSec(m, window._range.lo), true);
      else { pl.pauseVideo(); clearRange(); }
    }
  }, 40);
}

const OFFSET_STEP = 0.05;   // seconds per nudge
function updateOffsetLabel() {
  const el = document.getElementById('offVal');
  if (el) el.textContent = `align ${barPhase(songMeta()).toFixed(2)}s`;
}
function setOffset(t) {
  if (!window._lastResult) return;
  window._lastResult.beat_offset = Math.max(0, t);
  updateOffsetLabel();
  updateNowBar();
}
function nudgeOffset(delta) { setOffset((Number((window._lastResult || {}).beat_offset) || 0) + delta); }

function setBpm(newBpm) {
  newBpm = Math.round((Number(newBpm) || songMeta().bpm) * 1000) / 1000;
  newBpm = Math.min(320, Math.max(20, newBpm));
  if (window._lastResult) window._lastResult.bpm = newBpm;
  const bpmInput = document.getElementById('barBpm');
  if (bpmInput) bpmInput.value = (Math.round(newBpm * 10) / 10).toFixed(1);
  const bpmVal = document.getElementById('bpmValue');
  if (bpmVal) bpmVal.textContent = Math.round(newBpm);
  updateNowBar();
}

function toggleVideo(btn) {
  const host = document.getElementById('ytHost');
  if (!host) return;
  const showing = host.classList.toggle('shown');
  host.classList.toggle('hidden', !showing);
  btn.textContent = showing ? 'Hide video' : 'Show video';
}

// Delegated transport handling — attach once per page.
function wireTransport() {
  const results = document.getElementById('results');
  results.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'showvideo') { toggleVideo(el); return; }
    const p = window._ytPlayer;
    if (!p) return;
    const valInt = (id, dflt) => Math.max(1, parseInt((document.getElementById(id) || {}).value, 10) || dflt);
    if (act === 'playpause') {
      const st = p.getPlayerState ? p.getPlayerState() : -1;
      if (st === 1) p.pauseVideo(); else p.playVideo();
    } else if (act === 'prevbar') { stepBar(-1); }
    else if (act === 'nextbar') { stepBar(1); }
    else if (act === 'jump') { clearRange(); seekToBar(valInt('barJump', 1), true); }
    else if (act === 'playrange') {
      playRange(valInt('barFrom', 1), valInt('barTo', 1),
        (document.getElementById('barLoop') || {}).checked);
    } else if (act === 'anchor') {
      if (p.getCurrentTime) setOffset(p.getCurrentTime());
    } else if (act === 'offminus') { nudgeOffset(-OFFSET_STEP); }
    else if (act === 'offplus') { nudgeOffset(OFFSET_STEP); }
    else if (act === 'bpm2') { setBpm(songMeta().bpm * 2); }
    else if (act === 'bpmhalf') { setBpm(songMeta().bpm / 2); }
    else if (act === 'bpminc') { setBpm(songMeta().bpm + 0.1); }
    else if (act === 'bpmdec') { setBpm(songMeta().bpm - 0.1); }
  });
  results.addEventListener('change', (e) => {
    if (e.target.id === 'barBpm') setBpm(e.target.value);
    else if (e.target.id === 'beatsPerBar') {
      if (window._lastResult) window._lastResult.beats_per_measure = parseInt(e.target.value, 10) || DEFAULT_BEATS_PER_BAR;
      updateNowBar();
    }
  });
}

/* ---------------- Metronome ---------------- */
let metroAudioCtx = null;
let metroTimer = null;
let metroNextClick = 0;

function scheduleMetroClick(bpm) {
  const osc = metroAudioCtx.createOscillator();
  const gain = metroAudioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0.3, metroNextClick);
  gain.gain.exponentialRampToValueAtTime(0.0001, metroNextClick + 0.05);
  osc.connect(gain).connect(metroAudioCtx.destination);
  osc.start(metroNextClick);
  osc.stop(metroNextClick + 0.05);
  metroNextClick += 60 / bpm;
}

async function startMetronome(bpm) {
  stopMetronome();
  if (!metroAudioCtx) metroAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await metroAudioCtx.resume();

  metroNextClick = metroAudioCtx.currentTime + 0.05;
  scheduleMetroClick(bpm);
  metroTimer = setInterval(() => {
    while (metroNextClick < metroAudioCtx.currentTime + 0.1) scheduleMetroClick(bpm);
  }, 25);

  const btn = document.getElementById('metroBtn');
  if (btn) { btn.classList.add('playing'); btn.textContent = '■ Stop'; }
}

function stopMetronome() {
  if (metroTimer) { clearInterval(metroTimer); metroTimer = null; }
  const btn = document.getElementById('metroBtn');
  if (btn) { btn.classList.remove('playing'); btn.textContent = '▶ Click'; }
}

/* ---------------- Key/tempo editing ---------------- */
function applyEdit() {
  const data = window._lastResult;
  const concertPc = parseInt(document.getElementById('editRoot').value, 10);
  const mode = document.getElementById('editMode').value;
  const bpm = parseInt(document.getElementById('editBpm').value, 10) || data.bpm;
  const trumpetPc = transposeForTrumpet(concertPc);
  const newData = Object.assign({}, data, {
    concert_key: keyName(concertPc, mode),
    trumpet_key: keyName(trumpetPc, mode),
    mode,
    bpm,
    scales: buildScales(trumpetPc, mode),
  });
  renderResult(newData, Object.assign({}, window._lastOpts, { _fromEdit: true, _editOpen: true }));
}

function resetEdit() {
  const detected = JSON.parse(JSON.stringify(window._detected));
  renderResult(detected, Object.assign({}, window._lastOpts, { _fromEdit: true, _editOpen: true }));
}

// Delegated edit-panel handling — attach once per page.
function wireEdit() {
  const results = document.getElementById('results');
  results.addEventListener('click', (e) => {
    if (e.target.closest('#editBtn')) {
      const bar = document.getElementById('editBar');
      bar.hidden = !bar.hidden;
    } else if (e.target.closest('#editApply')) {
      applyEdit();
    } else if (e.target.closest('#editReset')) {
      resetEdit();
    }
  });
}

// Delegated metronome handling — attach once per page.
function wireMetronome() {
  const results = document.getElementById('results');
  results.addEventListener('click', (e) => {
    const btn = e.target.closest('#metroBtn');
    if (!btn) return;
    if (metroTimer) stopMetronome();
    else startMetronome(parseInt(document.getElementById('metroSelect').value, 10));
  });
  results.addEventListener('change', (e) => {
    if (e.target.id !== 'metroSelect') return;
    if (metroTimer) startMetronome(parseInt(e.target.value, 10));
  });
}
