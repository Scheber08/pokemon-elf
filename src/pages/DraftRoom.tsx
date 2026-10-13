import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DraftLive } from '../components/DraftLive';
import { DraftLobby } from '../components/DraftLobby';
import { DraftSeasonStage } from '../components/DraftSeasonStage';
import { RunNotice } from '../components/RunBoard';
import { isDraftCode, normalizeDraftCode } from '../lib/api/draftClient';
import { DRAFT_LIMITS, type DraftPhase } from '../lib/api/draftContract';
import { draftRoomReady, useDraftRoom, type DraftRoomStatus } from '../state/useDraftRoom';
import '../styles/draft.css';

const PHASE_LEAD: Record<DraftPhase, string> = {
  lobby: 'Lobby – teilt den Code, wählt Teamnamen und Formation. Der Host startet den Draft.',
  drafting: 'Snake-Draft läuft – jeder sieht jeden Pick sofort.',
  done: 'Draft abgeschlossen – die Saison läuft für alle gleichzeitig.',
};

const STATUS_TEXT: Record<DraftRoomStatus, string> = {
  connecting: 'Verbinde …',
  open: 'Verbunden',
  reconnecting: 'Verbinde neu …',
  closed: 'Getrennt',
  not_found: 'Nicht gefunden',
};

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
  const offline = failed && status !== 'open';
  return (
    <div className={`draft-conn draft-conn--${offline ? 'failed' : status}`} role="status">
      <span className="draft-conn__dot" aria-hidden="true" />
      <span>{offline ? 'Verbindung fehlgeschlagen' : STATUS_TEXT[status]}</span>
      {(offline || status === 'reconnecting' || status === 'closed') && (
        <button type="button" className="draft-conn__retry" onClick={onReconnect}>
          {offline ? 'Erneut versuchen' : 'Jetzt verbinden'}
        </button>
      )}
    </div>
  );
}

/** /draft/:code – Lobby, Live-Draft, gemeinsame Saison und Ergebnis einer Online-Liga. */
export function DraftRoom() {
  const { code: raw = '' } = useParams();
  const navigate = useNavigate();
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
    const base = `${leagueName || `Liga ${code}`} · Pokémon Elf`;
    document.title = room.myTurn ? `(Du bist dran) ${base}` : base;
  }, [room.myTurn, leagueName, code, raw]);

  if (room.status === 'not_found') {
    return (
      <div className="page draft draft-room">
        <section className="card prose empty draft-notfound">
          <span className="kicker">Online-Liga {code || raw}</span>
          <h1 className="page-title">Liga nicht gefunden</h1>
          <p>
            Diesen Code gibt es nicht (mehr). Prüf den Link bzw. Code – Ligen werden {DRAFT_LIMITS.retentionDays} Tage
            nach dem Erstellen gelöscht.
          </p>
          <Link className="btn btn--primary" to="/draft">
            Zum Fantasy-Draft
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
  const shown = room.live ? 'deinen letzten Stand' : 'den öffentlichen Stand';

  return (
    <div className="page draft draft-room">
      <header className="page-head draft-room__head">
        <div className="draft-room__title">
          <span className="kicker">
            Online-Liga · <span className="draft-room__code">{code}</span>
          </span>
          <h1 className="page-title">{leagueName || 'Fantasy-Draft'}</h1>
          {s && <p className="page-lead">{PHASE_LEAD[s.phase]}</p>}
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
              <strong>Verbindung fehlgeschlagen – erneut versuchen</strong>
              <span className="draft-authfail__reason">Anmeldung beim Server: {room.authError}</span>
              <span>
                {room.status === 'closed' ? 'Kein automatischer Neuversuch mehr.' : 'Ein neuer Versuch läuft automatisch.'}
                {s ? ` Bis dahin siehst du ${shown} (nur ansehen).` : ''}
              </span>
            </p>
            <button type="button" className="btn btn--small" onClick={room.reconnect}>
              Erneut versuchen
            </button>
          </div>
        ) : room.status === 'closed' && s ? (
          <div className="notice draft-authfail" role="alert">
            <p>
              <strong>Verbindung beendet</strong>
              <span>
                Zum Beispiel, weil die Liga in einem anderen Tab geöffnet wurde. Du siehst {shown} (nur ansehen).
              </span>
            </p>
            <button type="button" className="btn btn--small" onClick={room.reconnect}>
              Hier weitermachen
            </button>
          </div>
        ) : (
          room.status === 'reconnecting' &&
          s && (
            <RunNotice>
              {room.me
                ? 'Verbindung unterbrochen – es wird automatisch neu verbunden. Dein Platz bleibt reserviert.'
                : room.live
                  ? 'Verbindung unterbrochen – es wird automatisch neu verbunden.'
                  : 'Noch keine Live-Verbindung – neuer Versuch läuft. Bis dahin siehst du den öffentlichen Stand (nur ansehen).'}
            </RunNotice>
          )
        )}
      </div>

      {!ready ? (
        <div className="boot" role="status" aria-live="polite">
          <div className="boot__ball" aria-hidden="true" />
          <p>
            {room.status === 'closed'
              ? 'Verbindung beendet – über „Jetzt verbinden" geht es weiter.'
              : failed
                ? 'Verbindung fehlgeschlagen – neuer Versuch läuft …'
                : room.status === 'reconnecting'
                  ? 'Server nicht erreichbar – neuer Versuch läuft …'
                  : `Verbinde mit Liga ${code} …`}
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
