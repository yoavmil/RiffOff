import { useI18n } from '../../../core/i18n';
import type { UiLang } from '../../../core/i18n';
import { DECADES } from '../../../core/songs';
import type { Filters, Song } from '../../../core/songs';
import { useSettingsDraft } from '../../../core/useSettingsDraft';

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
          <p
            className={`sheet-count ${s.matches === 0 ? 'is-empty' : ''}`}
            role="status"
            data-testid="match-count"
            data-matches={s.matches}
          >
            <span className="sheet-count-lamp" aria-hidden="true" />
            {s.matches === 0 ? t.noMatches : t.matchCount(s.matches)}
          </p>
        </div>

        <fieldset className="sheet-group">
          <legend>{t.gameMode}</legend>
          <div className="selector selector-2">
            {([false, true] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                data-testid={v ? 'mode-solo' : 'mode-host'}
                className={`sel ${solo === v ? 'is-on' : ''}`}
                aria-pressed={solo === v}
                onClick={() => onSoloChange(v)}
              >
                <span className="sel-lamp" aria-hidden="true" />
                {v ? t.modeSolo : t.modeHost}
              </button>
            ))}
          </div>
          <p className="sel-hint">{solo ? t.modeSoloHint : t.modeHostHint}</p>
        </fieldset>

        <fieldset className="sheet-group">
          <legend>{t.songLanguage}</legend>
          <div className="selector selector-3">
            {(['he', 'en', 'both'] as const).map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`lang-${v}`}
                className={`sel ${s.draft.language === v ? 'is-on' : ''}`}
                aria-pressed={s.draft.language === v}
                onClick={() => s.setLanguage(v)}
              >
                <span className="sel-lamp" aria-hidden="true" />
                {v === 'both' ? t.both : t.languageName[v]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="sheet-group">
          <legend>{t.decades}</legend>
          <div className="decades">
            <button
              type="button"
              data-testid="decade-all"
              className={`sel sel-all ${s.allDecades ? 'is-on' : ''}`}
              aria-pressed={s.allDecades}
              onClick={s.toggleAllDecades}
            >
              <span className="sel-lamp" aria-hidden="true" />
              {t.all}
            </button>
            {DECADES.map((d) => (
              <button
                key={d}
                type="button"
                data-testid={`decade-${d}`}
                className={`sel sel-decade ${s.draft.decades.includes(d) ? 'is-on' : ''}`}
                aria-pressed={s.draft.decades.includes(d)}
                onClick={() => s.toggleDecade(d)}
              >
                <span className="sel-lamp" aria-hidden="true" />
                <bdi dir="ltr">{t.decadeChip[d]}</bdi>
              </button>
            ))}
          </div>
        </fieldset>

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
