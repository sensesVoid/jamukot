// Cloudflare Worker: song-request queue + GitHub Actions dispatch proxy.
// Deploy: `cd worker && npx wrangler deploy`
// Set secret: `npx wrangler secret put GITHUB_TOKEN` (repo contents read/write + workflow scope)
// Set vars in wrangler.toml: GITHUB_OWNER, GITHUB_REPO, WORKFLOW_FILE, ALLOWED_ORIGIN

import { extractYouTubeId, sanitizeText, findDuplicate } from './request-utils.js';

const REQUESTS_PATH = 'data/requests.json';
const MAX_PENDING_REQUESTS = 200;
const MAX_REQUESTS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const rateBuckets = new Map();

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://sensesvoid.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function toBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Utf8(value) {
  const binary = atob(String(value || '').replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function githubHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'jamukot-dispatch-worker',
  };
}

function rateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.reset <= now) {
    rateBuckets.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

async function loadLibrary(owner, repo) {
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/main/data/tracks.json`,
      { cf: { cacheTtl: 60 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.tracks) ? data.tracks : [];
  } catch {
    return [];
  }
}

async function readQueue(owner, repo, token) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${REQUESTS_PATH}?ref=main`,
    { headers: githubHeaders(token) }
  );
  if (res.status === 404) return { queue: { requests: [] }, sha: null };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = await res.json();
  let parsed;
  try {
    parsed = JSON.parse(fromBase64Utf8(data.content));
  } catch {
    throw new Error('queue-unreadable');
  }
  if (!parsed || !Array.isArray(parsed.requests)) throw new Error('queue-unreadable');
  return { queue: parsed, sha: data.sha };
}

async function writeQueue(owner, repo, token, queue, sha, message) {
  const body = {
    message,
    content: toBase64Utf8(JSON.stringify(queue, null, 2) + '\n'),
    branch: 'main',
  };
  if (sha) body.sha = sha;
  return fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${REQUESTS_PATH}`,
    {
      method: 'PUT',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

async function handleSongRequest(request, env) {
  const cors = corsHeaders(env);
  const allowedOrigin = env.ALLOWED_ORIGIN || 'https://sensesvoid.github.io';
  const origin = request.headers.get('Origin') || '';
  if (origin && origin !== allowedOrigin) {
    return jsonResponse({ ok: false, error: 'Origin not allowed' }, 403, cors);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400, cors);
  }
  if (sanitizeText(body.website)) {
    return jsonResponse({ ok: false, error: 'Invalid submission' }, 400, cors);
  }

  const youtubeUrl = sanitizeText(body.youtube_url, 500);
  const videoId = extractYouTubeId(youtubeUrl);
  if (!videoId) {
    return jsonResponse({ ok: false, error: 'Enter a valid YouTube URL' }, 400, cors);
  }

  const title = sanitizeText(body.title, 120);
  const artist = sanitizeText(body.artist, 120);
  if (!title || !artist) {
    return jsonResponse({ ok: false, error: 'Title and artist are required' }, 400, cors);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (rateLimited(ip)) {
    return jsonResponse({ ok: false, error: 'Too many requests. Try again later.' }, 429, cors);
  }

  const token = env.GITHUB_TOKEN;
  if (!token) {
    return jsonResponse({ ok: false, error: 'Request queue is not configured' }, 500, cors);
  }
  const owner = env.GITHUB_OWNER || 'sensesVoid';
  const repo = env.GITHUB_REPO || 'jamukot';
  const tracks = await loadLibrary(owner, repo);

  for (let attempt = 0; attempt < 3; attempt++) {
    let read;
    try {
      read = await readQueue(owner, repo, token);
    } catch (e) {
      if (e.message === 'queue-unreadable') {
        return jsonResponse({ ok: false, error: 'Request queue is unreadable' }, 500, cors);
      }
      return jsonResponse({ ok: false, error: 'Could not read request queue' }, 500, cors);
    }

    const duplicate = findDuplicate({ title, artist, videoId }, tracks, read.queue.requests);
    if (duplicate === 'library') {
      return jsonResponse({ ok: false, error: 'Already in the library' }, 409, cors);
    }
    if (duplicate === 'request') {
      return jsonResponse({ ok: false, error: 'Already requested' }, 409, cors);
    }

    const pendingCount = read.queue.requests.filter(
      (r) => !r.status || r.status === 'pending'
    ).length;
    if (pendingCount >= MAX_PENDING_REQUESTS) {
      return jsonResponse({ ok: false, error: 'Request queue is full. Try again later.' }, 503, cors);
    }

    const entry = {
      id: crypto.randomUUID(),
      youtube_url: youtubeUrl,
      video_id: videoId,
      title,
      artist,
      requested_at: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      last_error: null,
    };
    read.queue.requests.push(entry);

    const write = await writeQueue(
      owner,
      repo,
      token,
      read.queue,
      read.sha,
      `Song request: ${artist} - ${title}`
    );
    if (write.ok) {
      return jsonResponse({ ok: true, id: entry.id }, 200, cors);
    }
    if (write.status !== 409) {
      const text = await write.text().catch(() => '');
      console.error('Queue write failed', write.status, text.slice(0, 200));
      return jsonResponse({ ok: false, error: 'Could not save request' }, 500, cors);
    }
  }

  return jsonResponse({ ok: false, error: 'Request queue is busy. Try again.' }, 503, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/request') {
      return handleSongRequest(request, env);
    }

    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://sensesvoid.github.io';
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    // Reject cross-origin browser requests from other sites
    if (origin && origin !== allowedOrigin) {
      return new Response(JSON.stringify({ ok: false, error: 'Origin not allowed' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const { youtube_url, title, artist } = body;
    if (!youtube_url || !title || !artist) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const owner = env.GITHUB_OWNER || 'sensesVoid';
    const repo = env.GITHUB_REPO || 'jamukot';
    const wf = env.WORKFLOW_FILE || 'add-track.yml';
    const token = env.GITHUB_TOKEN;
    // Storage limit check (9.5 GB)
    const LIMIT = 9.5 * 1024 * 1024 * 1024;
    try {
      const tracksRes = await fetch(`https://${owner}.github.io/${repo}/data/tracks.json`, { cf: { cacheTtl: 60 } });
      if (tracksRes.ok) {
        const tracksData = await tracksRes.json();
        const total = (tracksData.tracks || []).reduce((s, t) => s + (t.size || 0), 0);
        if (total >= LIMIT) {
          return new Response(JSON.stringify({ ok: false, error: 'Storage limit reached (9.5 GB). Delete a track first.' }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } catch { /* continue */ }
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: 'GITHUB_TOKEN not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'jamukot-dispatch-worker',
      },
      body: JSON.stringify({ ref: 'main', inputs: { youtube_url, title, artist } }),
    });
    if (ghRes.status === 204) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const txt = await ghRes.text();
    return new Response(JSON.stringify({ ok: false, error: `GitHub ${ghRes.status}: ${txt.slice(0, 200)}` }), {
      status: ghRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
