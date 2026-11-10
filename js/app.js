/* Jamukot music player */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const audio = $('#audio'); // kept for backward compat, not used for playback
const REQUEST_ENDPOINT = 'https://jamukot-dispatch.originragnarok05.workers.dev/request';
// Web Audio + Opus decoder state
let audioCtx = null;
let gainNode = null;
let analyser = null;
let opusDecoder = null;
let currentSource = null;
let currentBuffer = null;
let isPlaying = false;
let playbackOffset = 0;
let playbackStartCtx = 0;
const bufferCache = new Map();
let progressTimer = null;
let progressRaf = null;
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
  lyricsCache: null,
  coverCache: new Map(),
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

/* ---------- Audio (Web Audio + Opus) ---------- */
async function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = parseFloat($('#volume')?.value || '0.8');
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.8;
  analyser.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  // init opus decoder lazily (only needed for .opus files)
  // (decoder will be created on first .opus load)
  // wire up volume slider
  const vol = $('#volume');
  if (vol) vol.addEventListener('input', (e) => { if (gainNode) gainNode.gain.value = parseFloat(e.target.value); });
}

async function loadTrack(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  // simple cache eviction: keep at most 50 decoded tracks in memory
  if (bufferCache.size >= 50) {
    const oldest = bufferCache.keys().next().value;
    bufferCache.delete(oldest);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const arrayBuffer = await res.arrayBuffer();
  let buffer;
  if (url.toLowerCase().endsWith('.opus')) {
    // Try native decodeAudioData first (Chrome/Firefox/Edge support Ogg Opus natively)
    let nativeFailed = false;
    try {
      buffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      console.log('Native decodeAudioData succeeded:', buffer.numberOfChannels, 'ch,', buffer.length, 'samples,', buffer.sampleRate, 'Hz');
    } catch (nativeErr) {
      nativeFailed = true;
      console.warn('Native decodeAudioData failed, trying WASM decoder:', nativeErr && nativeErr.message);
    }
    if (nativeFailed) {
      // Create a fresh decoder for each file
      const lib = window['ogg-opus-decoder'];
      if (!lib || !lib.OggOpusDecoder) throw new Error('Opus decoder library not loaded');
      opusDecoder = new lib.OggOpusDecoder();
      await opusDecoder.ready;
      console.log('Decoder ready. V defined:', !!opusDecoder.V);
      console.log('Fetched .opus:', arrayBuffer.byteLength, 'bytes');
      const head = new Uint8Array(arrayBuffer.slice(0, 4));
      console.log('Magic bytes:', Array.from(head).map(b => b.toString(16).padStart(2,'0')).join(' '), String.fromCharCode(...head));
      console.log('WebAssembly available:', typeof WebAssembly !== 'undefined');
      console.log('AudioContext state:', audioCtx.state, 'sampleRate:', audioCtx.sampleRate);
      await opusDecoder.reset();
      let result;
      try {
        result = await opusDecoder.decodeFile(new Uint8Array(arrayBuffer));
        console.log('decodeFile result:', 'ch=' + (result.channelData ? result.channelData.length : 'null'), 'samples=' + result.samplesDecoded, 'sr=' + result.sampleRate, 'errs=' + (result.errors ? result.errors.length : 0));
      } catch (e) {
        console.warn('decodeFile threw:', e && e.message);
        result = null;
      }
      if (!result || !result.channelData || result.channelData.length === 0 || !result.samplesDecoded) {
        console.log('Trying streaming decode...');
        try {
          const r1 = await opusDecoder.decode(new Uint8Array(arrayBuffer));
          console.log('decode result:', 'ch=' + (r1.channelData ? r1.channelData.length : 'null'), 'samples=' + r1.samplesDecoded, 'sr=' + r1.sampleRate, 'errs=' + (r1.errors ? r1.errors.length : 0));
          const r2 = await opusDecoder.flush();
          console.log('flush result:', 'ch=' + (r2.channelData ? r2.channelData.length : 'null'), 'samples=' + r2.samplesDecoded, 'sr=' + r2.sampleRate, 'errs=' + (r2.errors ? r2.errors.length : 0));
          if (r1.channelData && r1.channelData.length > 0 && r1.samplesDecoded) result = r1;
          else if (r2.channelData && r2.channelData.length > 0 && r2.samplesDecoded) result = r2;
        } catch (e) {
          console.warn('Streaming decode threw:', e && e.message);
        }
      }
      if (result && result.errors && result.errors.length) console.log('Decode errors:', JSON.stringify(result.errors.slice(0, 3)));
      const channelData = result ? result.channelData : null;
      const samplesDecoded = result ? result.samplesDecoded : 0;
      const sampleRate = (result && result.sampleRate) || 48000;
      if (!channelData || channelData.length === 0 || !samplesDecoded) {
        const libOk = !!(window['ogg-opus-decoder'] && window['ogg-opus-decoder'].OggOpusDecoder);
        throw new Error('Opus no audio (' + (channelData ? channelData.length : 0) + 'ch,' + samplesDecoded + 'smp,sr' + sampleRate + ') fetched=' + arrayBuffer.byteLength + 'B magic=' + Array.from(new Uint8Array(arrayBuffer.slice(0,4))).map(b=>b.toString(16).padStart(2,'0')).join('') + ' wasmLib=' + libOk);
      }
      buffer = audioCtx.createBuffer(channelData.length, samplesDecoded, sampleRate);
      for (let ch = 0; ch < channelData.length; ch++) {
        buffer.copyToChannel(channelData[ch], ch);
      }
    }
  } else {
    // Native decode (MP3, etc.) via Web Audio
    buffer = await audioCtx.decodeAudioData(arrayBuffer);
  }
  bufferCache.set(url, buffer);
  return buffer;
}

function stopSource() {
  if (currentSource) {
    try { currentSource.onended = null; currentSource.stop(); } catch {}
    try { currentSource.disconnect(); } catch {}
    currentSource = null;
  }
}

function playBuffer(buffer, offset = 0) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  stopSource();
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(analyser);
  source.onended = () => { if (isPlaying) nextTrack(); };
  const safeOffset = Math.min(Math.max(0, offset), Math.max(0, buffer.duration - 0.05));
  source.start(0, safeOffset);
  currentSource = source;
  currentBuffer = buffer;
  playbackOffset = safeOffset;
  playbackStartCtx = audioCtx.currentTime;
  isPlaying = true;
  startProgressLoop();
  startVisualizer();
  const playBtn = $('#btn-play'); if (playBtn) playBtn.textContent = '⏸';
}

