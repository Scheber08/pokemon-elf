import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DraftLive } from '../components/DraftLive';
import { DraftLobby } from '../components/DraftLobby';
import { DraftSeasonStage } from '../components/DraftSeasonStage';
import { RunNotice } from '../components/RunBoard';
import { useT } from '../i18n';
import { isDraftCode, normalizeDraftCode } from '../lib/api/draftClient';
import { DRAFT_LIMITS } from '../lib/api/draftContract';
import { previewChime } from '../lib/sound';
import { useSettings } from '../state/Settings';
import { draftRoomReady, useDraftRoom, type DraftRoomStatus } from '../state/useDraftRoom';
import { useTurnSounds } from '../state/useTurnSounds';
import '../styles/draft.css';

/** Verbindungsstatus als kleine Pille (mit „Jetzt verbinden" beim Warten bzw. nach abgelehnter Anmeldung). */
function ConnectionPill({
  status,
  failed,
  onReconnect,
}: {
  status: DraftRoomStatus;
  failed: boolean;
  onReconnect: () => void;
}) {
  const t = useT();
  const offline = failed && status !== 'open';
  return (
    <div className={`draft-conn draft-conn--${offline ? 'failed' : status}`} role="status">
      <span className="draft-conn__dot" aria-hidden="true" />
      <span>{offline ? t.online.connFailed : t.online.status[status]}</span>
      {(offline || status === 'reconnecting' || status === 'closed') && (
        <button type="button" className="draft-conn__retry" onClick={onReconnect}>
          {offline ? t.online.retry : t.online.connectNow}
        </button>
      )}
    </div>
  );
}

/** Ton an/aus (gespeichert) – beim Einschalten zur Probe einmal der Gong. */
function SoundToggle() {
  const t = useT();
  const { sound, setSound } = useSettings();
  return (
    <button
      type="button"
      className={`draft-sound ${sound ? 'is-on' : ''}`}
      aria-pressed={sound}
      title={t.online.soundTitle}
      onClick={() => {
        if (!sound) previewChime();
        setSound(!sound);
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {sound ? (
          <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ) : (
          <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
      <span>{sound ? t.online.soundOn : t.online.soundOff}</span>
    </button>
  );
}

/** /draft/:code – Lobby, Live-Draft, gemeinsame Saison und Ergebnis einer Online-Liga. */
export function DraftRoom() {
  const { code: raw = '' } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const code = normalizeDraftCode(raw);
  const room = useDraftRoom(code);
  const s = room.state;
  const { sound } = useSettings();

  // Gong, wenn man dran ist; Warnton kurz vor Ablauf des Timers
  useTurnSounds({
    enabled: sound,
    live: room.live,
    myTurn: room.myTurn,
    pickIndex: s?.pickIndex ?? -1,
    ownManualLast: !!room.lastPick && !!room.me && room.lastPick.teamId === room.me.id && !room.lastPick.auto,
    deadline: s?.phase === 'drafting' ? s.deadline : null,
    clockOffset: room.clockOffset,
  });

  // Kleinbuchstaben o. Ä. in der Adresse → kanonische Adresse
  useEffect(() => {
    if (raw !== code && isDraftCode(code)) navigate(`/draft/${code}`, { replace: true });
  }, [raw, code, navigate]);

  // Tab-Titel: „(Du bist dran)" vorne, solange man am Zug ist
  const leagueName = s?.settings.name;
  useEffect(() => {
    const base = `${leagueName || t.online.leagueFallback(code)} · Pokémon Elf`;
    document.title = room.myTurn ? t.online.yourTurnTitle(base) : base;
  }, [room.myTurn, leagueName, code, raw, t]);

  if (room.status === 'not_found') {
    return (
      <div className="page draft draft-room">
        <section className="card prose empty draft-notfound">
          <span className="kicker">
            {t.online.onlineLeague} {code || raw}
          </span>
          <h1 className="page-title">{t.online.notFoundTitle}</h1>
          <p>{t.online.notFoundText(DRAFT_LIMITS.retentionDays)}</p>
          <Link className="btn btn--primary" to="/draft">
            {t.online.toDraft}
          </Link>
        </section>
      </div>
    );
  }

  const ready = draftRoomReady(room);
  // Ohne eigenen Schnappschuss bzw. nach endgültiger Trennung nur ansehen: keine Beitreten-Hinweise, keine Host-Aktionen
  const readOnly = !room.live || room.status === 'closed';
  const failed = room.authError != null && room.status !== 'open';
  // Was gerade zu sehen ist: der letzte eigene Stand (live) oder die öffentliche Vorschau
  const shown = room.live ? t.online.shownLive : t.online.shownPublic;

  return (
    <div className="page draft draft-room">
      <header className="page-head draft-room__head">
        <div className="draft-room__title">
          <span className="kicker">
            {t.online.onlineLeague} · <span className="draft-room__code">{code}</span>
          </span>
          <h1 className="page-title">{leagueName || t.online.title}</h1>
          {s && (
            <p className="page-lead">
              {s.phase === 'drafting' && s.settings.snake === false ? t.online.phaseLeadFixed : t.online.phaseLead[s.phase]}
            </p>
          )}
        </div>
        <div className="draft-room__tools">
          <SoundToggle />
          <ConnectionPill status={room.status} failed={failed} onReconnect={room.reconnect} />
        </div>
      </header>

      <div className="draft-room__notices">
        {room.error && (
          <RunNotice error onClose={room.clearError}>
            {room.error}
          </RunNotice>
        )}
        {failed ? (
          <div className="notice notice--error draft-authfail" role="alert">
            <p>
              <strong>{t.online.authFailTitle}</strong>
              <span className="draft-authfail__reason">{t.online.authReason(room.authError ?? '')}</span>
              <span>
                {room.status === 'closed' ? t.online.noAutoRetry : t.online.autoRetry}
                {s ? t.online.untilThen(shown) : ''}
              </span>
            </p>
            <button type="button" className="btn btn--small" onClick={room.reconnect}>
              {t.online.retry}
            </button>
          </div>
        ) : room.status === 'closed' && s ? (
          <div className="notice draft-authfail" role="alert">
            <p>
              <strong>{t.online.closedTitle}</strong>
              <span>{t.online.closedText(shown)}</span>
            </p>
            <button type="button" className="btn btn--small" onClick={room.reconnect}>
              {t.online.continueHere}
            </button>
          </div>
        ) : (
          room.status === 'reconnecting' &&
          s && (
            <RunNotice>
              {room.me ? t.online.lostMember : room.live ? t.online.lost : t.online.lostPreview}
            </RunNotice>
          )
        )}
      </div>

      {!ready ? (
        <div className="boot" role="status" aria-live="polite">
          <div className="boot__ball" aria-hidden="true" />
          <p>
            {room.status === 'closed'
              ? t.online.bootClosed
              : failed
                ? t.online.bootFailed
                : room.status === 'reconnecting'
                  ? t.online.bootUnreachable
                  : t.online.bootConnecting(code)}
          </p>
        </div>
      ) : s!.phase === 'lobby' ? (
        <DraftLobby room={room} readOnly={readOnly} />
      ) : s!.phase === 'drafting' ? (
        <DraftLive room={room} readOnly={readOnly} />
      ) : (
        <DraftSeasonStage key={s!.season?.seed ?? 0} room={room} />
      )}
    </div>
  );
}
