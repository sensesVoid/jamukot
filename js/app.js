/* Jamukot music player */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const audio = $('#audio');
const state = {
  tracks: [],
  filtered: [],
  index: -1,
  shuffle: false,
  repeat: 0,
  lyrics: [],
  lyricIndex: -1,
  lyricsSynced: false,
  lyricOffset: 0,
  settings: loadSettings(),
};

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('jamukot.settings') || '{}'); } catch { return {}; }
}
function loadOffset(id) {
  try { return parseFloat(localStorage.getItem('jamukot.offset.' + id) || '0'); } catch { return 0; }
}
function saveOffset(id, v) {
  localStorage.setItem('jamukot.offset.' + id, String(v));
}
function saveSettings(s) { localStorage.setItem('jamukot.settings', JSON.stringify(s)); Object.assign(state.settings, s); }

function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/* ---------- Data ---------- */
async function loadTracks() {
  try {
    const res = await fetch('data/tracks.json', { cache: 'no-store' });
    const data = await res.json();
    state.tracks = data.tracks || [];
  } catch (e) {
    console.error('Failed to load tracks', e);
    state.tracks = [];
  }
  state.filtered = [...state.tracks];
  renderPlaylist();
  $('#track-count').textContent = `${state.tracks.length} tracks`;
  updateStorageIndicator();
}

const STORAGE_LIMIT = 9.5 * 1024 * 1024 * 1024;
function updateStorageIndicator() {
  const total = state.tracks.reduce((s, t) => s + (t.size || 0), 0);
  const pct = Math.min(100, (total / STORAGE_LIMIT) * 100);
  const fill = $('#storage-fill'); if (fill) fill.style.width = pct + '%';
  const text = $('#storage-text'); if (text) text.textContent = (total / 1e9).toFixed(2) + ' / 9.5 GB';
  const bar = $('#storage-indicator'); if (bar) bar.title = state.tracks.length + ' tracks';
}

