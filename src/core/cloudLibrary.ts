import { PlaylistError } from './songs';

export interface CloudLibrary {
  url: string;
}

const STORAGE_KEY = 'riffoff:cloudSession';

/** Optional deployment config. A configured service failure must never silently select demo songs. */
export async function fetchCloudLibrary(): Promise<CloudLibrary | null> {
  const response = await fetch(`${import.meta.env.BASE_URL}library.json`, { cache: 'no-store' });
  if (response.status === 404 || (response.ok && response.headers.get('content-type')?.includes('text/html'))) return null;
  if (!response.ok) throw new PlaylistError('http', { status: response.status });
  const config = (await response.json()) as CloudLibrary;
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid cloud library URL');
  return { url: url.origin };
}

async function playlist(library: CloudLibrary, token: string): Promise<unknown | null> {
  const response = await fetch(`${library.url}/songs.json`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new PlaylistError('http', { status: response.status });
  return response.json();
}

export async function openCloudWithSavedSession(library: CloudLibrary): Promise<unknown | null> {
  let saved: { url: string; token: string } | null = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { /* storage disabled */ }
  if (!saved || saved.url !== library.url || typeof saved.token !== 'string') return null;
  const songs = await playlist(library, saved.token);
  if (songs === null) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage disabled */ }
  }
  return songs;
}

export async function openCloudWithPassword(library: CloudLibrary, password: string): Promise<unknown | null> {
  const response = await fetch(`${library.url}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }), cache: 'no-store',
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new PlaylistError('http', { status: response.status });
  const { token } = (await response.json()) as { token: string };
  if (typeof token !== 'string' || !token) throw new Error('Invalid library session');
  const songs = await playlist(library, token);
  if (songs !== null) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: library.url, token })); } catch { /* storage disabled */ }
  }
  return songs;
}
