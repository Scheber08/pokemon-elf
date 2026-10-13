import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DraftLive } from '../components/DraftLive';
import { DraftLobby } from '../components/DraftLobby';
import { DraftSeasonStage } from '../components/DraftSeasonStage';
import { RunNotice } from '../components/RunBoard';
import { useT } from '../i18n';
import { isDraftCode, normalizeDraftCode } from '../lib/api/draftClient';
import { DRAFT_LIMITS } from '../lib/api/draftContract';
import { draftRoomReady, useDraftRoom, type DraftRoomStatus } from '../state/useDraftRoom';
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

/** /draft/:code – Lobby, Live-Draft, gemeinsame Saison und Ergebnis einer Online-Liga. */
export function DraftRoom() {
  const { code: raw = '' } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const code = normalizeDraftCode(raw);
  const room = useDraftRoom(code);
  const s = room.state;

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
          {s && <p className="page-lead">{t.online.phaseLead[s.phase]}</p>}
        </div>
        <ConnectionPill status={room.status} failed={failed} onReconnect={room.reconnect} />
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
