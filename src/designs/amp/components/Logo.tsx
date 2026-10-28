import { useI18n } from '../../../core/i18n';

/** Chrome amp-badge wordmark with the tagline engraved underneath. */
export function Logo({ large = false }: { large?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`logo ${large ? 'logo-large' : ''}`}>
      <h1 className="logo-badge" dir="ltr" lang="en">
        <span className="logo-word">
          Riff<span className="logo-off">Off</span>
        </span>
        <svg className="logo-tail" viewBox="0 0 120 10" preserveAspectRatio="none" aria-hidden="true">
          <path d="M2 7 C 30 9, 70 2, 118 3" />
        </svg>
      </h1>
      <p className="logo-tagline">{t.tagline}</p>
    </div>
  );
}
