import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();
const AUDIO_KEY = /^audio\/[a-f0-9]{64}\.mp3$/;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_UPLOAD = 25 * 1024 * 1024;

function headers(extra = {}) {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, If-Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: headers() });
}

async function secretEquals(candidate, expected) {
  if (!expected || !candidate) return false;
  const [a, b] = await Promise.all([candidate, expected].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

async function signingKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function createSession(env) {
  const payload = `${Math.floor(Date.now() / 1000) + SESSION_SECONDS}.${crypto.randomUUID()}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload)));
  return `${payload}.${Array.from(signature, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function validSession(token, env) {
  const match = /^(\d{10})\.([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(token ?? '');
  if (!match || Number(match[1]) <= Date.now() / 1000) return false;
  const signature = Uint8Array.from(match[3].match(/../g), (byte) => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', await signingKey(env), signature, encoder.encode(`${match[1]}.${match[2]}`));
}

function bearer(request) {
  return request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
}

/** Resolve a single byte range, including suffix and open-ended requests. */
export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return { offset: start, length: end - start + 1 };
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers() });

  if (url.pathname === '/session' && request.method === 'POST') {
    const allowed = await env.LOGIN_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'local' });
    if (!allowed.success) return json({ error: 'Too many attempts; try again shortly' }, 429);
    if (Number(request.headers.get('Content-Length')) > 1024) return json({ error: 'Request too large' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Invalid request' }, 400);
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024) {
        await reader.cancel();
        return json({ error: 'Request too large' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const input = new TextDecoder().decode(bytes);
    let password;
    try { password = JSON.parse(input).password; } catch { return json({ error: 'Invalid request' }, 400); }
    if (typeof password !== 'string' || !(await secretEquals(password, env.GAME_PASSWORD))) return json({ error: 'Unauthorized' }, 401);
    return json({ token: await createSession(env) });
  }

  // Upload access is separate from the players' password. Never expose this token in the client.
  if (url.pathname.startsWith('/admin/') && request.method === 'PUT') {
    if (!(await secretEquals(bearer(request), env.ADMIN_TOKEN))) return json({ error: 'Unauthorized' }, 401);
    const key = url.pathname.slice('/admin/'.length);
    if (key !== 'songs.json' && !AUDIO_KEY.test(key)) return json({ error: 'Invalid object key' }, 400);
    const length = Number(request.headers.get('Content-Length'));
    if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_UPLOAD) return json({ error: 'Invalid upload size' }, 413);
    const object = await env.SONGS.put(key, request.body, {
      httpMetadata: { contentType: key === 'songs.json' ? 'application/json' : 'audio/mpeg', cacheControl: 'private, no-store' },
    });
    return json({ key, size: object.size, etag: object.etag });
  }

  if (url.pathname === '/songs.json' && request.method === 'GET') {
    const token = bearer(request);
    if (!(await validSession(token, env))) return json({ error: 'Unauthorized' }, 401);
    const object = await env.SONGS.get('songs.json');
    if (!object) return json({ error: 'Playlist not found' }, 404);
    const songs = await object.json();
    return json(songs.map((song) => {
      if (!AUDIO_KEY.test(song.audioFile)) throw new Error('Invalid stored audio key');
      const audio = new URL(`/${song.audioFile}`, url.origin);
      audio.searchParams.set('token', token);
      return { ...song, audioFile: audio.href };
    }));
  }

  const key = url.pathname.slice(1);
  if (AUDIO_KEY.test(key) && ['GET', 'HEAD'].includes(request.method)) {
    if (!(await validSession(url.searchParams.get('token'), env))) return json({ error: 'Unauthorized' }, 401);
    const metadata = await env.SONGS.head(key);
    if (!metadata) return json({ error: 'Audio not found' }, 404);
    const resultHeaders = headers({ 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', ETag: metadata.httpEtag });
    // HEAD describes the full representation. Honor If-Range for GET only.
    const ifRange = request.headers.get('If-Range');
    const range = request.method === 'HEAD' || (ifRange && ifRange !== metadata.httpEtag)
      ? null : byteRange(request.headers.get('Range'), metadata.size);
    if (range === false) {
      resultHeaders.set('Content-Range', `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers: resultHeaders });
    }
    resultHeaders.set('Content-Length', String(range ? range.length : metadata.size));
    if (range) resultHeaders.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
    if (request.method === 'HEAD') return new Response(null, { headers: resultHeaders });
    const object = await env.SONGS.get(key, range ? { range } : undefined);
    if (!object) return json({ error: 'Audio not found' }, 404);
    return new Response(object.body, { status: range ? 206 : 200, headers: resultHeaders });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      // Never log passwords, signed URLs, or playlist contents.
      return json({ error: 'Library unavailable' }, 503);
    }
  },
};
