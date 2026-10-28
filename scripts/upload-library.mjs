// Publish local MP3s through the authenticated Worker. The admin token stays local.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = join(root, 'private/cloudflare-admin.json');
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
const endpoint = process.env.RIFFOFF_LIBRARY_URL ?? settings.url;
const token = process.env.RIFFOFF_ADMIN_TOKEN ?? settings.token;
if (!endpoint || !token) throw new Error('Set RIFFOFF_LIBRARY_URL and RIFFOFF_ADMIN_TOKEN, or private/cloudflare-admin.json');
const url = new URL(endpoint);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Expected an HTTPS library origin');
const source = process.env.RIFFOFF_UPLOAD_DIR ?? process.env.RIFFOFF_PRIVATE_DIR ?? join(root, 'private');
const songs = JSON.parse(readFileSync(join(source, 'songs.json'), 'utf8'));
if (!Array.isArray(songs) || !songs.length) throw new Error('Expected a nonempty playlist');

async function upload(key, bytes, contentType) {
  const response = await fetch(new URL(`/admin/${key}`, url), {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body: bytes,
  });
  if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status})`);
  const stored = await response.json();
  if (stored.size !== bytes.length) throw new Error('Upload size mismatch');
}

const playlist = [];
for (const song of songs) {
  for (const field of ['title', 'artist', 'audioFile', 'language', 'decade']) {
    if (!String(song[field] ?? '').trim()) throw new Error(`Missing playlist field: ${field}`);
  }
  const file = basename(song.audioFile);
  if (!file.toLowerCase().endsWith('.mp3')) throw new Error('Cloud library requires MP3 clips');
  const bytes = readFileSync(join(source, 'audio', file));
  const key = `audio/${createHash('sha256').update(bytes).digest('hex')}.mp3`;
  await upload(key, bytes, 'audio/mpeg');
  playlist.push({ ...song, audioFile: key });
}
// Publish the playlist last: incomplete uploads never replace the active library.
await upload('songs.json', Buffer.from(JSON.stringify(playlist)), 'application/json');
console.log(`Published ${playlist.length} MP3 clips and playlist to Cloudflare R2.`);
