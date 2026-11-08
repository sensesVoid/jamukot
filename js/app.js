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
  img.classList.remove('loaded'); img2.classList.remove('loaded');
  fb.textContent = initialsOf(t);
  fb2.textContent = initialsOf(t);
  const hue = hashStr(t.title + t.artist) % 360;
  const grad = `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue+60)%360},70%,45%))`;
  fb.style.background = grad; fb2.style.background = grad;
  $('#vinyl-label').style.background = grad;
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
  state.lyricOffset = loadOffset(t.id);
  renderLyrics();
  const offEl = $('#lyric-offset');
  if (offEl) offEl.value = state.lyricOffset;
  const offVal = $('#offset-val');
  if (offVal) offVal.textContent = state.lyricOffset.toFixed(1) + 's';
  $('#lyrics-status').textContent = 'loading';
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
      $('#lyrics-status').textContent = 'synced';
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
      $('#lyrics-status').textContent = 'plain';
      const note = $('#lyrics-note');
      if (note) note.textContent = 'Plain lyrics (not time-synced).';
    } else {
      $('#lyrics-status').textContent = 'none';
      const note = $('#lyrics-note');
      if (note) note.textContent = 'No lyrics found for this track.';
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
  $$('#lf-lyrics .line').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('past', i < idx);
  });
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
  e.currentTarget.classList.toggle('active', state.repeat !== 0);
  e.currentTarget.textContent = state.repeat === 2 ? '↻₁' : '↻';
});

$('#volume').addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });

const offsetSlider = $('#lyric-offset');
if (offsetSlider) {
  offsetSlider.addEventListener('input', (e) => {
    state.lyricOffset = parseFloat(e.target.value);
    $('#offset-val').textContent = state.lyricOffset.toFixed(1) + 's';
    if (state.index >= 0) saveOffset(state.tracks[state.index].id, state.lyricOffset);
    state.lyricIndex = -1;
    syncLyrics(audio.currentTime);
  });
}
audio.volume = 0.8;

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
            statusEl.textContent = 'Run ' + r.conclusion + '. Open the Actions tab for details (likely YouTube bot protection; add YOUTUBE_COOKIES secret or use the local method).';
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
  $('#set-worker').value = s.worker || '';
}
applySettingsToUI();
$('#set-save').addEventListener('click', () => {
  const s = {
    owner: $('#set-owner').value.trim(),
    repo: $('#set-repo').value.trim(),
    workflow: $('#set-workflow').value.trim(),
    token: $('#set-token').value.trim(),
    worker: $('#set-worker').value.trim(),
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
  const owner = s.owner || 'sensesVoid';
  const repo = s.repo || 'jamukot';
  const wf = s.workflow || 'add-track.yml';

  // 1-click path: Cloudflare Worker holds the token
  if (s.worker) {
    const btn = $('#add-submit');
    btn.disabled = true;
    status.textContent = 'Dispatching (1 click)...';
    status.className = 'status';
    try {
      const resp = await fetch(s.worker, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_url: url, title, artist }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        status.textContent = 'Dispatched! The run will download, compress, and commit. Refresh this page when it finishes (~1 min).';
        status.className = 'status ok';
        $('#add-url').value = ''; $('#add-title').value = ''; $('#add-artist').value = '';
        if (s.token) pollLatestRun(s, status);
      } else {
        status.textContent = 'Worker error: ' + (data.error || resp.status);
        status.className = 'status err';
      }
    } catch (e) {
      status.textContent = 'Network error: ' + e.message;
      status.className = 'status err';
    } finally {
      btn.disabled = false;
    }
    return;
  }

  // PAT path: dispatch directly from the browser
  if (s.token) {
    const btn = $('#add-submit');
    btn.disabled = true;
    status.textContent = 'Dispatching...';
    status.className = 'status';
    try {
      const resp = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/actions/workflows/' + wf + '/dispatches', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + s.token, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main', inputs: { youtube_url: url, title, artist } }),
      });
      if (resp.status === 204) {
        status.textContent = 'Dispatched! Polling run status...';
        status.className = 'status ok';
        $('#add-url').value = ''; $('#add-title').value = ''; $('#add-artist').value = '';
        pollLatestRun(s, status);
      } else {
        const txt = await resp.text();
        status.textContent = 'Failed (' + resp.status + '): ' + txt.slice(0,200);
        status.className = 'status err';
      }
    } catch (e) {
      status.textContent = 'Network error: ' + e.message;
      status.className = 'status err';
    } finally {
      btn.disabled = false;
    }
    return;
  }

  // Fallback: clipboard + open Actions
  const payload = 'youtube_url: ' + url + '\ntitle: ' + title + '\nartist: ' + artist;
  let copied = false;
  try { await navigator.clipboard.writeText(payload); copied = true; } catch (e) { copied = false; }
  const actionsUrl = 'https://github.com/' + owner + '/' + repo + '/actions/workflows/' + wf;
  window.open(actionsUrl, '_blank');
  if (copied) {
    status.textContent = 'Inputs copied to clipboard. In the new tab: click "Run workflow", paste the three values, then confirm.';
    status.className = 'status ok';
  } else {
    status.textContent = 'Could not copy automatically. Opened Actions tab. Use these inputs:\n' + payload;
    status.className = 'status err';
  }
});

/* ---------- Sync lyrics view (mirror) ---------- */
// keep lf-lyrics in sync already via renderLyrics

/* ---------- Init ---------- */
loadTracks();
if (state.tracks.length === 0) { /* nothing */ }
