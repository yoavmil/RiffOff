import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle the actual client module with Vite's BASE_URL substitution.
const bundle = await build({ entryPoints: ['src/core/cloudLibrary.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node', define: { 'import.meta.env.BASE_URL': '"/RiffOff/"' } });
const client = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const library = { url: 'https://library.example' };

function storage(t) {
  const entries = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  }, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return entries;
}

test('library config uses the deployment subpath and rejects service failures', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(library));
  assert.deepEqual(await client.fetchCloudLibrary(), library);
  assert.equal(fetch.mock.calls[0].arguments[0], '/RiffOff/library.json');
  fetch.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  assert.equal(await client.fetchCloudLibrary(), null);
  fetch.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  await assert.rejects(client.fetchCloudLibrary());
});

test('wrong password stays locked; success remembers a token, never the password', async (t) => {
  const entries = storage(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));
  assert.equal(await client.openCloudWithPassword(library, 'demo-password'), null);
  assert.equal(entries.size, 0);
  fetch.mock.mockImplementation(async (url) => String(url).endsWith('/session')
    ? Response.json({ token: 'demo-session' }) : Response.json([{ audioFile: 'https://library.example/audio/demo.mp3' }]));
  const songs = await client.openCloudWithPassword(library, 'demo-password');
  assert.equal(songs.length, 1);
  assert.equal(JSON.stringify([...entries.values()]).includes('demo-password'), false);
  assert.equal((await client.openCloudWithSavedSession(library)).length, 1);
  const lastCall = fetch.mock.calls.at(-1);
  assert.equal(lastCall.arguments[1].headers.Authorization, 'Bearer demo-session');
});

test('expired saved sessions are removed, network errors remain errors', async (t) => {
  const entries = storage(t);
  entries.set('riffoff:cloudSession', JSON.stringify({ ...library, token: 'expired' }));
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));
  assert.equal(await client.openCloudWithSavedSession(library), null);
  assert.equal(entries.size, 0);
  entries.set('riffoff:cloudSession', JSON.stringify({ ...library, token: 'valid' }));
  fetch.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  await assert.rejects(client.openCloudWithSavedSession(library));
  assert.equal(entries.size, 1);
});
