import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Segmented } from '../components/Segmented';
import { useT, type Messages } from '../i18n';
import { ApiRequestError, fetchLeaderboard } from '../lib/api/client';
import { LIMITS, type LeaderboardResponse } from '../lib/api/contract';
import { dayKey } from '../lib/daily';
import { leaderboard, type LeaderboardEntry, type Period } from '../lib/leaderboard';
import { playerName, PlayerNameError, savePlayerName } from '../lib/runFinish';
import { formatRecord } from '../lib/season';
import { useToast } from '../state/Toast';
import { useFieldError } from '../state/useFieldError';
import { isChallengeKey, useApiOnline } from '../state/useChallengeRun';
import type { ChallengeKey, Record3 } from '../types';
import '../styles/run.css';
import '../styles/daily.css';

const CHALLENGES: ChallengeKey[] = ['c340', 'daily', 'retro340', 'c151'];
const PLAY_LINK: Record<ChallengeKey, string> = { c340: '/challenge', daily: '/taeglich', retro340: '/151', c151: '/151' };
const LIMIT = 50;

type Source = 'online' | 'local';

/** Tägliche Elf zeigt standardmäßig den heutigen Tag, alle anderen die Allzeit-Wertung. */
const defaultPeriod = (c: ChallengeKey): Period => (c === 'daily' ? 'today' : 'all');

/** Eine Tabellenzeile – gemeinsam für Online- und Geräte-Ansicht. */
interface BoardRow {
  key: string;
  rank: number;
  player: string;
  teamName: string;
  record: Record3;
  points: number;
  score: number;
  me: boolean;
}

/** Fehler einer Abfrage: Code der API (falls vorhanden) + deutsche Meldung – übersetzt wird beim Anzeigen. */
interface LoadError {
  code: string | null;
  message: string;
}

/** Ergebnis einer Abfrage, gebunden an ihren Schlüssel (Challenge/Zeitraum/Neuladen). */
type Loaded<T> = { key: string; data: T; error?: undefined } | { key: string; data?: undefined; error: LoadError };

const loadError = (e: unknown): LoadError => ({
  code: e instanceof ApiRequestError ? e.code : null,
  message: e instanceof Error ? e.message : String(e),
});

/** Fehlertext in der aktiven Sprache (Deutsch: unverändert die Meldung). */
const errorText = (t: Messages, e: LoadError) => t.leaderboard.apiError(e.code, e.message);

/** „Heute · 12.10.2026" bzw. „Allzeit" */
const periodText = (t: Messages, period: Period, day: string) =>
  period === 'today' ? t.leaderboard.todayOn(t.game.day(day)) : t.leaderboard.allTime;

function BoardTable({ rows, mine }: { rows: BoardRow[]; mine: BoardRow | null }) {
  const t = useT();
  const line = (r: BoardRow) => (
    <tr key={r.key} className={r.me ? 'is-user' : ''} aria-current={r.me ? 'true' : undefined}>
      <td>{r.rank}</td>
      <td className="left">
        <strong>{r.player}</strong>
        {r.teamName && <span className="rating">{r.teamName}</span>}
      </td>
      <td className="mono">{formatRecord(r.record)}</td>
      <td>{r.points}</td>
      <td>
        <strong>{r.score}</strong>
      </td>
    </tr>
  );
  return (
    <div className="table-scroll">
      <table className="league-table leaderboard__table">
        <thead>
          <tr>
            <th scope="col">{t.leaderboard.colRank}</th>
            <th scope="col" className="left">
              {t.leaderboard.colPlayer}
            </th>
            <th scope="col">{t.leaderboard.colRecord}</th>
            <th scope="col">{t.leaderboard.colPoints}</th>
            <th scope="col">{t.leaderboard.colScore}</th>
          </tr>
        </thead>
        <tbody>{rows.map(line)}</tbody>
        {mine && (
          <tbody className="lb-mine">
            <tr className="lb-mine__label">
              <th scope="rowgroup" colSpan={5} className="left">
                {t.leaderboard.yourRank}
              </th>
            </tr>
            {line(mine)}
          </tbody>
        )}
      </table>
    </div>
  );
}

function EmptyBoard({ challenge, children }: { challenge: ChallengeKey; children: ReactNode }) {
  const t = useT();
  return (
    <div className="empty">
      <p>{children}</p>
      <Link className="btn btn--primary" to={PLAY_LINK[challenge]}>
        {t.leaderboard.playNow}
      </Link>
    </div>
  );
}