function pausePlayback() {
  if (!isPlaying) return;
  const elapsed = audioCtx.currentTime - playbackStartCtx;
  playbackOffset += elapsed;
  stopSource();
  isPlaying = false;
  stopProgressLoop();
  stopVisualizer();
  const v = vinylEl; if (v) v.style.scale = '1';
  const playBtn = $('#btn-play'); if (playBtn) playBtn.textContent = '▶';
  updateVinyl(false);
}

function seekTo(time) {
  if (!currentBuffer) return;
  const wasPlaying = isPlaying;
  if (wasPlaying) {
    stopSource();
    playBuffer(currentBuffer, time);
  } else {
    playbackOffset = Math.min(Math.max(0, time), currentBuffer.duration);
  }
}

function getCurrentTime() {
  if (!isPlaying) return playbackOffset;
  return Math.min(playbackOffset + (audioCtx.currentTime - playbackStartCtx), currentBuffer ? currentBuffer.duration : 0);
}

function startProgressLoop() {
  stopProgressLoop();
  function tick() {
    if (!isPlaying) { progressRaf = null; return; }
    const cur = getCurrentTime();
    const dur = currentBuffer ? currentBuffer.duration : 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    if (curTimeEl) curTimeEl.textContent = fmtTime(cur);
    if (progressFillEl) progressFillEl.style.width = pct + '%';
    if (progressThumbEl) progressThumbEl.style.left = pct + '%';
    syncLyrics(cur);
    progressRaf = requestAnimationFrame(tick);
  }
  progressRaf = requestAnimationFrame(tick);
}

