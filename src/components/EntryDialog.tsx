import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { ApiRequestError, fetchEntry } from '../lib/api/client';
import type { EntryDetail } from '../lib/api/contract';
import { isDayKey } from '../lib/daily';
import { builderSearch } from '../lib/leaderboard/entryDetail';
import { formatRecord } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import type { ChallengeKey, FormationId, Record3 } from '../types';
import { FriendlyMatch } from './FriendlyMatch';
import { Modal } from './Modal';
import { Pitch } from './Pitch';
import { TeamSheet } from './TeamSheet';
import '../styles/leaderboard.css';

/** Was die Tabellenzeile schon weiß – sofort sichtbar, auch während das Team noch lädt. */
export interface EntrySummary {
  challenge: ChallengeKey;
  /** Tag des Runs (YYYY-MM-DD, Europe/Berlin) – '' wenn unbekannt */
  day: string;
  player: string;
  teamName: string;
  record: Record3;
  points: number;
  score: number;
  formation: FormationId;
  /** Platz in der angezeigten Wertung */
  rank: number | null;
}

/** Woher das Team kommt */
export type EntrySource =
  /** Online-Rangliste: Team per GET /api/entries/:id */
  | { kind: 'online'; entryId: string; summary: EntrySummary }
  /** Run dieses Geräts: Das Team liegt lokal vor (null = gespeicherte Daten nicht lesbar) */
  | { kind: 'local'; detail: EntryDetail | null; summary: EntrySummary };

type Status =
  | { status: 'loading' }
  | { status: 'ready'; detail: EntryDetail }
  /** 404: Der Eintrag zählt in keiner Rangliste mehr */
  | { status: 'gone' }
  | { status: 'error'; code: string | null; message: string }
  | { status: 'unreadable' };

const failure = (e: unknown): Status => {
  if (e instanceof ApiRequestError && (e.status === 404 || e.code === 'not_found')) return { status: 'gone' };
  return {
    status: 'error',
    code: e instanceof ApiRequestError ? e.code : null,
    message: e instanceof Error ? e.message : String(e),
  };
};

interface Props {
  source: EntrySource;
  onClose: () => void;
  /** Bei 404: Rangliste neu laden (der Dialog schließt dabei) */
  onReloadBoard?: () => void;
}

/**
 * Team eines Ranglisten-Eintrags im Dialog: Kopfdaten, Spielfeld (nur lesen, Tooltips mit
 * Positions-Hinweisen) und Teamblatt, dazu „Im Builder öffnen" über den Share-Link (?elf=…).
 * Online wird das Team geladen (Laden/Fehler/Erneut versuchen), lokale Runs bringen es mit.
 */
