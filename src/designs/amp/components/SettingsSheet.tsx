import { useI18n } from '../../../core/i18n';
import type { UiLang } from '../../../core/i18n';
import type { Filters, Song } from '../../../core/songs';
import { useSettingsDraft } from '../../../core/useSettingsDraft';
import { GameOptions, MatchCount } from './GameOptions';

interface Props {
  songs: Song[];
  filters: Filters;
  solo: boolean;
  /** Applies immediately, like the interface language. */
  onSoloChange: (solo: boolean) => void;
  onClose: (filters: Filters) => void;
}

/** Bottom sheet styled as the amp's rear panel: channel selectors with jewel lamps. */
export function SettingsSheet({ songs, filters, solo, onSoloChange, onClose }: Props) {
  const { t, lang, setLang } = useI18n();
  const s = useSettingsDraft(songs, filters, onClose);

  return (
    <div className="sheet-backdrop" onClick={s.close}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="amp-sheet-title"
        data-testid="settings-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="amp-sheet-title" className="sheet-title">
            {t.settings}
          </h2>
          <MatchCount matches={s.matches} />
        </div>

        <GameOptions draft={s} solo={solo} onSoloChange={onSoloChange} />

        <fieldset className="sheet-group">
          <legend>{t.interfaceLanguage}</legend>
          <div className="selector selector-2">
            {(['he', 'en'] as UiLang[]).map((v) => (
              <button
                key={v}
                type="button"
                lang={v}
                dir={v === 'he' ? 'rtl' : 'ltr'}
                data-testid={`ui-${v}`}
                className={`sel ${lang === v ? 'is-on' : ''}`}
                aria-pressed={lang === v}
                onClick={() => setLang(v)}
              >
                <span className="sel-lamp" aria-hidden="true" />
                {v === 'he' ? 'עברית' : 'English'}
              </button>
            ))}
          </div>
        </fieldset>

        <button type="button" className="sheet-done" data-testid="settings-done" onClick={s.close}>
          {t.done}
        </button>
      </div>
    </div>
  );
}
