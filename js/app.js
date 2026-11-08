/* Jamukot music player */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const audio = $('#audio');
const state = {
  tracks: [],
  filtered: [],
  index: -1,
  shuffle: false,
  repeat: 0, // 0 none, 1 all, 2 one
  lyrics: [], // {time, text}
  lyricIndex: -1,
  lyricsSynced: false,
  settings: loadSettings(),
};

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('jamukot.settings') || '{}'); } catch { return {}; }
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
      <div class="td">${fmtTime(t.duration)}</div>`;
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
  audio.src = encodeURI(t.file);
  audio.load();
  audio.play().catch(() => {});
  updateNowPlaying(t);
  updateVinyl(true);
  fetchCover(t);
  fetchLyrics(t);
  renderPlaylist();
}

function updateNowPlaying(t) {
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = t.artist;
  $('#lf-title').textContent = t.title;
  $('#lf-artist').textContent = t.artist;
  $('#dur-time').textContent = fmtTime(t.duration);
  $('#cur-time').textContent = '0:00';
  $('#progress-fill').style.width = '0%';
  $('#progress-thumb').style.left = '0%';
}

/* ---------- Vinyl / cover ---------- */
function updateVinyl(playing) {
  const v = $('#vinyl');
  const v2 = $('#vinyl2');
  if (playing) { v.classList.add('spinning'); v2.classList.add('spinning'); }
  else { v.classList.remove('spinning'); v2.classList.remove('spinning'); }
  const arm = $('#tonearm');
  if (playing) arm.classList.add('playing'); else arm.classList.remove('playing');
}

function initialsOf(t) { return (t.title || '?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

async function fetchCover(t) {
  const img = $('#cover-img');
  const img2 = $('#cover-img2');
  const fb = $('#cover-fallback');
  const fb2 = $('#cover-fallback2');
  // reset
  img.classList.remove('loaded'); img2.classList.remove('loaded');
  fb.textContent = initialsOf(t);
  fb2.textContent = initialsOf(t);
  // gradient fallback color based on title
  const hue = hashStr(t.title + t.artist) % 360;
  const grad = `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue+60)%360},70%,45%))`;
  fb.style.background = grad; fb2.style.background = grad;
  $('#vinyl-label').style.background = grad;
  // try iTunes
  try {
    const q = encodeURIComponent(`${t.artist} ${t.title}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&limit=1`);
    const data = await res.json();
    if (data.results && data.results[0] && data.results[0].artworkUrl100) {
      const url = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
      img.src = url; img2.src = url;
      img.onload = () => img.classList.add('loaded');
      img2.onload = () => img2.classList.add('loaded');
    }
  } catch (e) { /* keep fallback */ }
}

function hashStr(s) { let h = 0; for (let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

/* ---------- Lyrics ---------- */
async function fetchLyrics(t) {
  state.lyrics = [];
  state.lyricIndex = -1;
  state.lyricsSynced = false;
  renderLyrics();
  $('#lyrics-status').textContent = 'loading';
  try {
    // try exact get
    let data = null;
    try {
      const r = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(t.artist)}&track_name=${encodeURIComponent(t.title)}`);
      if (r.ok) data = await r.json();
    } catch {}
    if (!data || !data.syncedLyrics) {
      // search
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
      $('#lyrics-status').textContent = 'synced';
    } else if (data && data.plainLyrics) {
      state.lyrics = data.plainLyrics.split('\n').map(line => ({ time: 0, text: line }));
      state.lyricsSynced = false;
      $('#lyrics-status').textContent = 'plain';
    } else {
      $('#lyrics-status').textContent = 'none';
    }
  } catch (e) {
    console.error('lyrics fetch failed', e);
    $('#lyrics-status').textContent = 'error';
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
  // remove trailing empties
  while (lines.length && !lines[lines.length-1].text) lines.pop();
  return lines;
}

function renderLyrics() {
  const ul = $('#lyrics-list');
  const lf = $('#lf-lyrics');
  ul.innerHTML = '';
  lf.innerHTML = '';
  if (!state.lyrics.length) {
    $('#lyrics-empty').style.display = 'block';
    return;
  }
  $('#lyrics-empty').style.display = 'none';
  state.lyrics.forEach((l, i) => {
    const li = document.createElement('li');
    li.dataset.i = i;
    li.textContent = l.text || '♪';
    ul.appendChild(li);

    const div = document.createElement('div');
    div.className = 'line';
    div.dataset.i = i;
    div.textContent = l.text || '♪';
    lf.appendChild(div);
  });
}

function syncLyrics(currentTime) {
  if (!state.lyrics.length || !state.lyricsSynced) return;
  // find index
  let idx = -1;
  for (let i = 0; i < state.lyrics.length; i++) {
    if (state.lyrics[i].time <= currentTime + 0.15) idx = i;
    else break;
  }
  if (idx === state.lyricIndex) return;
  state.lyricIndex = idx;
  // update classes
  $$('#lyrics-list li').forEach((li, i) => {
    li.classList.toggle('active', i === idx);
    li.classList.toggle('past', i < idx);
  });
  $$('#lf-lyrics .line').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('past', i < idx);
  });
  // scroll
  const activeLi = $(`#lyrics-list li[data-i="${idx}"]`);
  if (activeLi) activeLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const activeLine = $(`#lf-lyrics .line[data-i="${idx}"]`);
  if (activeLine) activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- Audio events ---------- */