export function EntryDialog({ source, onClose, onReloadBoard }: Props) {
  const t = useT();
  const tr = t.leaderboard.entry;
  const { sprite } = useSettings();
  const { byId } = usePokemonData();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [friendly, setFriendly] = useState(false);
  const onlineId = source.kind === 'online' ? source.entryId : null;
  const key = `${onlineId}:${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; result: Status } | null>(null);

  useEffect(() => {
    if (onlineId == null) return;
    let alive = true;
    fetchEntry(onlineId).then(
      (detail) => alive && setLoaded({ key, result: { status: 'ready', detail } }),
      (e: unknown) => alive && setLoaded({ key, result: failure(e) }),
    );
    return () => {
      alive = false;
    };
  }, [onlineId, key]);

  let state: Status;
  if (source.kind === 'local') {
    state = source.detail ? { status: 'ready', detail: source.detail } : { status: 'unreadable' };
  } else {
    state = loaded?.key === key ? loaded.result : { status: 'loading' };
  }

  const detail = state.status === 'ready' ? state.detail : null;
  // Kopfdaten: geladenes Team bzw. die Zeile, solange es lädt
  const info = detail ?? source.summary;
  // Spielername immer aus der Zeile: Die Rangliste wird ohne Cache geladen (auch neu nach einer
  // Umbenennung), GET /api/entries/:id darf bis zu einer Minute alt sein. Ein Eintrag selbst
  // ändert sich nie – nur der Name seines Geräts. Lokal stimmen Zeile und Run ohnehin überein.
  const player = source.summary.player;
  const title = info.teamName || tr.untitled(player);
  const date = isDayKey(info.day) ? t.game.day(info.day) : null;

  const retry = () => {
    // Fokus im Dialog halten – der Knopf verschwindet beim Laden
    bodyRef.current?.focus({ preventScroll: true });
    setAttempt((a) => a + 1);
  };

  let content: ReactNode;
  switch (state.status) {
    case 'loading':
      content = (
        <p className="muted entry__status" role="status">
          {tr.loading}
        </p>
      );
      break;
    case 'ready': {
      const d = state.detail;
      const ss = d.ssEnabled ? d.ss : undefined;
      content = (
        <div className="entry__team">
          <div className="entry__pitch">
            <Pitch formation={d.formation} slots={d.slots} ss={ss} sprite={sprite} captain={d.captain ?? null} ariaLabel={tr.pitchAria(info.teamName || player, d.formation)} />
          </div>
          <TeamSheet formation={d.formation} slots={d.slots} ss={ss} sprite={sprite} title={tr.sheetTitle} />
        </div>
      );
      break;
    }
    case 'gone':
      content = (
        <div className="notice notice--error entry__error" role="alert">
          <p>
            <strong>{tr.gone}</strong>
          </p>
          {onReloadBoard && (
            <>
              <p className="small">{tr.goneHint}</p>
              <button type="button" className="btn btn--small" onClick={onReloadBoard}>
                {tr.reloadBoard}
              </button>
            </>
          )}
        </div>
      );
      break;
    case 'error':
      content = (
        <div className="notice notice--error lb-error entry__error" role="alert">
          <span>{tr.loadError(t.leaderboard.apiError(state.code, state.message))}</span>
          <button type="button" className="btn btn--small" onClick={retry}>
            {t.leaderboard.retry}
          </button>
        </div>
      );
      break;
    case 'unreadable':
      content = (
        <p className="notice notice--error entry__error" role="alert">
          {tr.unreadable}
        </p>
      );
      break;
  }

  const footer = (
    <div className="entry__actions">
      {detail && (
        <>
          <Link
            className="btn btn--primary"
            to={{ pathname: '/', search: builderSearch(detail, sprite, byId) }}
            aria-describedby="entry-builder-hint"
          >
            {tr.openInBuilder}
          </Link>
          <span id="entry-builder-hint" className="muted small entry__hint">
            {tr.openInBuilderHint}
          </span>
          {!friendly && (
            <button type="button" className="btn" onClick={() => setFriendly(true)}>
              {tr.friendly}
            </button>
          )}
        </>
      )}
      <button type="button" className="btn entry__close" onClick={onClose}>
        {t.common.close}
      </button>
    </div>
  );

  return (
    <Modal title={title} onClose={onClose} labelId="entry-dialog-title" className="entry-dialog" footer={footer}>
      <div className="entry" ref={bodyRef} tabIndex={-1}>
        <p className="entry__meta">
          <span className="kicker">{tr.kicker(t.game.challenge[info.challenge], date)}</span>
          <span className="entry__by">
            {tr.byline(player, source.summary.rank)}
            {onlineId && (
              <>
                {' · '}
                <Link to={`/spieler/${onlineId}`} title={tr.profileTitle(player)} onClick={onClose}>
                  {tr.profile}
                </Link>
              </>
            )}
          </span>
        </p>
        <dl className="facts entry__facts">
          <div>
            <dt>{tr.record}</dt>
            <dd>
              <span aria-hidden="true">{formatRecord(info.record)}</span>
              <span className="sr-only">{tr.recordSpoken(info.record.w, info.record.d, info.record.l)}</span>
            </dd>
          </div>
          <div>
            <dt>{tr.points}</dt>
            <dd>{info.points}</dd>
          </div>
          <div>
            <dt>{tr.score}</dt>
            <dd>{info.score}</dd>
          </div>
          <div>
            <dt>{tr.formation}</dt>
            <dd>{info.formation}</dd>
          </div>
        </dl>
        {content}
        {friendly && detail && (
          <FriendlyMatch
            opponent={{ name: title, formation: detail.formation, slots: detail.slots, ss: detail.ssEnabled ? detail.ss : null, captain: detail.captain ?? null }}
          />
        )}
      </div>
    </Modal>
  );
}