function stopProgressLoop() {
  if (progressRaf) { cancelAnimationFrame(progressRaf); progressRaf = null; }
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

const STORAGE_LIMIT = 780 * 1024 * 1024;
function updateStorageIndicator() {
  const total = state.tracks.reduce((s, t) => s + (t.size || 0), 0);
  const pct = Math.min(100, (total / STORAGE_LIMIT) * 100);
  const fill = $('#storage-fill'); if (fill) fill.style.width = pct + '%';
  const text = $('#storage-text'); if (text) text.textContent = (total / 1e6).toFixed(0) + ' / 780 MB';
  const bar = $('#storage-indicator'); if (bar) bar.title = state.tracks.length + ' tracks';
}

/* ---------- Playlist ---------- */
function renderPlaylist() {
  const list = $('#track-list');
  if (!list) return;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
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
    frag.appendChild(li);
  });
  list.appendChild(frag);
}

// Event delegation for playlist clicks (single listener instead of N)
const trackListEl = $('#track-list');
if (trackListEl) {
  trackListEl.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = parseInt(li.dataset.id, 10);
    if (!isNaN(id)) playById(id);
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

async function playIndex(idx) {
  if (idx < 0 || idx >= state.tracks.length) return;
  state.index = idx;
  const t = state.tracks[idx];
  const src = t.url || t.file;
  await initAudio();
  initVisualizer();
  updateNowPlaying(t);
  updateVinyl(true);
  fetchCover(t);
  fetchLyrics(t);
  renderPlaylist();
  try {
    const buffer = await loadTrack(src);
    currentBuffer = buffer;
    playBuffer(buffer, 0);
    const durTime = $('#dur-time'); if (durTime) durTime.textContent = fmtTime(buffer.duration);
  } catch (e) {
    console.error('Failed to load track:', e && e.message, src);
    const np = $('#np-title'); if (np) np.textContent = 'Playback error: ' + (e && e.message ? e.message : 'unknown');
    updateVinyl(false);
    // auto-skip to next track after 2s
    setTimeout(() => { if (state.index === idx) nextTrack(); }, 2000);
  }
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
  // cache check
  const cacheKey = t.title + '|' + t.artist;
  if (state.coverCache.has(cacheKey)) {
    const url = state.coverCache.get(cacheKey);
    if (url) { img.src = url; img.onload = () => img.classList.add('loaded'); }
    return;
  }
  try {
    const q = encodeURIComponent(`${t.artist} ${t.title}`);
    const res = await fetchWithTimeout(`https://itunes.apple.com/search?term=${q}&media=music&limit=1`, 6000);
    const data = await res.json().catch(() => ({}));
    if (data.results && data.results[0] && data.results[0].artworkUrl100) {
      const url = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
      state.coverCache.set(cacheKey, url);
      img.src = url;
      img.onload = () => img.classList.add('loaded');
    } else {
      state.coverCache.set(cacheKey, null);
    }
  } catch (e) { state.coverCache.set(cacheKey, null); /* keep fallback */ }
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
    // 1) Try pre-fetched lyrics stored in the repo (works offline / in strict envs)
    if (!state.lyricsCache) {
      try {
        const lr = await fetch('data/lyrics.json', { cache: 'no-store' });
        if (lr.ok) state.lyricsCache = await lr.json();
      } catch {}
      if (!state.lyricsCache) state.lyricsCache = {};
    }
    const cached = state.lyricsCache[String(t.id)];
    if (cached && (cached.synced || cached.plain)) {
      data = { syncedLyrics: cached.synced, plainLyrics: cached.plain, duration: cached.duration };
    }
    // 2) Fall back to LRCLIB (may be blocked in strict envs)
    if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
      try {
        const r = await fetchWithTimeout(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(t.artist)}&track_name=${encodeURIComponent(t.title)}`, 7000);
        if (r.ok) data = await r.json().catch(() => null);
      } catch {}
    }
    if (!data || !data.syncedLyrics) {
      try {
        const r = await fetchWithTimeout(`https://lrclib.net/api/search?artist_name=${encodeURIComponent(t.artist)}&track_name=${encodeURIComponent(t.title)}`, 7000);
        if (r.ok) {
          const arr = await r.json().catch(() => []);
          const found = (arr || []).find(x => x.syncedLyrics) || (arr || [])[0];
          data = found;
        }
      } catch {}
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
// 'ended' is now handled by AudioBufferSourceNode.onended in playBuffer

/* ---------- Audio visualizer (radio frequency wave) ---------- */
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
  if (!vizCanvas) return;
  resizeVisualizer();
  window.addEventListener('resize', resizeVisualizer);
}

function drawVisualizer() {
  if (!vizCtx || !analyser) return;
  if (!isPlaying) { vizRaf = null; return; }
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
  if (vizRaf || !vizCtx || !analyser || !isPlaying) return;
  vizRaf = requestAnimationFrame(drawVisualizer);
}
function stopVisualizer() {
  if (vizRaf) { cancelAnimationFrame(vizRaf); vizRaf = null; }
}
// audio element no longer used for playback (Web Audio + Opus)

/* Progress seek */
const progressBar = $('#progress-bar');
let seeking = false;
function seekFromEvent(e) {
  if (!progressBar) return;
  const rect = progressBar.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const dur = currentBuffer ? currentBuffer.duration : 0;
  if (dur) seekTo(pct * dur);
}
if (progressBar) {
  progressBar.addEventListener('mousedown', (e) => { seeking = true; seekFromEvent(e); });
  progressBar.addEventListener('touchstart', (e) => { seeking = true; seekFromEvent(e.touches[0]); }, { passive: true });
}
window.addEventListener('mousemove', (e) => { if (seeking) seekFromEvent(e); });
window.addEventListener('touchmove', (e) => { if (seeking) seekFromEvent(e.touches[0]); }, { passive: true });
window.addEventListener('mouseup', () => { seeking = false; });
window.addEventListener('touchend', () => { seeking = false; });

/* Controls */
const playBtn = $('#btn-play');
if (playBtn) {
  playBtn.addEventListener('click', async () => {
    if (state.index < 0 && state.tracks.length) { playIndex(0); return; }
    if (isPlaying) pausePlayback();
    else if (currentBuffer) { await initAudio(); playBuffer(currentBuffer, playbackOffset); }
    else if (state.tracks.length) { playIndex(state.index >= 0 ? state.index : 0); }
  });
  playBtn.textContent = '▶';
}

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

// Volume (works before audio context exists)
const volumeSlider = $('#volume');
if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (gainNode) gainNode.gain.value = v;
  });
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
if (volSlider) volSlider.addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (gainNode) gainNode.gain.value = v; });

