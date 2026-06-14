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

/* Render an analysis result into #results. `opts.onSave`, if given, adds a Save
   button next to the title and calls onSave(data, button) when clicked. */
function renderResult(data, opts) {
  opts = opts || {};
  const results = document.getElementById('results');
  window._lastResult = data;
  window._scales = data.scales;

  const saveBtn = opts.onSave
    ? `<button class="save-btn" id="saveBtn">💾 Save</button>` : '';
  const titleHtml = data.title
    ? `<div class="songtitle">${escapeHtml(data.title)}${saveBtn}</div>` : '';

  const keys = titleHtml + `
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