/** Online-Rangliste (Cloudflare) – nur Runs, die online gestartet wurden. */
function OnlineBoard({ challenge, period, reload, onRetry }: { challenge: ChallengeKey; period: Period; reload: number; onRetry: () => void }) {
  const t = useT();
  const key = `${challenge}:${period}:${reload}`;
  const [loaded, setLoaded] = useState<Loaded<LeaderboardResponse> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard(challenge, period, LIMIT).then(
      (data) => alive && setLoaded({ key, data }),
      (e: unknown) => alive && setLoaded({ key, error: loadError(e) }),
    );
    return () => {
      alive = false;
    };
  }, [challenge, period, key]);

  const current = loaded?.key === key ? loaded : null;
  const day = current?.data?.day ?? dayKey();
  const players = current?.data?.players;
  const meta = [periodText(t, period, day)];
  if (players) meta.push(t.leaderboard.players(players));

  const toRow = (r: LeaderboardResponse['rows'][number]): BoardRow => ({
    key: r.entryId,
    rank: r.rank,
    player: r.player,
    teamName: r.teamName,
    record: r.record,
    points: r.points,
    score: r.score,
    me: r.me,
  });

  let body: ReactNode;
  if (!current) {
    body = <p className="muted">{t.leaderboard.loading}</p>;
  } else if (current.error != null) {
    body = (
      <div className="notice notice--error lb-error" role="alert">
        <span>{t.leaderboard.loadError(errorText(t, current.error))}</span>
        <button type="button" className="btn btn--small" onClick={onRetry}>
          {t.leaderboard.retry}
        </button>
      </div>
    );
  } else if (current.data.rows.length === 0) {
    body = <EmptyBoard challenge={challenge}>{t.leaderboard.emptyOnline}</EmptyBoard>;
  } else {
    const { rows, mine } = current.data;
    const outside = mine && !rows.some((r) => r.me) ? toRow(mine) : null;
    body = <BoardTable rows={rows.map(toRow)} mine={outside} />;
  }

  return (
    <>
      <p className="lb-meta" aria-live="polite">
        {meta.join(' · ')}
      </p>
      {body}
    </>
  );
}

/** Runs dieses Geräts (lokale Historie) – bester Run je Spielername. */
function LocalBoard({ challenge, period, me }: { challenge: ChallengeKey; period: Period; me: string }) {
  const t = useT();
  const key = `${challenge}:${period}`;
  const [loaded, setLoaded] = useState<Loaded<LeaderboardEntry[]> | null>(null);

  useEffect(() => {
    let alive = true;
    leaderboard.top(challenge, period, LIMIT).then(
      (data) => alive && setLoaded({ key, data }),
      (e: unknown) => alive && setLoaded({ key, error: loadError(e) }),
    );
    return () => {
      alive = false;
    };
  }, [challenge, period, key]);

  const current = loaded?.key === key ? loaded : null;
  const self = me.trim().toLowerCase();

  let body: ReactNode;
  if (!current) {
    body = <p className="muted">{t.leaderboard.loading}</p>;
  } else if (current.error != null) {
    body = <p className="notice notice--error">{t.leaderboard.localError(errorText(t, current.error))}</p>;
  } else if (current.data.length === 0) {
    body = (
      <EmptyBoard challenge={challenge}>
        {period === 'today' ? t.leaderboard.emptyLocalToday : t.leaderboard.emptyLocal}
      </EmptyBoard>
    );
  } else {
    const rows = current.data.map(
      (e, i): BoardRow => ({
        key: e.id,
        rank: i + 1,
        player: e.player,
        teamName: e.teamName,
        record: e.record,
        points: e.points,
        score: e.score,
        me: e.player.trim().toLowerCase() === self,
      }),
    );
    body = <BoardTable rows={rows} mine={null} />;
  }

  return (
    <>
      <p className="lb-meta">{t.leaderboard.localMeta(periodText(t, period, dayKey()))}</p>
      {body}
    </>
  );
}

/**
 * Rangliste: online (Cloudflare D1, bester Run je Gerät) oder die Runs dieses Geräts.
 * Deep-Links: /rangliste?c=<challenge>&p=<today|all>
 */
