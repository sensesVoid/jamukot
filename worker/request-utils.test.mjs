import test from 'node:test';
import assert from 'node:assert/strict';
import { extractYouTubeId, sanitizeText, normalizeKey, findDuplicate } from './request-utils.js';

test('extractYouTubeId accepts watch, short, shorts, and music URLs', () => {
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('extractYouTubeId rejects non-YouTube and malformed IDs', () => {
  assert.equal(extractYouTubeId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractYouTubeId('not a url'), null);
  assert.equal(extractYouTubeId('https://youtu.be/short'), null);
});

test('sanitizeText trims, collapses whitespace, strips controls, and truncates', () => {
  assert.equal(sanitizeText('  A\u0000  B  '), 'A B');
  assert.equal(sanitizeText('x'.repeat(200)).length, 120);
  assert.equal(sanitizeText(null), '');
});

test('normalizeKey ignores brackets, feat tails, punctuation, case, and leading the', () => {
  assert.equal(
    normalizeKey('Song (Official Video)', 'The Artist feat. Someone'),
    normalizeKey('song', 'Artist')
  );
  assert.notEqual(normalizeKey('Song A', 'Artist'), normalizeKey('Song B', 'Artist'));
});

test('findDuplicate detects library, queue, and video-id matches', () => {
  const tracks = [{ title: 'Song', artist: 'Artist', youtube_id: 'aaaaaaaaaaa' }];
  const requests = [{ title: 'Other', artist: 'Person', video_id: 'bbbbbbbbbbb', status: 'pending' }];
  assert.equal(findDuplicate({ title: 'Song (Lyrics)', artist: 'Artist', videoId: null }, tracks, requests), 'library');
  assert.equal(findDuplicate({ title: 'Other', artist: 'Person', videoId: null }, tracks, requests), 'request');
  assert.equal(findDuplicate({ title: 'New', artist: 'New', videoId: 'aaaaaaaaaaa' }, tracks, requests), 'library');
  assert.equal(findDuplicate({ title: 'New', artist: 'New', videoId: null }, tracks, requests), null);
});
