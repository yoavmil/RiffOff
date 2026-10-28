import { useCallback, useEffect, useRef, useState } from 'react';

export type PlayerStatus = 'loading' | 'ready' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';
export type AudioErrorCode = 'network' | 'decode' | 'unsupported' | 'notFound' | 'unknown';
export type PlayerNotice = 'blocked';

export interface AudioPlayer {
  status: PlayerStatus;
  /** True while the host is holding the play button (user intent, not playback state). */
  holding: boolean;
  /** Error for the current track (translated by the UI), or null. Never tied to song details. */
  error: AudioErrorCode | null;
  /** Transient hint, e.g. when the browser blocked the first play attempt. */
  notice: PlayerNotice | null;
  currentTime: number;
  duration: number;
  press: () => void;
  release: () => void;
  restart: () => void;
}

// Generic metadata so lock screens and media notifications never show a song name.
const MEDIA_METADATA = { title: 'RiffOff', artist: 'Mystery riff', album: 'RiffOff' };

function applyNeutralMediaSession(release: () => void) {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({
      ...MEDIA_METADATA,
      artwork: [{ src: `${import.meta.env.BASE_URL}icons/icon-512.png`, sizes: '512x512', type: 'image/png' }],
    });
  } catch {
    /* MediaMetadata unsupported */
  }
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action unsupported on this browser */
    }
  };
  // Playback may only start from the hold button: lock-screen "play" does nothing.
  set('play', () => {});
  set('pause', release);
  set('stop', release);
  for (const action of ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const) {
    set(action, null);
  }
}

function describeMediaError(err: MediaError | null): AudioErrorCode {
  switch (err?.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return 'network';
    case MediaError.MEDIA_ERR_DECODE:
      return 'decode';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'unsupported';
    default:
      return 'unknown';
  }
}

/**
 * `src` null means the source is still being prepared (e.g. decrypted): the
 * player shows loading. `srcError` reports a source that could not be prepared.
 */