export function Leaderboard() {
  const t = useT();
  const toast = useToast();
  const apiOnline = useApiOnline();
  const [params, setParams] = useSearchParams();
  const rawC = params.get('c');
  const challenge: ChallengeKey = isChallengeKey(rawC) ? rawC : 'c340';
  const rawP = params.get('p');
  const period: Period = rawP === 'today' || rawP === 'all' ? rawP : defaultPeriod(challenge);
  const [source, setSource] = useState<Source>('online');
  const [reload, setReload] = useState(0);
  const [name, setName] = useState(playerName);
  const [savedName, setSavedName] = useState(playerName);
  const [saving, setSaving] = useState(false);
  /** Name abgelehnt (leer, „Trainer", vom Server) – Meldung direkt am Feld */
  const nameError = useFieldError();
  const online = apiOnline === true && source === 'online';

  const select = (c: ChallengeKey, p: Period) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('c', c);
        next.set('p', p);
        return next;
      },
      { replace: true },
    );
  };

  const onSaveName = async () => {
    setSaving(true);
    nameError.clear();
    try {
      const res = await savePlayerName(name, null);
      const clean = playerName();
      setName(clean);
      setSavedName(clean);
      if (res.online) {
        toast(t.leaderboard.nameSavedOnline);
        setReload((r) => r + 1);
      } else {
        toast(apiOnline ? t.leaderboard.nameSavedNotOnline : t.leaderboard.nameSaved);
      }
    } catch (e) {
      if (e instanceof PlayerNameError) {
        nameError.fail(e.message);
      } else {
        toast(t.leaderboard.nameSaveFailed);
      }
    } finally {
      setSaving(false);
    }
  };

  let notice: ReactNode;
  if (apiOnline == null) {
    notice = (
      <p className="runnet runnet--checking" role="status">
        <span className="runnet__dot" aria-hidden="true" />
        {t.leaderboard.checking}
      </p>
    );
  } else if (!apiOnline) {
    notice = <p className="notice">{t.leaderboard.serverDown}</p>;
  } else if (source === 'online') {
    notice = <p className="notice">{t.leaderboard.noticeOnline}</p>;
  } else {
    notice = <p className="notice">{t.leaderboard.noticeLocal}</p>;
  }

  return (
    <div className="page leaderboard">
      <header className="page-head">
        <h1 className="page-title">{t.leaderboard.title}</h1>
        <p className="page-lead">{t.leaderboard.lead}</p>
      </header>

      <div className="lb-top">
        {notice}
        {apiOnline && (
          <Segmented
            label={t.leaderboard.sourceLabel}
            hideLabel
            value={source}
            onChange={setSource}
            options={[
              { value: 'online', label: t.leaderboard.sourceOnline },
              { value: 'local', label: t.leaderboard.sourceLocal },
            ]}
          />
        )}
      </div>

      <div className="leaderboard__controls">
        <div className="tabs-inline" role="tablist" aria-label={t.leaderboard.challengeTabs}>
          {CHALLENGES.map((c) => (
            <button
              key={c}
              role="tab"
              type="button"
              aria-selected={challenge === c}
              className={`tab-inline ${challenge === c ? 'is-active' : ''}`}
              onClick={() => select(c, defaultPeriod(c))}
            >
              {t.game.challenge[c]}
            </button>
          ))}
        </div>
        <Segmented
          label={t.leaderboard.periodLabel}
          hideLabel
          value={period}
          onChange={(p) => select(challenge, p)}
          options={[
            { value: 'today', label: t.leaderboard.today },
            { value: 'all', label: t.leaderboard.allTime },
          ]}
        />
      </div>

      <section className="card" role="tabpanel" aria-label={t.game.challenge[challenge]}>
        {apiOnline == null ? (
          <p className="muted">{t.leaderboard.loading}</p>
        ) : online ? (
          <OnlineBoard
            challenge={challenge}
            period={period}
            reload={reload}
            onRetry={() => setReload((r) => r + 1)}
          />
        ) : (
          <LocalBoard challenge={challenge} period={period} me={savedName} />
        )}
      </section>

      <form
        className="card namefield"
        onSubmit={(e) => {
          e.preventDefault();
          void onSaveName();
        }}
      >
        <label className="field__label" htmlFor="lb-name">
          {t.leaderboard.nameLabel}
        </label>
        <div className="namefield__row">
          <input
            id="lb-name"
            ref={nameError.ref}
            className="input"
            maxLength={LIMITS.playerMax}
            value={name}
            autoComplete="nickname"
            aria-required="true"
            aria-invalid={nameError.error ? true : undefined}
            aria-describedby={nameError.error ? 'lb-name-error' : undefined}
            onChange={(e) => {
              setName(e.target.value);
              nameError.clear();
            }}
          />
          <button type="submit" className="btn" disabled={saving} aria-busy={saving}>
            {t.leaderboard.save}
          </button>
        </div>
        {nameError.error && (
          <p id="lb-name-error" key={nameError.error.attempt} className="field__error" role="alert">
            {nameError.error.message}
          </p>
        )}
        <p className="muted small lb-namehint">{apiOnline ? t.leaderboard.nameHintOnline : t.leaderboard.nameHintLocal}</p>
      </form>
    </div>
  );
}
