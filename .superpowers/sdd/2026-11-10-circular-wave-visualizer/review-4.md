# Review Package for Task 4

## Task
Drive the ring from the audio analyser (Task 4)

## Commits
e6d60a5 feat: drive wave ring from the audio analyser

## Diff (116042f..e6d60a5)

### js/app.js
```diff
 const state = {
   wallTotal: 0,
   wallLoading: false,
   lyricsCache: null,
-  coverCache: new Map(),
 };
 
 function loadSettings() {
@@ -66,10 +65,11 @@ async function initAudio() {
   gainNode = audioCtx.createGain();
   gainNode.gain.value = parseFloat($('#volume')?.value || '0.8');
   analyser = audioCtx.createAnalyser();
-  analyser.fftSize = 128;
+  analyser.fftSize = 256;
   analyser.smoothingTimeConstant = 0.8;
   analyser.connect(gainNode);
   gainNode.connect(audioCtx.destination);
+  if (waveRing) waveRing.setAnalyser(analyser);
   // init opus decoder lazily (only needed for .opus files)
   // (decoder will be created on first .opus load)
   // wire up volume slider
@@ -179,6 +179,7 @@ function playBuffer(buffer, offset = 0) {
   playbackStartCtx = audioCtx.currentTime;
   isPlaying = true;
   startProgressLoop();
+  if (waveRing) waveRing.start();
   const playBtn = $('#btn-play'); if (playBtn) playBtn.textContent = '⏸';
 }
 
@@ -189,6 +190,7 @@ function pausePlayback() {
   stopSource();
   isPlaying = false;
   stopProgressLoop();
+  if (waveRing) waveRing.stop();
   const playBtn = $('#btn-play'); if (playBtn) playBtn.textContent = '▶';
 }
 
@@ -313,7 +315,6 @@ async function playIndex(idx) {
   const src = t.url || t.file;
   await initAudio();
   updateNowPlaying(t);
-  fetchCover(t);
   fetchLyrics(t);
   renderPlaylist();
   try {
@@ -324,6 +325,7 @@ async function playIndex(idx) {
   } catch (e) {
     console.error('Failed to load track:', e && e.message, src);
     const np = $('#np-title'); if (np) np.textContent = 'Playback error: ' + (e && e.message ? e.message : 'unknown');
+    if (waveRing) waveRing.stop();
     // auto-skip to next track after 2s
     setTimeout(() => { if (state.index === idx) nextTrack(); }, 2000);
   }
@@ -338,41 +340,6 @@ function updateNowPlaying(t) {
   const pt = $('#progress-thumb'); if (pt) pt.style.left = '0%';
 }
 
-function initialsOf(t) { return (t.title || '?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }
-
-async function fetchCover(t) {
-  const img = $('#cover-img');
-  const fb = $('#cover-fallback');
-  if (!img || !fb) return;
-  img.classList.remove('loaded');
-  fb.textContent = initialsOf(t);
-  const hue = hashStr(t.title + t.artist) % 360;
-  const grad = `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${(hue+60)%360},70%,45%))`;
-  fb.style.background = grad;
-  // cache check
-  const cacheKey = t.title + '|' + t.artist;
-  if (state.coverCache.has(cacheKey)) {
-    const url = state.coverCache.get(cacheKey);
-    if (url) { img.src = url; img.onload = () => img.classList.add('loaded'); }
-    return;
-  }
-  try {
-    const q = encodeURIComponent(`${t.artist} ${t.title}`);
-    const res = await fetchWithTimeout(`https://itunes.apple.com/search?term=${q}&media=music&limit=1`, 6000);
-    const data = await res.json().catch(() => ({}));
-    if (data.results && data.results[0] && data.results[0].artworkUrl100) {
-      const url = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
-      state.coverCache.set(cacheKey, url);
-      img.src = url;
-      img.onload = () => img.classList.add('loaded');
-    } else {
-      state.coverCache.set(cacheKey, null);
-    }
-  } catch (e) { state.coverCache.set(cacheKey, null); /* keep fallback */ }
-}
-
-function hashStr(s) { let h = 0; for (let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }
-
 /* ---------- Lyrics ---------- */
 async function fetchWithTimeout(url, ms = 7000) {
   const ctrl = new AbortController();
@@ -573,7 +540,10 @@ function nextTrack() {
   } else {
     next = state.index + 1;
     if (next >= state.tracks.length) {
-      if (state.repeat === 1) next = 0; else return;
+      if (state.repeat === 1) next = 0; else {
+        if (waveRing) waveRing.stop();
+        return;
+      }
     }
   }
   playIndex(next);
```