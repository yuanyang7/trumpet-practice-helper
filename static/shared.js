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
  if (!opts._fromEdit) window._detected = JSON.parse(JSON.stringify(data));
  const results = document.getElementById('results');
  window._lastResult = data;
  window._scales = data.scales;

  const saveBtn = opts.onSave
    ? `<button class="save-btn" id="saveBtn">💾 Save</button>` : '';
  const editBtn = `<button class="edit-btn" id="editBtn">✎ Edit key/tempo</button>`;
  const titleHtml = data.title
    ? `<div class="songtitle">${escapeHtml(data.title)}${saveBtn}${editBtn}</div>` : '';

  const detected = window._detected;
  const edited = data.concert_key !== detected.concert_key || Math.round(data.bpm) !== Math.round(detected.bpm);
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
        <div class="value">${data.bpm} <small style="font-size:1rem">BPM</small></div>
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

  const scales = data.scales.map((s, si) => {
    const notes = s.notes.map((n, ni) => `
      <div class="note" data-scale="${si}" data-note="${ni}">
        <div class="nname">${n.name}<span class="noct">${n.octave}</span></div>
        <div class="concert">sounds <b>${n.concert}</b></div>
        ${valveDiagram(n.valves)}
        ${altDiagram(n.alternates)}
      </div>`).join('');
    return `<div class="scale">
      <h2>${s.name}
        <button class="play-btn" data-scale="${si}">▶ Play</button>
      </h2>
      <div class="notes">${notes}</div>
    </div>`;
  }).join('');

  results.innerHTML = keys + scales;

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

async function playScale(scaleIndex, btn) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();

  const myToken = ++playToken;
  document.querySelectorAll('.play-btn').forEach(b => {
    b.classList.remove('playing'); b.textContent = '▶ Play';
  });
  btn.classList.add('playing');
  btn.textContent = '■ Stop';

  const notes = window._scales[scaleIndex].notes;
  const noteDur = 0.4;
  const step = 0.42;
  const t0 = audioCtx.currentTime + 0.05;

  notes.forEach((n, i) => {
    playTone(noteToFreq(n.name, n.octave), t0 + i * step, noteDur);
  });

  const cards = document.querySelectorAll(`.note[data-scale="${scaleIndex}"]`);
  for (let i = 0; i < notes.length; i++) {
    setTimeout(() => {
      if (myToken !== playToken) return;
      cards.forEach(c => c.classList.remove('active'));
      const c = document.querySelector(`.note[data-scale="${scaleIndex}"][data-note="${i}"]`);
      if (c) c.classList.add('active');
    }, i * step * 1000);
  }
  setTimeout(() => {
    if (myToken !== playToken) return;
    cards.forEach(c => c.classList.remove('active'));
    btn.classList.remove('playing');
    btn.textContent = '▶ Play';
  }, notes.length * step * 1000 + 200);
}

function stopPlayback() {
  playToken++;
  document.querySelectorAll('.play-btn').forEach(b => {
    b.classList.remove('playing'); b.textContent = '▶ Play';
  });
  document.querySelectorAll('.note.active').forEach(c => c.classList.remove('active'));
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
}

// Delegated play/stop handling — attach once per page.
function wirePlayback() {
  document.getElementById('results').addEventListener('click', (e) => {
    const btn = e.target.closest('.play-btn');
    if (!btn) return;
    const idx = parseInt(btn.dataset.scale, 10);
    if (btn.classList.contains('playing')) stopPlayback();
    else playScale(idx, btn);
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
