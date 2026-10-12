import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Segmented } from '../components/Segmented';
import { fetchLeaderboard } from '../lib/api/client';
import type { LeaderboardResponse } from '../lib/api/contract';
import { dayKey, formatDay } from '../lib/daily';
import { CHALLENGE_LABEL, leaderboard, type LeaderboardEntry, type Period } from '../lib/leaderboard';
import { playerName, savePlayerName } from '../lib/runFinish';
import { formatRecord } from '../lib/season';
import { useToast } from '../state/Toast';
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

/** Ergebnis einer Abfrage, gebunden an ihren Schlüssel (Challenge/Zeitraum/Neuladen). */
type Loaded<T> = { key: string; data: T; error?: undefined } | { key: string; data?: undefined; error: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function BoardTable({ rows, mine }: { rows: BoardRow[]; mine: BoardRow | null }) {
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
            <th scope="col">Platz</th>
            <th scope="col" className="left">
              Spieler
            </th>
            <th scope="col">Bilanz</th>
            <th scope="col">Pkt</th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>{rows.map(line)}</tbody>
        {mine && (
          <tbody className="lb-mine">
            <tr className="lb-mine__label">
              <th scope="rowgroup" colSpan={5} className="left">
                Deine Platzierung
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
  return (
    <div className="empty">
      <p>{children}</p>
      <Link className="btn btn--primary" to={PLAY_LINK[challenge]}>
        Jetzt spielen
      </Link>
    </div>
  );
}

/** Online-Rangliste (Cloudflare) – nur Runs, die online gestartet wurden. */
function OnlineBoard({ challenge, period, reload, onRetry }: { challenge: ChallengeKey; period: Period; reload: number; onRetry: () => void }) {
  const key = `${challenge}:${period}:${reload}`;
  const [loaded, setLoaded] = useState<Loaded<LeaderboardResponse> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard(challenge, period, LIMIT).then(
      (data) => alive && setLoaded({ key, data }),
      (e: unknown) => alive && setLoaded({ key, error: errorText(e) }),
    );
    return () => {
      alive = false;
    };
  }, [challenge, period, key]);

  const current = loaded?.key === key ? loaded : null;
  const day = current?.data?.day ?? dayKey();
  const players = current?.data?.players;
  const meta = [period === 'today' ? `Heute · ${formatDay(day)}` : 'Allzeit'];
  if (players) meta.push(`${players.toLocaleString('de-DE')} Spieler`);

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
    body = <p className="muted">Lade …</p>;
  } else if (current.error != null) {
    body = (
      <div className="notice notice--error lb-error" role="alert">
        <span>Rangliste nicht erreichbar: {current.error}</span>
        <button type="button" className="btn btn--small" onClick={onRetry}>
          Erneut versuchen
        </button>
      </div>
    );
  } else if (current.data.rows.length === 0) {
    body = <EmptyBoard challenge={challenge}>Noch keine Einträge – sei der Erste!</EmptyBoard>;
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
  const key = `${challenge}:${period}`;
  const [loaded, setLoaded] = useState<Loaded<LeaderboardEntry[]> | null>(null);

  useEffect(() => {
    let alive = true;
    leaderboard.top(challenge, period, LIMIT).then(
      (data) => alive && setLoaded({ key, data }),
      (e: unknown) => alive && setLoaded({ key, error: errorText(e) }),
    );
    return () => {
      alive = false;
    };
  }, [challenge, period, key]);

  const current = loaded?.key === key ? loaded : null;
  const self = me.trim().toLowerCase();

  let body: ReactNode;
  if (!current) {
    body = <p className="muted">Lade …</p>;
  } else if (current.error != null) {
    body = <p className="notice notice--error">Runs dieses Geräts nicht lesbar: {current.error}</p>;
  } else if (current.data.length === 0) {
    body = (
      <EmptyBoard challenge={challenge}>
        {period === 'today' ? 'Heute noch keine Runs auf diesem Gerät.' : 'Noch keine Runs auf diesem Gerät.'}
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
      <p className="lb-meta">
        {period === 'today' ? `Heute · ${formatDay(dayKey())}` : 'Allzeit'} · nur dieses Gerät, auch ungewertete Runs
      </p>
      {body}
    </>
  );
}

/**
 * Rangliste: online (Cloudflare D1, bester Run je Gerät) oder die Runs dieses Geräts.
 * Deep-Links: /rangliste?c=<challenge>&p=<today|all>
 */
export function Leaderboard() {
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
    try {
      const res = await savePlayerName(name, null);
      const clean = playerName();
      setName(clean);
      setSavedName(clean);
      if (res.online) {
        toast('Name gespeichert – auch online aktualisiert');
        setReload((r) => r + 1);
      } else {
        toast(apiOnline ? 'Name gespeichert – online gerade nicht möglich' : 'Name gespeichert');
      }
    } catch {
      toast('Name konnte nicht gespeichert werden');
    } finally {
      setSaving(false);
    }
  };

  let notice: ReactNode;
  if (apiOnline == null) {
    notice = (
      <p className="runnet runnet--checking" role="status">
        <span className="runnet__dot" aria-hidden="true" />
        Verbindung zur Online-Rangliste wird geprüft …
      </p>
    );
  } else if (!apiOnline) {
    notice = <p className="notice">Server nicht erreichbar – du siehst die Runs dieses Geräts.</p>;
  } else if (source === 'online') {
    notice = (
      <p className="notice">
        Online-Rangliste – gewertet werden nur Runs, die online gestartet wurden. Dein Gerät ist dein Profil, ganz ohne
        Anmeldung.
      </p>
    );
  } else {
    notice = (
      <p className="notice">
        Runs dieses Geräts – auch offline gespielte, die nicht in die Online-Rangliste kommen.
      </p>
    );
  }

  return (
    <div className="page leaderboard">
      <header className="page-head">
        <h1 className="page-title">Rangliste</h1>
        <p className="page-lead">Pro Spieler zählt der beste Run – sortiert nach Punkten, dann Team-Score.</p>
      </header>

      <div className="lb-top">
        {notice}
        {apiOnline && (
          <Segmented
            label="Quelle"
            hideLabel
            value={source}
            onChange={setSource}
            options={[
              { value: 'online', label: 'Online' },
              { value: 'local', label: 'Dieses Gerät' },
            ]}
          />
        )}
      </div>

      <div className="leaderboard__controls">
        <div className="tabs-inline" role="tablist" aria-label="Challenge">
          {CHALLENGES.map((c) => (
            <button
              key={c}
              role="tab"
              type="button"
              aria-selected={challenge === c}
              className={`tab-inline ${challenge === c ? 'is-active' : ''}`}
              onClick={() => select(c, defaultPeriod(c))}
            >
              {CHALLENGE_LABEL[c]}
            </button>
          ))}
        </div>
        <Segmented
          label="Zeitraum"
          hideLabel
          value={period}
          onChange={(p) => select(challenge, p)}
          options={[
            { value: 'today', label: 'Heute' },
            { value: 'all', label: 'Allzeit' },
          ]}
        />
      </div>

      <section className="card" role="tabpanel" aria-label={CHALLENGE_LABEL[challenge]}>
        {apiOnline == null ? (
          <p className="muted">Lade …</p>
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
          Dein Name auf der Rangliste
        </label>
        <div className="namefield__row">
          <input id="lb-name" className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn" disabled={saving} aria-busy={saving}>
            Speichern
          </button>
        </div>
        <p className="muted small lb-namehint">
          {apiOnline
            ? 'Gilt online für alle Runs dieses Geräts und lokal für neue Runs.'
            : 'Gilt für neue Runs auf diesem Gerät.'}
        </p>
      </form>
    </div>
  );
}