audio.addEventListener('timeupdate', () => {
  const cur = audio.currentTime;
  const dur = audio.duration || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  $('#cur-time').textContent = fmtTime(cur);
  $('#progress-fill').style.width = pct + '%';
  $('#progress-thumb').style.left = pct + '%';
  syncLyrics(cur);
});
audio.addEventListener('loadedmetadata', () => {
  if (audio.duration) $('#dur-time').textContent = fmtTime(audio.duration);
});
audio.addEventListener('play', () => updateVinyl(true));
audio.addEventListener('pause', () => updateVinyl(false));
audio.addEventListener('ended', () => {
  if (state.repeat === 2) { audio.currentTime = 0; audio.play(); return; }
  nextTrack();
});

/* Progress seek */
const progressBar = $('#progress-bar');
let seeking = false;
progressBar.addEventListener('mousedown', (e) => { seeking = true; seekTo(e); });
window.addEventListener('mousemove', (e) => { if (seeking) seekTo(e); });
window.addEventListener('mouseup', () => { seeking = false; });
function seekTo(e) {
  const rect = progressBar.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  if (audio.duration) audio.currentTime = pct * audio.duration;
}

/* Controls */
$('#btn-play').addEventListener('click', () => {
  if (state.index < 0 && state.tracks.length) { playIndex(0); return; }
  if (audio.paused) audio.play(); else audio.pause();
});
$('#btn-play').textContent = '▶';
audio.addEventListener('play', () => { $('#btn-play').textContent = '⏸'; });
audio.addEventListener('pause', () => { $('#btn-play').textContent = '▶'; });

$('#btn-next').addEventListener('click', nextTrack);
$('#btn-prev').addEventListener('click', prevTrack);

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

$('#btn-shuffle').addEventListener('click', (e) => {
  state.shuffle = !state.shuffle;
  e.currentTarget.classList.toggle('active', state.shuffle);
});
$('#btn-repeat').addEventListener('click', (e) => {
  state.repeat = (state.repeat + 1) % 3;
  const labels = ['↻', '↻¹', '↻¹'];
  // visual: active if repeat != 0
  e.currentTarget.classList.toggle('active', state.repeat !== 0);
  e.currentTarget.textContent = state.repeat === 2 ? '↻₁' : '↻';
});

$('#volume').addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });
audio.volume = 0.8;

/* ---------- Views ---------- */
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${view}`).classList.add('active');
  });
});

/* ---------- Settings ---------- */
function applySettingsToUI() {
  const s = state.settings;
  $('#set-owner').value = s.owner || 'sensesVoid';
  $('#set-repo').value = s.repo || 'jamukot';
  $('#set-workflow').value = s.workflow || 'add-track.yml';
  $('#set-token').value = s.token || '';
}
applySettingsToUI();
$('#set-save').addEventListener('click', () => {
  const s = {
    owner: $('#set-owner').value.trim(),
    repo: $('#set-repo').value.trim(),
    workflow: $('#set-workflow').value.trim(),
    token: $('#set-token').value.trim(),
  };
  saveSettings(s);
  $('#set-status').textContent = 'Saved.';
  $('#set-status').className = 'status ok';
});

/* ---------- Add track ---------- */
$('#add-submit').addEventListener('click', async () => {
  const url = $('#add-url').value.trim();
  const title = $('#add-title').value.trim();
  const artist = $('#add-artist').value.trim();
  const status = $('#add-status');
  if (!url || !title || !artist) {
    status.textContent = 'Please fill in all fields.';
    status.className = 'status err';
    return;
  }
  const s = state.settings;
  if (!s.token) {
    status.textContent = 'No GitHub PAT configured. Set it in Settings first.';
    status.className = 'status err';
    return;
  }
  const btn = $('#add-submit');
  btn.disabled = true;
  status.textContent = 'Dispatching workflow…';
  status.className = 'status';
  try {
    const ref = 'main';
    const resp = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}/actions/workflows/${s.workflow}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${s.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs: { youtube_url: url, title, artist } }),
    });
    if (resp.status === 204) {
      status.textContent = 'Workflow dispatched! Check the Actions tab; refresh after it completes.';
      status.className = 'status ok';
      $('#add-url').value = ''; $('#add-title').value = ''; $('#add-artist').value = '';
    } else {
      const txt = await resp.text();
      status.textContent = `Failed (${resp.status}): ${txt.slice(0,200)}`;
      status.className = 'status err';
    }
  } catch (e) {
    status.textContent = 'Network error: ' + e.message;
    status.className = 'status err';
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Sync lyrics view (mirror) ---------- */
// keep lf-lyrics in sync already via renderLyrics

/* ---------- Init ---------- */
loadTracks();
if (state.tracks.length === 0) { /* nothing */ }
// auto select first? no, wait for user
