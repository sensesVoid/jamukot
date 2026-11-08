// Cloudflare Worker: proxies an "add track" request to GitHub Actions workflow_dispatch.
// Deploy: `cd worker && npx wrangler deploy`
// Set secret: `npx wrangler secret put GITHUB_TOKEN` (PAT with repo+workflow scopes)
// Set vars in wrangler.toml: GITHUB_OWNER, GITHUB_REPO, WORKFLOW_FILE

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*', // tighten to your Pages origin in production
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
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
