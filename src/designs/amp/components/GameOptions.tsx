import { useI18n } from '../../../core/i18n';
import { DECADES } from '../../../core/songs';
import type { SettingsDraft } from '../../../core/useSettingsDraft';

interface Props {
  draft: SettingsDraft;
  solo: boolean;
  onSoloChange: (solo: boolean) => void;
}

/** Game mode, song language and decade selectors, shared by the setup screen and the settings sheet. */
export function GameOptions({ draft: s, solo, onSoloChange }: Props) {
  const { t } = useI18n();

  return (
    <>
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
    </>
  );
}

/** The "N songs match" lamp. */
export function MatchCount({ matches }: { matches: number }) {
  const { t } = useI18n();
  return (
    <p
      className={`sheet-count ${matches === 0 ? 'is-empty' : ''}`}
      role="status"
      data-testid="match-count"
      data-matches={matches}
    >
      <span className="sheet-count-lamp" aria-hidden="true" />
      {matches === 0 ? t.noMatches : t.matchCount(matches)}
    </p>
  );
}