/* ---------- Playlist ---------- */
function renderPlaylist() {
  const list = $('#track-list');
  list.innerHTML = '';
  state.filtered.forEach((t) => {
    const li = document.createElement('li');
    li.dataset.id = t.id;
    if (state.index >= 0 && state.tracks[state.index]?.id === t.id) li.classList.add('active');
    const initials = (t.artist || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    li.innerHTML = `
      <div class="ti">${initials}</div>
      <div class="tm">
        <div class="tt">${escapeHtml(t.title)}</div>
        <div class="ta">${escapeHtml(t.artist)}</div>
      </div>
      <div class="td">#${t.id}<br>${fmtTime(t.duration)}</div>`;
    li.addEventListener('click', () => playById(t.id));
    list.appendChild(li);
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

$('#search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  state.filtered = state.tracks.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(q));
  renderPlaylist();
});

function playById(id) {
  const idx = state.tracks.findIndex(t => t.id === id);
  if (idx >= 0) playIndex(idx);
}

function playIndex(idx) {
  if (idx < 0 || idx >= state.tracks.length) return;
  state.index = idx;
  const t = state.tracks[idx];
  const src = t.url || t.file;
  audio.src = /^https?:\/\//.test(src) ? src : encodeURI(src);
  audio.load();
  audio.play().catch(() => {});
  updateNowPlaying(t);
  updateVinyl(true);
  fetchCover(t);
  fetchLyrics(t);
  renderPlaylist();
}

function updateNowPlaying(t) {
  const npTitle = $('#np-title'); if (npTitle) npTitle.textContent = t.title;
  const npArtist = $('#np-artist'); if (npArtist) npArtist.textContent = t.artist;
  const durTime = $('#dur-time'); if (durTime) durTime.textContent = fmtTime(t.duration);
  const curTime = $('#cur-time'); if (curTime) curTime.textContent = '0:00';
  const pf = $('#progress-fill'); if (pf) pf.style.width = '0%';
  const pt = $('#progress-thumb'); if (pt) pt.style.left = '0%';
}

/* ---------- Vinyl / cover ---------- */
function updateVinyl(playing) {
  const v = $('#vinyl');
  if (v) { if (playing) v.classList.add('spinning'); else v.classList.remove('spinning'); }
  const arm = $('#tonearm');
  if (arm) { if (playing) arm.classList.add('playing'); else arm.classList.remove('playing'); }
}

function initialsOf(t) { return (t.title || '?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

async function fetchCover(t) {
  const img = $('#cover-img');
  const fb = $('#cover-fallback');
  if (!img || !fb) return;
  img.classList.remove('loaded');
  fb.textContent = initialsOf(t);
  const hue = hashStr(t.title + t.artist) % 360;
  const grad = `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue+60)%360},70%,45%))`;
  fb.style.background = grad;
  const label = $('#vinyl-label');
  if (label) label.style.background = grad;
  try {
    const q = encodeURIComponent(`${t.artist} ${t.title}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&limit=1`);
    const data = await res.json();
    if (data.results && data.results[0] && data.results[0].artworkUrl100) {
      const url = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
      img.src = url;
      img.onload = () => img.classList.add('loaded');
    }
  } catch (e) { /* keep fallback */ }
}

function hashStr(s) { let h = 0; for (let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

/* ---------- Lyrics ---------- */
async function fetchLyrics(t) {
  state.lyrics = [];
  state.lyricIndex = -1;
  state.lyricsSynced = false;
  state.lyricOffset = loadOffset(t.id);
  renderLyrics();
  const offEl = $('#lyric-offset');
  if (offEl) offEl.value = state.lyricOffset;
  const offVal = $('#offset-val');
  if (offVal) offVal.textContent = state.lyricOffset.toFixed(1) + 's';
  const statusEl = $('#lyrics-status');
  if (statusEl) statusEl.textContent = 'loading';
  const noteStart = $('#lyrics-note');
  if (noteStart) noteStart.textContent = '';
  try {
    let data = null;
    try {
      const r = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(t.artist)}&track_name=${encodeURIComponent(t.title)}`);
      if (r.ok) data = await r.json();
    } catch {}
    if (!data || !data.syncedLyrics) {
      const r = await fetch(`https://lrclib.net/api/search?artist_name=${encodeURIComponent(t.artist)}&track_name=${encodeURIComponent(t.title)}`);
      if (r.ok) {
        const arr = await r.json();
        const found = (arr || []).find(x => x.syncedLyrics) || (arr || [])[0];
        data = found;
      }
    }
    if (data && data.syncedLyrics) {
      state.lyrics = parseLRC(data.syncedLyrics);
      state.lyricsSynced = true;
      if (statusEl) statusEl.textContent = 'synced';
      const note = $('#lyrics-note');
      if (note) {
        const refDur = data.duration || 0;
        const audioDur = t.duration || 0;
        if (refDur && audioDur && Math.abs(refDur - audioDur) > 5) {
          note.textContent = 'Lyrics timing is for a ' + refDur.toFixed(0) + 's version; your audio is ' + audioDur.toFixed(0) + 's. Use the Sync offset slider to align.';
        } else {
          note.textContent = '';
        }
      }
    } else if (data && data.plainLyrics) {
      state.lyrics = data.plainLyrics.split('\n').map(line => ({ time: 0, text: line }));
      state.lyricsSynced = false;
      if (statusEl) statusEl.textContent = 'plain';
      const note = $('#lyrics-note');
      if (note) note.textContent = 'Plain lyrics (not time-synced).';
    } else {
      if (statusEl) statusEl.textContent = 'none';
      const note = $('#lyrics-note');
      if (note) note.textContent = 'No lyrics found for this track.';
    }
  } catch (e) {
    console.error('lyrics fetch failed', e);
    if (statusEl) statusEl.textContent = 'error';
  }
  renderLyrics();
}

function parseLRC(lrc) {
  const lines = [];
  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)/;
  for (const raw of lrc.split('\n')) {
    const m = raw.match(re);
    if (m) {
      const min = parseInt(m[1],10);
      const sec = parseInt(m[2],10);
      const frac = m[3] ? parseInt(m[3].padEnd(3,'0'),10)/1000 : 0;
      const time = min*60 + sec + frac;
      const text = m[4].trim();
      if (text || lines.length) lines.push({ time, text });
    }
  }
  while (lines.length && !lines[lines.length-1].text) lines.pop();
  return lines;
}

function renderLyrics() {
  const ul = $('#lyrics-list');
  if (!ul) return;
  const lf = $('#lf-lyrics');
  ul.innerHTML = '';
  if (lf) lf.innerHTML = '';
  if (!state.lyrics.length) {
    const empty = $('#lyrics-empty');
    if (empty) empty.style.display = 'block';
    return;
  }
  const empty = $('#lyrics-empty');
  if (empty) empty.style.display = 'none';
  state.lyrics.forEach((l, i) => {
    const li = document.createElement('li');
    li.dataset.i = i;
    li.textContent = l.text || '♪';
    ul.appendChild(li);
  });
}

function syncLyrics(currentTime) {
  if (!state.lyrics.length || !state.lyricsSynced) return;
  let idx = -1;
  for (let i = 0; i < state.lyrics.length; i++) {
    if (state.lyrics[i].time + state.lyricOffset <= currentTime + 0.15) idx = i;
    else break;
  }
  if (idx === state.lyricIndex) return;
  state.lyricIndex = idx;
  $$('#lyrics-list li').forEach((li, i) => {
    li.classList.toggle('active', i === idx);
    li.classList.toggle('past', i < idx);
  });
  const activeLi = $(`#lyrics-list li[data-i="${idx}"]`);
  if (activeLi) activeLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- Audio events ---------- */
audio.addEventListener('timeupdate', () => {
  const cur = audio.currentTime;
  const dur = audio.duration || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  const curTime = $('#cur-time'); if (curTime) curTime.textContent = fmtTime(cur);
  const pf = $('#progress-fill'); if (pf) pf.style.width = pct + '%';
  const pt = $('#progress-thumb'); if (pt) pt.style.left = pct + '%';
  syncLyrics(cur);
});
audio.addEventListener('loadedmetadata', () => {
  if (audio.duration) { const dt = $('#dur-time'); if (dt) dt.textContent = fmtTime(audio.duration); }
});
audio.addEventListener('play', () => updateVinyl(true));
audio.addEventListener('pause', () => {
  updateVinyl(false);
  const v = $('#vinyl');
  if (v) v.style.scale = '1';
});
audio.addEventListener('ended', () => {
  if (state.repeat === 2) { audio.currentTime = 0; audio.play(); return; }
  nextTrack();
});

/* ---------- Audio visualizer (radio frequency wave) ---------- */
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let vizCanvas = $('#visualizer');
let vizCtx = vizCanvas ? vizCanvas.getContext('2d') : null;
let vizRaf = null;

function resizeVisualizer() {
  if (!vizCanvas) return;
  const rect = vizCanvas.getBoundingClientRect();
  vizCanvas.width = Math.max(200, Math.floor(rect.width));
  vizCanvas.height = 80;
}

function initVisualizer() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    resizeVisualizer();
    window.addEventListener('resize', resizeVisualizer);
    drawVisualizer();
  } catch (e) {
    console.error('Visualizer init failed', e);
  }
}

function drawVisualizer() {
  if (!vizCtx || !analyser) return;
  vizRaf = requestAnimationFrame(drawVisualizer);
  const bufLen = analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);
  const w = vizCanvas.width;
  const h = vizCanvas.height;
  vizCtx.clearRect(0, 0, w, h);
  const sampleRate = audioCtx.sampleRate;
  const nyquist = sampleRate / 2;
  // Logarithmic binning so the full spectrum spans the whole canvas
  const barCount = 48;
  const minFreq = 40;
  const maxFreq = nyquist;
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);
  const barWidth = (w / barCount) * 0.78;
  const gap = (w / barCount) * 0.22;
  let bass = 0;
  for (let i = 0; i < barCount; i++) {
    const fLow = Math.exp(logMin + (logMax - logMin) * (i / barCount));
    const fHigh = Math.exp(logMin + (logMax - logMin) * ((i + 1) / barCount));
    const binLow = Math.floor((fLow / nyquist) * bufLen);
    const binHigh = Math.ceil((fHigh / nyquist) * bufLen);
    let sum = 0, n = 0;
    for (let b = Math.max(0, binLow); b < Math.min(bufLen, Math.max(binLow + 1, binHigh)); b++) {
      sum += data[b];
      n++;
    }
    const v = n ? (sum / n) / 255 : 0;
    const barH = Math.max(2, v * h * 0.92);
    const x = i * (barWidth + gap);
    const hue = 260 + (i / barCount) * 120 + v * 40;
    const grad = vizCtx.createLinearGradient(0, h - barH, 0, h);
    grad.addColorStop(0, `hsla(${hue}, 90%, 65%, 0.95)`);
    grad.addColorStop(1, `hsla(${hue}, 90%, 45%, 0.35)`);
    vizCtx.fillStyle = grad;
    vizCtx.fillRect(x, h - barH, barWidth, barH);
    // reflection
    vizCtx.fillStyle = `hsla(${hue}, 90%, 65%, 0.12)`;
    vizCtx.fillRect(x, h, barWidth, barH * 0.25);
    if (i < 3) bass += v;
  }
  bass /= 3;
  const vinyl = $('#vinyl');
  if (vinyl) {
    const scale = 1 + bass * 0.08;
    // use the independent `scale` property so it doesn't override the spin transform
    vinyl.style.scale = scale.toFixed(3);
  }
}

audio.addEventListener('play', () => {
  if (!audioCtx) initVisualizer();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});

/* Progress seek */
const progressBar = $('#progress-bar');
let seeking = false;
if (progressBar) {
  progressBar.addEventListener('mousedown', (e) => { seeking = true; seekTo(e); });
}
window.addEventListener('mousemove', (e) => { if (seeking) seekTo(e); });
window.addEventListener('mouseup', () => { seeking = false; });
function seekTo(e) {
  if (!progressBar) return;
  const rect = progressBar.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  if (audio.duration) audio.currentTime = pct * audio.duration;
}

/* Controls */
const playBtn = $('#btn-play');
if (playBtn) {
  playBtn.addEventListener('click', () => {
    if (state.index < 0 && state.tracks.length) { playIndex(0); return; }
    if (audio.paused) audio.play(); else audio.pause();
  });
  playBtn.textContent = '▶';
}
audio.addEventListener('play', () => { if (playBtn) playBtn.textContent = '⏸'; });
audio.addEventListener('pause', () => { if (playBtn) playBtn.textContent = '▶'; });

const nextBtn = $('#btn-next'); if (nextBtn) nextBtn.addEventListener('click', nextTrack);
const prevBtn = $('#btn-prev'); if (prevBtn) prevBtn.addEventListener('click', prevTrack);

function nextTrack() {
  if (!state.tracks.length) return;
  let next;
  if (state.shuffle) {
    next = Math.floor(Math.random() * state.tracks.length);
  } else {
    next = state.index + 1;
    if (next >= state.tracks.length) {
      if (state.repeat === 1) next = 0; else { updateVinyl(false); return; }
    }
  }
  playIndex(next);
}
function prevTrack() {
  if (!state.tracks.length) return;
  let prev = state.index - 1;
  if (prev < 0) prev = state.tracks.length - 1;
  playIndex(prev);
}

const shuffleBtn = $('#btn-shuffle');
if (shuffleBtn) shuffleBtn.addEventListener('click', (e) => {
  state.shuffle = !state.shuffle;
  e.currentTarget.classList.toggle('active', state.shuffle);
});
const repeatBtn = $('#btn-repeat');
if (repeatBtn) repeatBtn.addEventListener('click', (e) => {
  state.repeat = (state.repeat + 1) % 3;
  e.currentTarget.classList.toggle('active', state.repeat !== 0);
  e.currentTarget.textContent = state.repeat === 2 ? '↻₁' : '↻';
});

const volSlider = $('#volume');
if (volSlider) volSlider.addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });
audio.volume = 0.8;

