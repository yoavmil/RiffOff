import type { SongLanguage } from '../../../core/songs';

/**
 * Israeli flag for Hebrew songs, a globe for the rest of the world. Inline SVG
 * rather than emoji: Windows renders the flag emoji as the letters "IL".
 */
export function OriginIcon({ origin }: { origin: SongLanguage }) {
  if (origin === 'he') {
    return (
      <svg className="origin-icon" viewBox="0 0 22 16" aria-hidden="true">
        <rect width="22" height="16" rx="2" fill="#fff" />
        <rect y="1.6" width="22" height="2.2" fill="#0038b8" />
        <rect y="12.2" width="22" height="2.2" fill="#0038b8" />
        <path d="M11 4.6l2.9 5.1H8.1zM11 11.4L8.1 6.3h5.8z" fill="none" stroke="#0038b8" strokeWidth="0.9" />
      </svg>
    );
  }
  return (
    <svg className="origin-icon origin-globe" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.6" />
      <ellipse cx="8" cy="8" rx="2.8" ry="6.6" />
      <path d="M1.6 6h12.8M1.6 10h12.8" />
    </svg>
  );
}
