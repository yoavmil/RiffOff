// One-time migration: decrypt the committed vault into an ignored local folder.
// RIFFOFF_PASSWORD is deliberately supplied through the environment, never source.
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.RIFFOFF_VAULT_DIR ?? join(root, 'public/vault');
const target = process.env.RIFFOFF_EXPORT_DIR ?? join(root, 'private/cloudflare-migration');
if (!process.env.RIFFOFF_PASSWORD) throw new Error('Set RIFFOFF_PASSWORD to decrypt the existing vault');
const meta = JSON.parse(readFileSync(join(source, 'meta.json'), 'utf8'));
if (meta.version !== 1 || meta.kdf !== 'PBKDF2-SHA256') throw new Error('Unsupported vault format');
const key = pbkdf2Sync(process.env.RIFFOFF_PASSWORD, Buffer.from(meta.salt, 'base64'), meta.iterations, 64, 'sha256').subarray(0, 32);
function open(name) {
  if (!/^[a-f0-9]{20}\.bin$/.test(name)) throw new Error('Invalid vault filename');
  const bytes = readFileSync(join(source, name));
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]);
}
const songs = JSON.parse(open(meta.playlist).toString('utf8'));
if (!Array.isArray(songs) || !songs.length) throw new Error('Invalid playlist');
mkdirSync(join(target, 'audio'), { recursive: true });
let totalBytes = 0;
const playlist = songs.map((song) => {
  if (!song.audioFile.startsWith('vault:')) throw new Error('Expected encrypted audio');
  const mp3 = open(song.audioFile.slice(6));
  const hash = createHash('sha256').update(mp3).digest('hex');
  const audioFile = `audio/${hash}.mp3`;
  writeFileSync(join(target, audioFile), mp3);
  totalBytes += mp3.length;
  return { ...song, audioFile };
});
writeFileSync(join(target, 'songs.json'), `${JSON.stringify(playlist, null, 2)}\n`);
console.log(`Exported ${playlist.length} authenticated MP3 clips (${totalBytes} bytes) into the ignored migration folder.`);