export function useAudioPlayer(
  src: string | null,
  nextSrc: string | null,
  srcError: AudioErrorCode | null = null,
): AudioPlayer {
  const [audio] = useState(() => {
    const a = new Audio();
    a.preload = 'auto';
    a.controls = false;
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.disableRemotePlayback = true;
    return a;
  });

  const holdingRef = useRef(false);
  const errorRef = useRef<AudioErrorCode | null>(null);
  const loadTokenRef = useRef(0);
  const unlockedRef = useRef(false);
  const preloaderRef = useRef<HTMLAudioElement | null>(null);

  const [status, setStatus] = useState<PlayerStatus>('loading');
  const [holding, setHolding] = useState(false);
  const [error, setErrorState] = useState<AudioErrorCode | null>(null);
  const [notice, setNotice] = useState<PlayerNotice | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const setError = useCallback((message: AudioErrorCode | null) => {
    errorRef.current = message;
    setErrorState(message);
    if (message) setStatus('error');
  }, []);

  /** Status for a paused element, derived from its position. */
  const idleStatus = useCallback((): PlayerStatus => {
    if (errorRef.current) return 'error';
    if (audio.ended) return 'ended';
    return audio.currentTime > 0 ? 'paused' : 'ready';
  }, [audio]);

  const setIntent = useCallback((value: boolean) => {
    holdingRef.current = value;
    setHolding(value);
  }, []);

  const release = useCallback(() => {
    setIntent(false);
    // Always call pause(), even if `paused` is already true: a pending play()
    // request is aborted by pause(), so a quick tap can never leave audio running.
    audio.pause();
  }, [audio, setIntent]);

  const press = useCallback(() => {
    if (holdingRef.current) return;
    setNotice(null);
    if (errorRef.current) return;
    // Nothing to play yet (source still being decrypted): ignore the press.
    if (!audio.getAttribute('src')) return;
    setIntent(true);

    const token = loadTokenRef.current;
    audio.muted = false;
    if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) setStatus('buffering');

    let pending: Promise<void> | undefined;
    try {
      // Must be called synchronously inside the pointer handler (mobile autoplay rules).
      pending = audio.play();
    } catch {
      setIntent(false);
      return;
    }
    pending
      ?.then(() => {
        unlockedRef.current = true;
        // The finger may have lifted (or the song changed) while play() was pending.
        if (!holdingRef.current || token !== loadTokenRef.current) audio.pause();
      })
      .catch((err: DOMException) => {
        if (token !== loadTokenRef.current) return;
        if (err?.name === 'AbortError') return; // interrupted by pause(): expected on quick taps
        setIntent(false);
        if (err?.name === 'NotAllowedError') {
          setStatus(idleStatus());
          setNotice('blocked');
        } else if (!errorRef.current) {
          setError(describeMediaError(audio.error));
        }
      });
  }, [audio, idleStatus, setError, setIntent]);

  const restart = useCallback(() => {
    setIntent(false);
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      /* not seekable yet; position is already 0 */
    }
    setCurrentTime(0);
    if (!errorRef.current) setStatus((s) => (s === 'loading' ? 'loading' : 'ready'));
  }, [audio, setIntent]);

  // Element event wiring (once).
  useEffect(() => {
    const onPlaying = () => {
      // Safety net: never let audio run without an active hold.
      if (!holdingRef.current) {
        audio.pause();
        return;
      }
      setStatus('playing');
    };
    const onPause = () => setStatus(idleStatus());
    const onWaiting = () => {
      if (holdingRef.current) setStatus('buffering');
    };
    const onEnded = () => {
      setIntent(false);
      setStatus('ended');
    };
    const onLoadStart = () => {
      if (!errorRef.current) setStatus('loading');
    };
    const onCanPlay = () => {
      setStatus((s) => (s === 'loading' ? 'ready' : s));
    };
    const onSuspend = () => {
      // iOS ignores preload and suspends immediately with no data; that still
      // counts as ready because loading starts on the first press.
      if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) setStatus((s) => (s === 'loading' ? 'ready' : s));
    };
    const onError = () => {
      if (!audio.getAttribute('src')) return;
      setIntent(false);
      setError(describeMediaError(audio.error));
    };
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (!holdingRef.current && !audio.paused) audio.pause();
    };
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);

    const events: [string, () => void][] = [
      ['playing', onPlaying],
      ['pause', onPause],
      ['waiting', onWaiting],
      ['ended', onEnded],
      ['loadstart', onLoadStart],
      ['loadedmetadata', onCanPlay],
      ['canplay', onCanPlay],
      ['suspend', onSuspend],
      ['error', onError],
      ['timeupdate', onTime],
      ['seeked', onTime],
      ['durationchange', onDuration],
    ];
    events.forEach(([name, fn]) => audio.addEventListener(name, fn));
    return () => events.forEach(([name, fn]) => audio.removeEventListener(name, fn));
  }, [audio, idleStatus, setError, setIntent]);

  // Load a new track whenever the source changes: stop, reset, never autoplay.
  useEffect(() => {
    const token = ++loadTokenRef.current;
    setIntent(false);
    audio.pause();
    setError(null);
    setNotice(null);
    setCurrentTime(0);
    setDuration(0);

    if (srcError || !src) {
      audio.removeAttribute('src');
      audio.load();
      if (srcError) setError(srcError);
      else setStatus('loading');
      return;
    }

    setStatus('loading');
    audio.src = src;
    audio.load(); // resets position to 0 and starts (optional) preloading
    applyNeutralMediaSession(release);

    // iOS won't fetch media until the first play, so check the file exists up
    // front to show a missing-file error immediately (in-memory blob: sources exist).
    if (src.startsWith('blob:')) return;
    fetch(src, { method: 'HEAD', cache: 'no-store' })
      .then((res) => {
        if (token !== loadTokenRef.current) return;
        const type = res.headers.get('content-type') ?? '';
        // Dev servers and SPA hosts often answer unknown paths with index.html.
        if (!res.ok || type.includes('text/html')) {
          console.warn(`[RiffOff] audio not found (HTTP ${res.status})`);
          setIntent(false);
          audio.pause();
          setError('notFound');
        }
      })
      .catch(() => {
        /* offline or HEAD unsupported: rely on the media element's own error */
      });
  }, [audio, src, srcError, release, setError, setIntent]);

  // Warm the cache for the next track once the current one has settled.
  // The preloader is a separate, muted element that is never played.
  const settled = status !== 'loading';
  useEffect(() => {
    if (!nextSrc || !settled) return;
    const timer = window.setTimeout(() => {
      if (preloaderRef.current?.getAttribute('src') === nextSrc) return;
      const preloader = new Audio();
      preloader.preload = 'auto';
      preloader.muted = true;
      preloader.src = nextSrc;
      preloaderRef.current = preloader;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [nextSrc, settled]);

  // Pause whenever the app is hidden, loses focus, or is being unloaded.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') release();
    };
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', onHidden);
    document.addEventListener('freeze', release);
    return () => {
      window.removeEventListener('blur', release);
      window.removeEventListener('pagehide', release);
      document.removeEventListener('visibilitychange', onHidden);
      document.removeEventListener('freeze', release);
      audio.pause();
    };
  }, [audio, release]);

  // One-time audio unlock. Chrome on Android does not treat a touch
  // `pointerdown` as user activation, and iOS unlocks media per element, so the
  // first tap anywhere (including the release of a hold) briefly plays the
  // element muted. Every later press can then start sound immediately.
  useEffect(() => {
    const unlock = () => {
      if (unlockedRef.current || holdingRef.current || errorRef.current) return;
      if (!audio.getAttribute('src') || !audio.paused || audio.ended) return;
      unlockedRef.current = true;
      const position = audio.currentTime;
      const token = loadTokenRef.current;
      audio.muted = true;
      let pending: Promise<void> | undefined;
      try {
        pending = audio.play();
      } catch {
        unlockedRef.current = false;
        audio.muted = false;
        return;
      }
      const finish = (ok: boolean) => {
        if (!ok) unlockedRef.current = false;
        // If the host started holding meanwhile, press() has already unmuted.
        if (holdingRef.current) return;
        audio.pause();
        audio.muted = false;
        if (token === loadTokenRef.current) {
          try {
            audio.currentTime = position;
          } catch {
            /* ignore */
          }
          setStatus(idleStatus());
        }
      };
      pending?.then(
        () => finish(true),
        (err: DOMException) => finish(err?.name !== 'NotAllowedError'),
      );
    };
    const events = ['pointerup', 'touchend', 'click', 'keydown'] as const;
    // Bubble phase on purpose: the hold button's own pointerup releases first.
    events.forEach((e) => document.addEventListener(e, unlock));
    return () => events.forEach((e) => document.removeEventListener(e, unlock));
  }, [audio, idleStatus]);

  return { status, holding, error, notice, currentTime, duration, press, release, restart };
}
