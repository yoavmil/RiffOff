import { useI18n } from '../../../core/i18n';

interface Props {
  revealed: boolean;
  onReveal: () => void;
  onRestart: () => void;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

const Arrow = () => (
  <svg className="key-arrow" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

/** Brushed-gold amp control panel holding the four secondary actions. */
export function ControlPanel({ revealed, onReveal, onRestart, canPrevious, canNext, onPrevious, onNext }: Props) {
  const { t } = useI18n();
  return (
    <nav className="panel">
      <span className="panel-screw" data-side="start" aria-hidden="true" />
      <span className="panel-screw" data-side="end" aria-hidden="true" />
      <div className="panel-grid">
        <button type="button" className="key key-restart" data-testid="restart" onClick={onRestart}>
          <svg className="key-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.6-5.9" />
            <path d="M4 4v4.5h4.5" />
          </svg>
          {t.restartRiff}
        </button>
        <button
          type="button"
          className={`key key-primary ${revealed ? 'is-lit' : ''}`}
          data-testid="reveal"
          onClick={onReveal}
          disabled={revealed}
        >
          <span className="key-lamp" aria-hidden="true" />
          {revealed ? t.answerRevealed : t.revealAnswer}
        </button>
        <button type="button" className="key key-nav key-prev" data-testid="prev" disabled={!canPrevious} onClick={onPrevious}>
          <Arrow />
          {t.previous}
        </button>
        <button type="button" className="key key-nav key-next" data-testid="next" disabled={!canNext} onClick={onNext}>
          {t.next}
          <Arrow />
        </button>
      </div>
    </nav>
  );
}
