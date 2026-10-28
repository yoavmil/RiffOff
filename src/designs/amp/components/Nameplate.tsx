import { useI18n } from '../../../core/i18n';
import type { Song } from '../../../core/songs';

interface Props {
  song: Song;
  previewing: boolean;
  revealed: boolean;
  selectionKey: number;
  previewMs: number;
}

/**
 * The song card: a back-lit amp nameplate mounted on grille cloth.
 * Lit (ivory, warm) while the answer is visible; dark smoked glass while hidden.
 */
export function Nameplate({ song, previewing, revealed, selectionKey, previewMs }: Props) {
  const { t } = useI18n();
  const visible = previewing || revealed;
  const mode = revealed ? 'is-revealed' : previewing ? 'is-preview' : 'is-hidden';

  return (
    <section className={`grille ${mode}`}>
      <div className="plate">
        <span className="plate-screw plate-screw-start" aria-hidden="true" />
        <span className="plate-screw plate-screw-end" aria-hidden="true" />
        <div className="plate-tag">
          <span className="plate-tag-lamp" aria-hidden="true" />
          {revealed ? t.theAnswer : previewing ? t.hostOnly : t.mysteryRiff}
        </div>

        {/* The answer and its tags (hints) are only in the DOM while visible. */}
        {visible ? (
          <div className="plate-body">
            <div className="plate-title" data-testid="song-title" dir="auto" lang={song.language}>
              {song.title}
            </div>
            <div className="plate-artist" data-testid="song-artist" dir="auto" lang={song.language}>
              {song.artist}
            </div>
            <div className="plate-tags">
              <span>{t.languageName[song.language]}</span>
              <span>{t.decadeName[song.decade]}</span>
            </div>
          </div>
        ) : (
          <div className="plate-body" aria-label={t.songHidden}>
            <div className="plate-title is-placeholder" data-testid="song-title">
              ? ? ?
            </div>
            <div className="plate-artist is-placeholder" data-testid="song-artist">
              • • • • •
            </div>
            <div className="plate-tags is-placeholder" aria-hidden="true">
              <span />
              <span />
            </div>
          </div>
        )}

        {previewing && !revealed && (
          <div className="plate-fuse" aria-hidden="true">
            <div key={selectionKey} className="plate-fuse-fill" style={{ animationDuration: `${previewMs}ms` }} />
          </div>
        )}
      </div>
    </section>
  );
}
