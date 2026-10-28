import { useI18n } from '../../../core/i18n';
import type { Filters, Song } from '../../../core/songs';
import { useSettingsDraft } from '../../../core/useSettingsDraft';
import { GameOptions, MatchCount } from './GameOptions';
import { Logo } from './Logo';

interface Props {
  songs: Song[];
  filters: Filters;
  solo: boolean;
  onSoloChange: (solo: boolean) => void;
  onStart: (filters: Filters) => void;
}

/** Second landing page: pick the game mode and filters, then START. */
export function SetupScreen({ songs, filters, solo, onSoloChange, onStart }: Props) {
  const { t } = useI18n();
  const s = useSettingsDraft(songs, filters, onStart, { closeOnEscape: false });

  return (
    <div className="amp amp-setup">
      <Logo large />
      <section className="setup-panel" data-testid="setup-screen" aria-labelledby="amp-setup-title">
        <div className="sheet-head">
          <h2 id="amp-setup-title" className="sheet-title">
            {t.setupTitle}
          </h2>
          <MatchCount matches={s.matches} />
        </div>

        <GameOptions draft={s} solo={solo} onSoloChange={onSoloChange} />

        <button
          type="button"
          className="sheet-done"
          data-testid="setup-start"
          disabled={s.matches === 0}
          onClick={s.close}
        >
          {t.startButton}
        </button>
      </section>
    </div>
  );
}
