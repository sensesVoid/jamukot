const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export function extractYouTubeId(url) {
  let parsed;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let id = null;
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/').filter(Boolean)[0] || null;
  } else if (parsed.pathname.startsWith('/shorts/')) {
    id = parsed.pathname.split('/').filter(Boolean)[1] || null;
  } else if (parsed.pathname === '/watch') {
    id = parsed.searchParams.get('v');
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return id;
}

export function sanitizeText(value, maxLen = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeText(value) {
  let s = String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  s = s.replace(/\b(?:feat|ft)\.?\s+.*$/, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^the\s+/, '');
  return s;
}

export function normalizeKey(title, artist) {
  return `${normalizeText(title)}|${normalizeText(artist)}`;
}

export function findDuplicate(candidate, tracks = [], requests = []) {
  const { title = '', artist = '', videoId = null } = candidate || {};
  if (!normalizeText(title) || !normalizeText(artist)) return null;
  const key = normalizeKey(title, artist);

  for (const track of tracks || []) {
    if (!track) continue;
    if (videoId && track.youtube_id === videoId) return 'library';
    if (normalizeKey(track.title, track.artist) === key) return 'library';
  }

  for (const req of requests || []) {
    if (!req || (req.status && req.status !== 'pending')) continue;
    if (videoId && req.video_id === videoId) return 'request';
    if (normalizeKey(req.title, req.artist) === key) return 'request';
  }

  return null;
}