const offsetSlider = $('#lyric-offset');
if (offsetSlider) {
  offsetSlider.addEventListener('input', (e) => {
    state.lyricOffset = parseFloat(e.target.value);
    const ov = $('#offset-val'); if (ov) ov.textContent = state.lyricOffset.toFixed(1) + 's';
    if (state.index >= 0) saveOffset(state.tracks[state.index].id, state.lyricOffset);
    state.lyricIndex = -1;
    syncLyrics(audio.currentTime);
  });
}

/* ---------- Poll workflow run ---------- */
async function pollLatestRun(s, statusEl) {
  const headers = { 'Authorization': `Bearer ${s.token}`, 'Accept': 'application/vnd.github+json' };
  let run = null;
  for (let attempt = 0; attempt < 10 && !run; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}/actions/workflows/${s.workflow}/runs?per_page=1`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.workflow_runs && data.workflow_runs.length) run = data.workflow_runs[0];
      }
    } catch {}
  }
  if (!run) { statusEl.textContent = 'Dispatched, but could not fetch run status. Check the Actions tab.'; return; }
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}/actions/runs/${run.id}`, { headers });
      if (res.ok) {
        const r = await res.json();
        if (r.status === 'completed') {
          if (r.conclusion === 'success') {
            statusEl.textContent = 'Run succeeded! Refresh the page to see the new track.';
            statusEl.className = 'status ok';
          } else {
            statusEl.textContent = 'Run ' + r.conclusion + '. Open the Actions tab for details.';
            statusEl.className = 'status err';
          }
          return;
        }
        statusEl.textContent = 'Run status: ' + r.status + '…';
      }
    } catch {}
    await new Promise(r => setTimeout(r, 4000));
  }
  statusEl.textContent = 'Still running. Check the Actions tab.';
}

