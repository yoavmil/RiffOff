import type { ReactNode } from 'react';
import { useI18n } from '../../core/i18n';
import { holdLabels, playlistErrorText, statusText } from '../../core/text';
import { useGame } from '../../core/useGame';
import { useLibrary } from '../../core/useLibrary';
import type { Song } from '../../core/songs';
import { ControlPanel } from './components/ControlPanel';
import { LockScreen } from './components/LockScreen';
import { Logo } from './components/Logo';
import { Nameplate } from './components/Nameplate';
import { Pedal } from './components/Pedal';
import { SettingsSheet } from './components/SettingsSheet';
import { SetupScreen } from './components/SetupScreen';

export default function App() {
  const { t } = useI18n();
  const library = useLibrary();

  if (library.loadError) {
    return (
      <div className="amp amp-message">
        <Logo large />
        <div className="notice-plate is-error" data-testid="playlist-error" role="alert">
          <span className="notice-fuse" aria-hidden="true" />
          <strong>{t.playlistProblem}</strong>
          <p>{playlistErrorText(library.loadError, t)}</p>
        </div>
      </div>
    );
  }
  if (library.locked) return <LockScreen unlock={library.unlock} />;
  if (!library.songs) {
    return (
      <div className="amp amp-message">
        <Logo large />
        <p className="warming-up">
          <span className="tube-glow" aria-hidden="true" />
          {t.tuningUp}
        </p>
      </div>
    );
  }
  if (!library.setupDone) {
    return (
      <SetupScreen
        songs={library.songs}
        filters={library.filters}
        solo={library.solo}
        onSoloChange={library.setSolo}
        onStart={library.startGame}
      />
    );
  }

  return (
    <>
      {library.playlist.length > 0 ? (
        <Game
          key={library.gameKey}
          songs={library.playlist}
          solo={library.solo}
          onOpenSettings={library.openSettings}
        />
      ) : (
        <div className="amp amp-empty">
          <Header onOpenSettings={library.openSettings} />
          <div className="empty-wrap">
            <div className="notice-plate" data-testid="empty-state">
              <span className="notice-jack" aria-hidden="true" />
              <p>{t.noMatches}</p>
              <button type="button" className="key key-primary" onClick={library.openSettings}>
                <span className="key-lamp" aria-hidden="true" />
                {t.changeFilters}
              </button>
            </div>
          </div>
        </div>
      )}
      {library.settingsOpen && (
        <SettingsSheet
          songs={library.songs}
          filters={library.filters}
          solo={library.solo}
          onSoloChange={library.setSolo}
          onClose={library.closeSettings}
        />
      )}
    </>
  );
}

function Game({ songs, solo, onOpenSettings }: { songs: Song[]; solo: boolean; onOpenSettings: () => void }) {
  const { t } = useI18n();
  const game = useGame(songs, { solo });
  const { player } = game;
  const { label, sublabel } = holdLabels(player, t);

  return (
    <div className="amp">
      <Header
        onOpenSettings={() => {
          player.release();
          onOpenSettings();
        }}
      >
        <div className="counter" data-testid="song-counter" data-position={`${game.index + 1}/${game.count}`}>
          <span className="counter-label">{t.song}</span>
          <bdi dir="ltr" className="counter-num">
            <b>{game.index + 1}</b>
            <span className="counter-sep">/</span>
            {game.count}
          </bdi>
        </div>
      </Header>

      <Nameplate
        song={game.song}
        previewing={game.previewing}
        revealed={game.revealed}
        selectionKey={game.selection}
        previewMs={game.previewMs}
      />

      <main className="stage">
        <Pedal player={player} progress={game.progress} label={label} sublabel={sublabel} />
        <div
          className={`status-strip is-${player.status}`}
          data-testid="status"
          data-status={player.status}
          role="status"
          aria-live="polite"
        >
          <span className="status-lamp" aria-hidden="true" />
          <span className="status-text">{statusText(player, t)}</span>
        </div>
      </main>

      <ControlPanel
        revealed={game.revealed}
        onReveal={game.reveal}
        onRestart={player.restart}
        canPrevious={game.canPrevious}
        canNext={game.canNext}
        onPrevious={game.previous}
        onNext={game.next}
      />
    </div>
  );
}

function Header({ onOpenSettings, children }: { onOpenSettings: () => void; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="topbar">
      <Logo />
      <div className="topbar-side">
        {children}
        <button
          type="button"
          className="knob-button"
          data-testid="settings-open"
          aria-label={t.settings}
          onClick={onOpenSettings}
        >
          <span className="knob-cap" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 7h8M17 7h2M5 12h3M12 12h7M5 17h10M19 17h0" />
              <circle cx="15" cy="7" r="2" />
              <circle cx="10" cy="12" r="2" />
              <circle cx="17" cy="17" r="2" />
            </svg>
          </span>
        </button>
      </div>
    </header>
  );
}
