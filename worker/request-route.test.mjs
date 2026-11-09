import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const env = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_OWNER: 'sensesVoid',
  GITHUB_REPO: 'jamukot',
  ALLOWED_ORIGIN: 'https://sensesvoid.github.io',
};

function body(overrides = {}) {
  return JSON.stringify({
    youtube_url: 'https://youtu.be/dQw4w9WgXcQ',
    title: 'Song',
    artist: 'Artist',
    website: '',
    ...overrides,
  });
}

function request(payload = body(), ip = '1.1.1.1') {
  return new Request('https://worker.dev/request', {
    method: 'POST',
    headers: {
      Origin: 'https://sensesvoid.github.io',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: payload,
  });
}

function mockGitHub({ tracks = [], queue = { requests: [] }, queueMissing = false, queueMalformed = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes('raw.githubusercontent.com')) return Response.json({ tracks });
    if (u.includes('api.github.com')) {
      if (!opts.method || opts.method === 'GET') {
        if (queueMissing) return new Response('Not Found', { status: 404 });
        const raw = queueMalformed ? '{not json' : JSON.stringify(queue);
        return Response.json({ sha: 'sha1', content: Buffer.from(raw).toString('base64') });
      }
      if (opts.method === 'PUT') return Response.json({ content: {} }, { status: 201 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return calls;
}

test('valid request appends to the queue', async () => {
  const calls = mockGitHub();
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 200);
  const put = calls.find(c => c.opts.method === 'PUT');
  const sent = JSON.parse(Buffer.from(JSON.parse(put.opts.body).content, 'base64').toString('utf8'));
  assert.equal(sent.requests.length, 1);
  assert.equal(sent.requests[0].youtube_url, 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(sent.requests[0].status, 'pending');
});

test('missing queue file initializes a new one', async () => {
  const calls = mockGitHub({ queueMissing: true });
  const res = await worker.fetch(request(body({ youtube_url: 'https://youtu.be/aaaaaaaaaaa' }), '2.2.2.2'), env);
  assert.equal(res.status, 200);
  const put = calls.find(c => c.opts.method === 'PUT');
  assert.ok(put.opts.body);
});

test('malformed queue returns 500 and is not overwritten', async () => {
  const calls = mockGitHub({ queueMalformed: true });
  const res = await worker.fetch(request(body({ youtube_url: 'https://youtu.be/ccccccccccc' }), '2.5.2.5'), env);
  assert.equal(res.status, 500);
  assert.equal(calls.some(c => c.opts.method === 'PUT'), false);
});

test('duplicate in library returns 409', async () => {
  mockGitHub({ tracks: [{ title: 'Song', artist: 'Artist' }] });
  const res = await worker.fetch(request(body(), '3.3.3.3'), env);
  assert.equal(res.status, 409);
});

test('duplicate pending request returns 409', async () => {
  mockGitHub({ queue: { requests: [{ title: 'Song', artist: 'Artist', status: 'pending' }] } });
  const res = await worker.fetch(request(body(), '4.4.4.4'), env);
  assert.equal(res.status, 409);
});

test('full queue returns 503', async () => {
  const requests = Array.from({ length: 200 }, (_, i) => ({
    title: `Song ${i}`,
    artist: 'Artist',
    status: 'pending',
  }));
  mockGitHub({ queue: { requests } });
  const res = await worker.fetch(
    request(body({ youtube_url: 'https://youtu.be/ddddddddddd', title: 'New', artist: 'New' }), '8.8.8.8'),
    env
  );
  assert.equal(res.status, 503);
});

test('honeypot and invalid URL return 400', async () => {
  mockGitHub();
  const spam = await worker.fetch(request(body({ website: 'spam' }), '5.5.5.5'), env);
  const badUrl = await worker.fetch(request(body({ youtube_url: 'https://example.com/x' }), '6.6.6.6'), env);
  assert.equal(spam.status, 400);
  assert.equal(badUrl.status, 400);
});

test('other origins are rejected', async () => {
  mockGitHub();
  const req = new Request('https://worker.dev/request', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7' },
    body: body(),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 403);
});