/* ---------- Views ---------- */
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    $$('.view').forEach(v => v.classList.remove('active'));
    const target = $(`#view-${view}`);
    if (target) target.classList.add('active');
  });
});

/* ---------- Settings ---------- */
function applySettingsToUI() {
  const s = state.settings;
  const o = $('#set-owner'); if (o) o.value = s.owner || 'sensesVoid';
  const r = $('#set-repo'); if (r) r.value = s.repo || 'jamukot';
  const w = $('#set-workflow'); if (w) w.value = s.workflow || 'add-track.yml';
  const t = $('#set-token'); if (t) t.value = s.token || '';
  const wk = $('#set-worker'); if (wk) wk.value = s.worker || '';
}
applySettingsToUI();
const saveBtn = $('#set-save');
if (saveBtn) saveBtn.addEventListener('click', () => {
  const s = {
    owner: $('#set-owner').value.trim(),
    repo: $('#set-repo').value.trim(),
    workflow: $('#set-workflow').value.trim(),
    token: $('#set-token').value.trim(),
    worker: $('#set-worker').value.trim(),
  };
  saveSettings(s);
  const ss = $('#set-status'); if (ss) { ss.textContent = 'Saved.'; ss.className = 'status ok'; }
});

/* ---------- Admin gate ---------- */
const ADMIN_PASS = 'iamironman!';
const adminGate = $('#admin-gate');
const adminContent = $('#admin-content');
function unlockAdmin() {
  const val = $('#admin-pass').value;
  const st = $('#admin-gate-status');
  if (val === ADMIN_PASS) {
    if (adminGate) adminGate.style.display = 'none';
    if (adminContent) adminContent.style.display = 'block';
    sessionStorage.setItem('jamukot.admin', '1');
    if (st) st.textContent = '';
  } else {
    if (st) { st.textContent = 'Wrong password.'; st.className = 'status err'; }
  }
}
const unlockBtn = $('#admin-unlock');
if (unlockBtn) unlockBtn.addEventListener('click', unlockAdmin);
const passInput = $('#admin-pass');
if (passInput) passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockAdmin(); });
const lockBtn = $('#admin-lock');
if (lockBtn) lockBtn.addEventListener('click', () => {
  if (adminGate) adminGate.style.display = '';
  if (adminContent) adminContent.style.display = 'none';
  sessionStorage.removeItem('jamukot.admin');
  if (passInput) passInput.value = '';
});
if (sessionStorage.getItem('jamukot.admin') === '1') {
  if (adminGate) adminGate.style.display = 'none';
  if (adminContent) adminContent.style.display = 'block';
}