const offsetSlider = $('#lyric-offset');
if (offsetSlider) {
  offsetSlider.addEventListener('input', (e) => {
    state.lyricOffset = parseFloat(e.target.value);
    const ov = $('#offset-val'); if (ov) ov.textContent = state.lyricOffset.toFixed(1) + 's';
    if (state.index >= 0) saveOffset(state.tracks[state.index].id, state.lyricOffset);
    state.lyricIndex = -1;
    syncLyrics(getCurrentTime());
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

/* ---------- Keyboard shortcuts ---------- */
document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.code === 'Space') { e.preventDefault(); if (playBtn) playBtn.click(); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); nextTrack(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); prevTrack(); }
  else if (e.code === 'ArrowUp') { e.preventDefault(); if (volumeSlider) { volumeSlider.value = Math.min(1, parseFloat(volumeSlider.value) + 0.05); volumeSlider.dispatchEvent(new Event('input')); } }
  else if (e.code === 'ArrowDown') { e.preventDefault(); if (volumeSlider) { volumeSlider.value = Math.max(0, parseFloat(volumeSlider.value) - 0.05); volumeSlider.dispatchEvent(new Event('input')); } }
});

/* ---------- Sync lyrics view (mirror) ---------- */

/* ---------- Init ---------- */
loadTracks();
initRequestForm();
initWall();
initRantForm();
if (state.tracks.length === 0) { /* nothing */ }