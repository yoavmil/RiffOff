import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { byteRange } from './worker.mjs';

const origin = 'https://library.example';
const key = `audio/${'a'.repeat(64)}.mp3`;
const clip = new TextEncoder().encode('0123456789');
function setup() {
  const objects = new Map([[key, clip], ['songs.json', new TextEncoder().encode(JSON.stringify([
    { title: 'Demo riff', artist: 'Sample artist', language: 'en', decade: '80', audioFile: key },
  ]))]]);
  const metadata = (key) => ({ size: objects.get(key).length, httpEtag: '"demo-etag"' });
  const env = {
    GAME_PASSWORD: 'test-password', SESSION_SECRET: 'test-session-secret', ADMIN_TOKEN: 'test-admin-token',
    LOGIN_LIMIT: { limit: async () => ({ success: true }) },
    SONGS: {
      async head(key) { return objects.has(key) ? metadata(key) : null; },
      async get(key, options) {
        if (!objects.has(key)) return null;
        const bytes = objects.get(key);
        const range = options?.range;
        return { ...metadata(key), body: range ? bytes.slice(range.offset, range.offset + range.length) : bytes,
          json: async () => JSON.parse(new TextDecoder().decode(bytes)) };
      },
      async put(key, body) {
        objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
        return { size: objects.get(key).length, etag: 'demo-etag' };
      },
    },
  };
  const request = (path, options) => worker.fetch(new Request(origin + path, options), env);
  return { env, request };
}

async function login(request) {
  const response = await request('/session', { method: 'POST', body: JSON.stringify({ password: 'test-password' }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

test('password and session protect both playlist and audio', async () => {
  const { request } = setup();
  assert.equal((await request('/songs.json')).status, 401);
  assert.equal((await request(`/${key}`)).status, 401);
  assert.equal((await request('/session', { method: 'POST', body: '{"password":"wrong"}' })).status, 401);
  const token = await login(request);
  const response = await request('/songs.json', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const songs = await response.json();
  assert.equal(songs[0].title, 'Demo riff');
  assert.equal(new URL(songs[0].audioFile).pathname, `/${key}`);
  assert.equal((await request(`/${key}?token=${token.slice(0, -1)}z`)).status, 401);
});

test('expired and revoked sessions are rejected', async () => {
  const { request, env } = setup();
  const token = await login(request);
  assert.equal((await request(`/${key}?token=1000000000.${token.split('.').slice(1).join('.')}`)).status, 401);
  env.SESSION_SECRET = 'rotated-secret';
  assert.equal((await request(`/${key}?token=${token}`)).status, 401);
});

test('MP3 GET, HEAD and Safari ranges return exact bodies and headers', async () => {
  const { request } = setup();
  const token = await login(request);
  const path = `/${key}?token=${token}`;
  const full = await request(path);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(await full.text(), '0123456789');
  const head = await request(path, { method: 'HEAD' });
  assert.equal(head.headers.get('Content-Length'), '10');
  assert.equal(await head.text(), '');
  for (const [value, expected, contentRange] of [
    ['bytes=0-1', '01', 'bytes 0-1/10'], ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-99', '89', 'bytes 8-9/10'],
  ]) {
    const response = await request(path, { headers: { Range: value } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), contentRange);
    assert.equal(response.headers.get('Content-Length'), String(expected.length));
    assert.equal(await response.text(), expected);
  }
  assert.equal((await request(path, { headers: { Range: 'bytes=20-' } })).status, 416);
  assert.equal((await request(path, { headers: { Range: 'bytes=0-1', 'If-Range': '"old"' } })).status, 200);
});

test('admin upload requires a separate credential and limits keys', async () => {
  const { request } = setup();
  const options = { method: 'PUT', headers: { Authorization: 'Bearer test-admin-token', 'Content-Length': '3' }, body: 'abc' };
  assert.equal((await request(`/admin/${key}`, { ...options, headers: { Authorization: 'Bearer test-password' } })).status, 401);
  assert.equal((await request('/admin/unexpected.txt', options)).status, 400);
  assert.equal((await request(`/admin/${key}`, options)).status, 200);
  const token = await login(request);
  assert.equal(await (await request(`/${key}?token=${token}`)).text(), 'abc');
});

test('CORS supports the GitHub Pages client and errors do not leak details', async () => {
  const { request, env } = setup();
  const options = await request('/session', { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
  const token = await login(request);
  env.SONGS.get = async () => { throw new Error('private internal details'); };
  const response = await request('/songs.json', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Library unavailable' });
});

test('invalid byte ranges are rejected', () => {
  for (const value of ['bytes=-0', 'bytes=10-', 'bytes=3-1', 'bytes=-', 'bytes=0-1,3-4', 'bytes=9007199254740993-']) {
    assert.equal(byteRange(value, 10), false);
  }
});

test('password endpoint limits attempts and oversized bodies', async () => {
  const { request, env } = setup();
  assert.equal((await request('/session', { method: 'POST', body: 'x'.repeat(1025) })).status, 413);
  env.LOGIN_LIMIT.limit = async () => ({ success: false });
  assert.equal((await request('/session', { method: 'POST', body: '{}' })).status, 429);
});
