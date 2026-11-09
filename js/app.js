/* Jamukot music player */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const audio = $('#audio');
const REQUEST_ENDPOINT = 'https://jamukot-dispatch.originragnarok05.workers.dev/request';
const RANTS_LIST_ENDPOINT = 'https://jamukot-dispatch.originragnarok05.workers.dev/rants';
const RANT_POST_ENDPOINT = 'https://jamukot-dispatch.originragnarok05.workers.dev/rant';
const RANT_PIN_ENDPOINT = 'https://jamukot-dispatch.originragnarok05.workers.dev/rant/pin';
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
  wallRants: [],
  wallOffset: 0,
  wallTotal: 0,
  wallLoading: false,
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
  // Alphabetical by title (case-insensitive), tie-break by artist
  state.tracks.sort((a, b) => {
    const byTitle = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
    if (byTitle !== 0) return byTitle;
    return (a.artist || '').localeCompare(b.artist || '', undefined, { sensitivity: 'base' });
  });
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
  if (!audioCtx) initVisualizer();
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch((e) => {
      console.warn('playback failed:', e && e.message);
      // Retry once when the media becomes ready (common on mobile)
      const retry = () => { audio.play().catch(() => {}); audio.removeEventListener('canplay', retry); };
      audio.addEventListener('canplay', retry, { once: true });
      setTimeout(() => audio.removeEventListener('canplay', retry), 8000);
    });
  }
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
const tonearmEl = $('#tonearm');
function updateVinyl(playing) {
  const v = vinylEl;
  if (v) { if (playing) v.classList.add('spinning'); else v.classList.remove('spinning'); }
  const arm = tonearmEl;
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
async function fetchWithTimeout(url, ms = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
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
      const r = await fetchWithTimeout(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(t.artist)}&track_name=${encodeURIComponent(t.title)}`, 7000);
      if (r.ok) data = await r.json().catch(() => null);
    } catch {}
    if (!data || !data.syncedLyrics) {
      const r = await fetchWithTimeout(`https://lrclib.net/api/search?artist_name=${encodeURIComponent(t.artist)}&track_name=${encodeURIComponent(t.title)}`, 7000);
      if (r.ok) {
        const arr = await r.json().catch(() => []);
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
const curTimeEl = $('#cur-time');
const progressFillEl = $('#progress-fill');
const progressThumbEl = $('#progress-thumb');
audio.addEventListener('timeupdate', () => {
  const cur = audio.currentTime;
  const dur = audio.duration || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  if (curTimeEl) curTimeEl.textContent = fmtTime(cur);
  if (progressFillEl) progressFillEl.style.width = pct + '%';
  if (progressThumbEl) progressThumbEl.style.left = pct + '%';
  syncLyrics(cur);
});
const durTimeEl = $('#dur-time');
audio.addEventListener('loadedmetadata', () => {
  if (audio.duration && durTimeEl) durTimeEl.textContent = fmtTime(audio.duration);
});
audio.addEventListener('play', () => updateVinyl(true));
audio.addEventListener('pause', () => {
  updateVinyl(false);
  stopVisualizer();
  const v = vinylEl;
  if (v) v.style.scale = '1';
});
audio.addEventListener('error', () => {
  const err = audio.error;
  console.error('Audio error:', err && err.code, err && err.message);
  const np = $('#np-title');
  if (np && err) np.textContent = 'Playback error (' + err.code + ')';
});
audio.addEventListener('stalled', () => { console.warn('Audio stalled (buffering)'); });
audio.addEventListener('waiting', () => { console.warn('Audio waiting for data'); });
audio.addEventListener('ended', () => {
  if (state.repeat === 2) { audio.currentTime = 0; if (!audioCtx) initVisualizer(); audio.play(); return; }
  nextTrack();
});

/* ---------- Audio visualizer (radio frequency wave) ---------- */
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let vizCanvas = $('#visualizer');
let vizCtx = vizCanvas ? vizCanvas.getContext('2d') : null;
let vizRaf = null;
let vinylEl = $('#vinyl');

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
  } catch (e) {
    console.error('Visualizer init failed', e);
    // Reset so audio falls back to direct playback; never block music
    try { if (sourceNode) sourceNode.disconnect(); } catch {}
    try { if (analyser) analyser.disconnect(); } catch {}
    audioCtx = null; analyser = null; sourceNode = null;
  }
}

function drawVisualizer() {
  if (!vizCtx || !analyser) return;
  if (audio.paused) { vizRaf = null; return; }
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
  const vinyl = vinylEl;
  if (vinyl) {
    const scale = 1 + bass * 0.08;
    // use the independent `scale` property so it doesn't override the spin transform
    vinyl.style.scale = scale.toFixed(3);
  }
}

function startVisualizer() {
  if (vizRaf || !vizCtx || !analyser || audio.paused) return;
  vizRaf = requestAnimationFrame(drawVisualizer);
}
function stopVisualizer() {
  if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = null; }
}
audio.addEventListener('play', () => {
  updateVinyl(true);
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  startVisualizer();
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
    if (audio.paused) { if (!audioCtx) initVisualizer(); audio.play(); } else audio.pause();
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

/* ---------- Song request ---------- */
function initRequestForm() {
  const btn = $('#request-song-btn');
  const modal = $('#request-modal');
  const form = $('#request-form');
  const status = $('#request-status');
  const cancel = $('#request-cancel');
  if (!btn || !modal || !form) return;

  let lastFocus = null;

  function setStatus(text, cls) {
    if (!status) return;
    status.textContent = text;
    status.className = 'request-status' + (cls ? ' ' + cls : '');
  }

  function open() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setStatus('');
    const url = $('#request-url');
    if (url) setTimeout(() => url.focus(), 0);
  }

  function close() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  btn.addEventListener('click', open);
  if (cancel) cancel.addEventListener('click', close);

  // One-time helper bubble pointing at the request button
  const hint = $('#request-hint');
  const HINT_KEY = 'jamukot.requestHintDismissed';
  function dismissHint() {
    if (!hint || hint.hidden) return;
    hint.classList.add('dismissed');
    setTimeout(() => { hint.hidden = true; }, 260);
    try { localStorage.setItem(HINT_KEY, '1'); } catch {}
  }
  if (hint) {
    try {
      if (!localStorage.getItem(HINT_KEY)) {
        hint.hidden = false;
        hint.addEventListener('click', (e) => { e.preventDefault(); dismissHint(); open(); });
        btn.addEventListener('click', dismissHint, { once: true });
        setTimeout(dismissHint, 8000);
      }
    } catch {
      hint.hidden = true;
    }
  }
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const youtubeUrl = ($('#request-url')?.value || '').trim();
    const title = ($('#request-title')?.value || '').trim();
    const artist = ($('#request-artist')?.value || '').trim();
    const website = $('#request-website')?.value || '';
    const submit = $('#request-submit');

    if (!youtubeUrl || !title || !artist) {
      setStatus('Please fill in the YouTube URL, title, and artist.', 'err');
      return;
    }
    if (!/^https?:\/\//i.test(youtubeUrl)) {
      setStatus('Enter a full YouTube URL starting with https://', 'err');
      return;
    }

    if (submit) submit.disabled = true;
    setStatus('Sending…');
    try {
      const resp = await fetch(REQUEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_url: youtubeUrl, title, artist, website }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        form.reset();
        setStatus('Request sent! The owner will review it.', 'ok');
      } else {
        setStatus(data.error || `Request failed (${resp.status})`, 'err');
      }
    } catch (err) {
      setStatus('Network error: ' + err.message, 'err');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

/* ---------- Rant wall ---------- */
function fmtTimeAgo(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return new Date(t).toLocaleDateString();
}

function updateWallCount() {
  const el = $('#wall-count');
  if (el) el.textContent = state.wallTotal + ' rants';
}

let wallAdminToken = '';
try { wallAdminToken = sessionStorage.getItem('jamukot.wallAdminToken') || ''; } catch {}

function isWallAdmin() { return !!wallAdminToken; }

function renderWallList() {
  const list = $('#wall-list');
  if (!list) return;
  if (state.wallRants.length === 0) {
    list.innerHTML = '<div class="wall-empty">No rants yet. Be the first to post one.</div>';
    return;
  }
  list.innerHTML = state.wallRants.map((r) => `
    <div class="rant-card ${r.pinned ? 'pinned' : ''}">
      <div class="rant-card-head">
        <div class="rant-alias">${escapeHtml(r.alias)}</div>
        <div class="rant-card-actions">
          ${r.pinned ? '<span class="wall-pinned-badge" title="Pinned">📌</span>' : ''}
          ${isWallAdmin() ? `<button class="wall-pin" type="button" data-id="${escapeHtml(r.id)}" data-pinned="${r.pinned ? '1' : '0'}" title="Pin">${r.pinned ? '📌' : '📍'}</button>` : ''}
        </div>
      </div>
      <div class="rant-msg">${escapeHtml(r.message)}</div>
      <div class="rant-time">${escapeHtml(fmtTimeAgo(r.created_at))}</div>
    </div>
  `).join('');
}

async function loadWallRants(reset) {
  if (state.wallLoading) return;
  if (reset) { state.wallRants = []; state.wallOffset = 0; state.wallTotal = 0; }
  state.wallLoading = true;
  const more = $('#btn-wall-more');
  if (more) more.disabled = true;
  try {
    const res = await fetch(`${RANTS_LIST_ENDPOINT}?limit=20&offset=${state.wallOffset}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const items = Array.isArray(data.rants) ? data.rants : [];
    state.wallRants = state.wallRants.concat(items);
    state.wallOffset = state.wallRants.length;
    state.wallTotal = typeof data.total === 'number' ? data.total : state.wallRants.length;
    renderWallList();
    updateWallCount();
    if (more) more.hidden = state.wallOffset >= state.wallTotal;
  } catch (e) {
    const list = $('#wall-list');
    if (list && state.wallRants.length === 0) {
      list.innerHTML = `<div class="wall-empty">Could not load rants: ${escapeHtml(e.message)}</div>`;
    }
  } finally {
    state.wallLoading = false;
    if (more) more.disabled = false;
  }
}

function initWall() {
  const more = $('#btn-wall-more');
  if (more) more.addEventListener('click', () => loadWallRants(false));

  const list = $('#wall-list');
  if (list) {
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('.wall-pin');
      if (!btn || !wallAdminToken) return;
      const id = btn.dataset.id;
      const currentlyPinned = btn.dataset.pinned === '1';
      btn.disabled = true;
      try {
        const resp = await fetch(RANT_PIN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, pinned: !currentlyPinned, secret: wallAdminToken }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.ok) {
          const r = state.wallRants.find((x) => x.id === id);
          if (r) r.pinned = !currentlyPinned;
          state.wallRants.sort((a, b) => {
            const pa = a.pinned ? 1 : 0;
            const pb = b.pinned ? 1 : 0;
            if (pb !== pa) return pb - pa;
            const ta = a.created_at || '';
            const tb = b.created_at || '';
            return ta > tb ? -1 : ta < tb ? 1 : 0;
          });
          renderWallList();
        } else {
          if (resp.status === 401) {
            wallAdminToken = '';
            try { sessionStorage.removeItem('jamukot.wallAdminToken'); } catch {}
            renderWallList();
            alert('Invalid admin token.');
          } else {
            alert(data.error || `Pin failed (${resp.status})`);
          }
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Triple-click the wall title to enter admin (pin) mode
  const title = document.querySelector('#wall-panel .panel-head h2');
  let clicks = 0, timer = null;
  if (title) {
    title.style.cursor = 'pointer';
    title.addEventListener('click', () => {
      clicks += 1;
      clearTimeout(timer);
      timer = setTimeout(() => { clicks = 0; }, 1500);
      if (clicks >= 3) {
        clicks = 0;
        const tok = prompt('Admin token:');
        if (tok) {
          wallAdminToken = tok;
          try { sessionStorage.setItem('jamukot.wallAdminToken', tok); } catch {}
          renderWallList();
        }
      }
    });
  }

  loadWallRants(true);
}

function initRantForm() {
  const btn = $('#btn-rant');
  const modal = $('#rant-modal');
  const form = $('#rant-form');
  const status = $('#rant-status');
  const cancel = $('#rant-cancel');
  const alias = $('#rant-alias');
  const msg = $('#rant-message');
  const counter = $('#rant-counter');
  const submit = $('#rant-submit');
  if (!btn || !modal || !form) return;

  function setStatus(text, cls) {
    if (!status) return;
    status.textContent = text;
    status.className = 'request-status' + (cls ? ' ' + cls : '');
  }
  function open() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setStatus('');
    if (alias) setTimeout(() => alias.focus(), 0);
  }
  function close() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }
  btn.addEventListener('click', open);
  if (cancel) cancel.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });

  if (msg && counter) {
    const update = () => { counter.textContent = `${msg.value.length} / 200`; };
    msg.addEventListener('input', update);
    update();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = (alias?.value || '').trim();
    const m = (msg?.value || '').trim();
    const website = $('#rant-website')?.value || '';
    if (!a || !m) { setStatus('Alias and message are required.', 'err'); return; }
    if (m.length > 200) { setStatus('Message must be 200 characters or fewer.', 'err'); return; }
    if (submit) submit.disabled = true;
    setStatus('Posting…');
    try {
      const resp = await fetch(RANT_POST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: a, message: m, website }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        form.reset();
        if (counter) counter.textContent = '0 / 200';
        setStatus('Posted!', 'ok');
        if (data.rant) {
          state.wallRants.unshift(data.rant);
          state.wallOffset = state.wallRants.length;
          state.wallTotal = Math.max(state.wallTotal + 1, state.wallRants.length);
          renderWallList();
          updateWallCount();
        } else {
          loadWallRants(true);
        }
        setTimeout(close, 900);
      } else {
        setStatus(data.error || `Failed (${resp.status})`, 'err');
      }
    } catch (err) {
      setStatus('Network error: ' + err.message, 'err');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

/* ---------- Sync lyrics view (mirror) ---------- */

/* ---------- Init ---------- */
loadTracks();
initRequestForm();
initWall();
initRantForm();
if (state.tracks.length === 0) { /* nothing */ }