/* ---------- Add track ---------- */
const addSubmit = $('#add-submit');
if (addSubmit) addSubmit.addEventListener('click', async () => {
  const url = $('#add-url').value.trim();
  const title = $('#add-title').value.trim();
  const artist = $('#add-artist').value.trim();
  const status = $('#add-status');
  if (!url || !title || !artist) {
    if (status) { status.textContent = 'Please fill in all fields.'; status.className = 'status err'; }
    return;
  }
  const s = state.settings;
  const owner = s.owner || 'sensesVoid';
  const repo = s.repo || 'jamukot';
  const wf = s.workflow || 'add-track.yml';

  if (s.worker && /^https:\/\//.test(s.worker)) {
    const btn = addSubmit;
    btn.disabled = true;
    if (status) { status.textContent = 'Dispatching (1 click)...'; status.className = 'status'; }
    try {
      const resp = await fetch(s.worker, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_url: url, title, artist }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        if (status) { status.textContent = 'Dispatched! The run will download, compress, and commit. Refresh this page when it finishes (~1 min).'; status.className = 'status ok'; }
        $('#add-url').value = ''; $('#add-title').value = ''; $('#add-artist').value = '';
        if (s.token) pollLatestRun(s, status);
      } else {
        if (status) { status.textContent = 'Worker error: ' + (data.error || resp.status); status.className = 'status err'; }
      }
    } catch (e) {
      if (status) { status.textContent = 'Network error: ' + e.message; status.className = 'status err'; }
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (s.token) {
    const btn = addSubmit;
    btn.disabled = true;
    if (status) { status.textContent = 'Dispatching...'; status.className = 'status'; }
    try {
      const resp = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/actions/workflows/' + wf + '/dispatches', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + s.token, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main', inputs: { youtube_url: url, title, artist } }),
      });
      if (resp.status === 204) {
        if (status) { status.textContent = 'Dispatched! Polling run status...'; status.className = 'status ok'; }
        $('#add-url').value = ''; $('#add-title').value = ''; $('#add-artist').value = '';
        pollLatestRun(s, status);
      } else {
        const txt = await resp.text();
        if (status) { status.textContent = 'Failed (' + resp.status + '): ' + txt.slice(0,200); status.className = 'status err'; }
      }
    } catch (e) {
      if (status) { status.textContent = 'Network error: ' + e.message; status.className = 'status err'; }
    } finally {
      btn.disabled = false;
    }
    return;
  }

  const payload = 'youtube_url: ' + url + '\ntitle: ' + title + '\nartist: ' + artist;
  let copied = false;
  try { await navigator.clipboard.writeText(payload); copied = true; } catch (e) { copied = false; }
  const actionsUrl = 'https://github.com/' + owner + '/' + repo + '/actions/workflows/' + wf;
  window.open(actionsUrl, '_blank', 'noopener,noreferrer');
  if (status) {
    if (copied) { status.textContent = 'Inputs copied to clipboard. In the new tab: click "Run workflow", paste the three values, then confirm.'; status.className = 'status ok'; }
    else { status.textContent = 'Could not copy automatically. Opened Actions tab. Use these inputs:\n' + payload; status.className = 'status err'; }
  }
});

/* ---------- Sync lyrics view (mirror) ---------- */

/* ---------- Init ---------- */
loadTracks();
if (state.tracks.length === 0) { /* nothing */ }