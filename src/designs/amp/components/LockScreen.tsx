import { useState } from 'react';
import type { FormEvent } from 'react';
import { useI18n } from '../../../core/i18n';
import { Logo } from './Logo';

interface Props {
  unlock: (password: string) => Promise<boolean>;
}

/** Landing page for the password-protected cloud library: a locked amp nameplate. */
export function LockScreen({ unlock }: Props) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setWrong(false);
    const ok = await unlock(password);
    setBusy(false);
    if (!ok) {
      setWrong(true);
      setPassword('');
    }
  };

  return (
    <div className="amp amp-message">
      <Logo large />
      <form className="notice-plate lock-plate" data-testid="lock-screen" onSubmit={submit}>
        <span className="lock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="5" y="10.5" width="14" height="10" rx="2" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            <circle cx="12" cy="15.5" r="1.4" />
          </svg>
        </span>
        <strong className="lock-title">{t.lockTitle}</strong>
        <p>{t.lockPrompt}</p>
        <label className="lock-field">
          <span className="lock-label">{t.passwordLabel}</span>
          <input
            className={`lock-input ${wrong ? 'is-wrong' : ''}`}
            data-testid="unlock-input"
            type="password"
            autoComplete="current-password"
            autoFocus
            dir="ltr"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setWrong(false);
            }}
          />
        </label>
        <p className="lock-error" data-testid="unlock-error" role="alert" aria-live="assertive">
          {wrong ? t.wrongPassword : ' '}
        </p>
        <button
          type="submit"
          className="key key-primary"
          data-testid="unlock-submit"
          disabled={busy || !password}
        >
          <span className="key-lamp" aria-hidden="true" />
          {busy ? t.unlocking : t.unlockButton}
        </button>
      </form>
    </div>
  );
}
