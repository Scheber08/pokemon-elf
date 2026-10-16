import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EntryDialog, type EntrySource, type EntrySummary } from '../components/EntryDialog';
import { Segmented } from '../components/Segmented';
import { useT, type Messages } from '../i18n';
import { ApiRequestError, fetchLeaderboard } from '../lib/api/client';
import { LIMITS, type LeaderboardResponse } from '../lib/api/contract';
import { dayKey, weekKey } from '../lib/daily';
import { leaderboard, type LeaderboardEntry, type Period } from '../lib/leaderboard';
import { localEntryDetail } from '../lib/leaderboard/entryDetail';
import { playerName, PlayerNameError, savePlayerName } from '../lib/runFinish';
import { formatRecord } from '../lib/season';
import { useScrollActiveIntoView } from '../lib/scrollActive';
import { useToast } from '../state/Toast';
import { useFieldError } from '../state/useFieldError';
import { isChallengeKey, useApiOnline } from '../state/useChallengeRun';
import type { ChallengeKey, Record3 } from '../types';
import '../styles/run.css';
import '../styles/daily.css';
import { TrainerAvatar } from '../components/TrainerAvatar';
import { parseLook, type TrainerLook } from '../lib/trainer';
import '../styles/leaderboard.css';

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
  /** Team dieser Zeile (Dialog „Team ansehen") */
  source: EntrySource;
  /** Online: Eintrag, über den das Spielerprofil erreichbar ist */
  profile?: string;
  /** Online: Trainer des Spielers (falls gestaltet) */
  trainer?: TrainerLook | null;
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

/** „Heute · 12.10.2026", „Diese Woche · KW 42" bzw. „Allzeit" */
const periodText = (t: Messages, period: Period, day: string) =>
  period === 'today'
    ? t.leaderboard.todayOn(t.game.day(day))
    : period === 'week'
      ? t.leaderboard.weekOf(Number(weekKey(day).slice(-2)))
      : t.leaderboard.allTime;

interface BoardTableProps {
  rows: BoardRow[];
  mine: BoardRow | null;
  /**
   * „Rangliste neu laden" im Dialog (Team nicht mehr in der Rangliste) – mit dem Spieler der
   * geöffneten Zeile. Wird aufgerufen, bevor der Dialog schließt: Der Aufrufer setzt den Fokus
   * auf ein Element, das das Neuladen überdauert (die Tabelle samt Knopf verschwindet dabei).
   */
  onReload?: (player: string) => void;
  /** Frisch geladene Tabelle: Fokus an den Team-Knopf dieses Spielers (sofern er noch nirgends sonst ist) */
  focusPlayer?: string | null;
}

/**
 * Tabelle der Rangliste. Jede Zeile öffnet ihr Team im Dialog: per Knopf am Teamnamen
 * (Tastatur, Screenreader) oder per Klick/Tipp irgendwo in die Zeile. Beim Schließen kehrt
 * der Fokus zum Knopf der Zeile zurück.
 */
function BoardTable({ rows, mine, onReload, focusPlayer = null }: BoardTableProps) {
  const t = useT();
  const [open, setOpen] = useState<EntrySource | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Team-Knöpfe je Zeile (BoardRow.key) */
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // Nur beim Einhängen (= nach dem Neuladen aus dem Dialog): Fokus vom Panel an den Team-Knopf
  // desselben Spielers – aber nur, wenn der Fokus noch auf dem Panel (oder nirgends) steht.
  useEffect(() => {
    if (!focusPlayer) return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.contains(wrapRef.current)) return;
    const row = [...rows, ...(mine ? [mine] : [])].find((r) => r.player === focusPlayer);
    if (row) buttons.current.get(row.key)?.focus();
    // Bewusst ohne Abhängigkeiten: nur die frisch eingehängte Tabelle, nicht jedes spätere Rendern.
  }, []);

  /** Knopf fokussieren (Safari tut das beim Klick nicht) – der Dialog gibt den Fokus dorthin zurück. */
  const openFrom = (button: HTMLElement | null, source: EntrySource) => {
    button?.focus({ preventScroll: true });
    setOpen(source);
  };
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, r: BoardRow) => {
    // Klicks auf den Knopf (oder einen Link) erledigt der selbst; markierter Text bleibt markiert
    if ((e.target as Element).closest?.('button, a')) return;
    if (window.getSelection?.()?.toString()) return;
    openFrom(e.currentTarget.querySelector<HTMLElement>('.lb-team'), r.source);
  };

  const line = (r: BoardRow) => (
    <tr
      key={r.key}
      className={`lb-row ${r.me ? 'is-user' : ''}`}
      aria-current={r.me ? 'true' : undefined}
      onClick={(e) => onRowClick(e, r)}
    >
      <td>{r.rank}</td>
      <td className="left lb-who">
        {r.profile ? (
          <Link className="lb-who__player lb-who__link" to={`/spieler/${r.profile}`} title={t.leaderboard.entry.profileTitle(r.player)}>
            {r.trainer && <TrainerAvatar look={r.trainer} size={24} companion={false} className="lb-who__avatar" />}
            {r.player}
          </Link>
        ) : (
          <strong className="lb-who__player">{r.player}</strong>
        )}
        <button
          ref={(el) => {
            if (el) buttons.current.set(r.key, el);
            else buttons.current.delete(r.key);
          }}
          type="button"
          className="lb-team"
          aria-haspopup="dialog"
          aria-label={t.leaderboard.viewTeamOf(r.teamName, r.player)}
          title={t.leaderboard.viewTeam}
          onClick={(e) => openFrom(e.currentTarget, r.source)}
        >
          <span className="lb-team__name">{r.teamName || t.leaderboard.viewTeam}</span>
          <svg className="lb-team__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </td>
      <td className="mono">{formatRecord(r.record)}</td>
      <td>{r.points}</td>
      <td>
        <strong>{r.score}</strong>
      </td>
    </tr>
  );
  return (
    <div className="table-scroll" ref={wrapRef}>
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
                {(() => {
                  // Abstand zur letzten angezeigten Zeile (nur, wenn wirklich Punkte fehlen)
                  const last = rows[rows.length - 1];
                  const gap = last ? last.points - mine.points : 0;
                  return gap > 0 ? <span className="lb-mine__gap"> · {t.leaderboard.yourRankGap(gap, rows.length)}</span> : null;
                })()}
              </th>
            </tr>
            {line(mine)}
          </tbody>
        )}
      </table>
      {open && (
        <EntryDialog
          source={open}
          onClose={() => setOpen(null)}
          onReloadBoard={
            onReload &&
            (() => {
              // Erst den Fokus in Sicherheit bringen (Panel), dann schließen: Der Knopf, an den der
              // Dialog den Fokus zurückgeben würde, verschwindet mit der neu ladenden Tabelle.
              onReload(open.summary.player);
              setOpen(null);
            })
          }
        />
      )}
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

interface OnlineBoardProps {
  challenge: ChallengeKey;
  period: Period;
  reload: number;
  onRetry: () => void;
  /** Panel um die Tabelle – bekommt den Fokus, während die Rangliste aus dem Dialog neu lädt */
  panelRef: RefObject<HTMLElement | null>;
}

/** Alle wie viel Millisekunden die sichtbare Online-Rangliste still neu lädt */
const AUTO_REFRESH_MS = 60_000;

/** Online-Rangliste (Cloudflare) – nur Runs, die online gestartet wurden. */
function OnlineBoard({ challenge, period, reload, onRetry, panelRef }: OnlineBoardProps) {
  const t = useT();
  const key = `${challenge}:${period}:${reload}`;
  const [loaded, setLoaded] = useState<Loaded<LeaderboardResponse> | null>(null);
  /** Neuladen aus dem Dialog: Spieler, dessen Team-Knopf danach den Fokus bekommt; `from` = alter Schlüssel */
  const [refocus, setRefocus] = useState<{ player: string; from: string } | null>(null);

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

  // Still aktualisieren: jede Minute, solange der Tab sichtbar ist, und beim Zurückkehren in den Tab.
  // Die alte Tabelle bleibt stehen; Fehler dabei ändern nichts (der nächste Versuch kommt von selbst).
  useEffect(() => {
    let alive = true;
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      last = Date.now();
      fetchLeaderboard(challenge, period, LIMIT).then(
        (data) => alive && setLoaded((prev) => (prev?.key === key ? { key, data } : prev)),
        () => {},
      );
    };
    const id = window.setInterval(refresh, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (Date.now() - last >= AUTO_REFRESH_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [challenge, period, key]);

  const current = loaded?.key === key ? loaded : null;
  const day = current?.data?.day ?? dayKey();
  const players = current?.data?.players;
  /** Spieler, dessen Knopf die frisch geladene Tabelle fokussiert (nur nach dem Neuladen aus dem Dialog) */
  const focusPlayer = refocus && current && current.key !== refocus.from ? refocus.player : null;

  // Neu geladen (Tabelle, leer oder Fehler): Der Wunsch ist erledigt – die Tabelle hat ihn beim Einhängen gelesen.
  useEffect(() => {
    if (focusPlayer != null) setRefocus(null);
  }, [focusPlayer]);

  /** „Rangliste neu laden" im Dialog: Fokus aufs Panel (bleibt beim Neuladen stehen), dann neu laden. */
  const reloadFromDialog = (player: string) => {
    panelRef.current?.focus({ preventScroll: true });
    setRefocus({ player, from: key });
    onRetry();
  };
  const meta = [periodText(t, period, day)];
  if (players) meta.push(t.leaderboard.players(players));
  // Beliebteste Formation unter den gezeigten Einträgen (ab 3, nur bei eindeutigem Spitzenreiter)
  const shownRows = current?.data?.rows ?? [];
  if (shownRows.length >= 3) {
    const count = new Map<string, number>();
    for (const r of shownRows) count.set(r.formation, (count.get(r.formation) ?? 0) + 1);
    const top = [...count].sort((a, b) => b[1] - a[1]);
    if (top[0][1] >= 2 && (!top[1] || top[1][1] < top[0][1])) meta.push(t.leaderboard.topFormation(top[0][0], top[0][1], shownRows.length));
  }

  const toRow = (r: LeaderboardResponse['rows'][number]): BoardRow => {
    const summary: EntrySummary = {
      challenge,
      day: r.day,
      player: r.player,
      teamName: r.teamName,
      record: r.record,
      points: r.points,
      score: r.score,
      formation: r.formation,
      rank: r.rank,
    };
    return {
      key: r.entryId,
      rank: r.rank,
      player: r.player,
      teamName: r.teamName,
      record: r.record,
      points: r.points,
      score: r.score,
      me: r.me,
      source: { kind: 'online', entryId: r.entryId, summary },
      profile: r.entryId,
      trainer: r.trainer ? parseLook(r.trainer) : null,
    };
  };

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
    body = <BoardTable rows={rows.map(toRow)} mine={outside} onReload={reloadFromDialog} focusPlayer={focusPlayer} />;
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
        {period === 'today' ? t.leaderboard.emptyLocalToday : period === 'week' ? t.leaderboard.emptyLocalWeek : t.leaderboard.emptyLocal}
      </EmptyBoard>
    );
  } else {
    const rows = current.data.map((e, i): BoardRow => {
      const detail = localEntryDetail(e);
      const summary: EntrySummary = {
        challenge: e.challenge,
        day: detail?.day ?? '',
        player: e.player,
        teamName: e.teamName,
        record: e.record,
        points: e.points,
        score: e.score,
        formation: e.formation,
        rank: i + 1,
      };
      return {
        key: e.id,
        rank: i + 1,
        player: e.player,
        teamName: e.teamName,
        record: e.record,
        points: e.points,
        score: e.score,
        me: e.player.trim().toLowerCase() === self,
        source: { kind: 'local', detail, summary },
      };
    });
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
  const period: Period = rawP === 'today' || rawP === 'week' || rawP === 'all' ? rawP : defaultPeriod(challenge);
  const [source, setSource] = useState<Source>('online');
  const [reload, setReload] = useState(0);
  const [name, setName] = useState(playerName);
  const [savedName, setSavedName] = useState(playerName);
  const [saving, setSaving] = useState(false);
  /** Name abgelehnt (leer, „Trainer", vom Server) – Meldung direkt am Feld */
  const nameError = useFieldError();
  const online = apiOnline === true && source === 'online';
  /** Panel der Rangliste – Fokusziel, während die Tabelle neu lädt */
  const panelRef = useRef<HTMLElement>(null);
  /** Handy: gewählte Wertung in der Reiterleiste ins Bild holen */
  const tabsRef = useRef<HTMLDivElement>(null);
  useScrollActiveIntoView(tabsRef, [challenge]);

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
        <div className="tabs-inline" role="tablist" aria-label={t.leaderboard.challengeTabs} ref={tabsRef}>
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
            { value: 'week', label: t.leaderboard.week },
            { value: 'all', label: t.leaderboard.allTime },
          ]}
        />
      </div>

      <section className="card" role="tabpanel" aria-label={t.game.challenge[challenge]} ref={panelRef} tabIndex={-1}>
        {apiOnline == null ? (
          <p className="muted">{t.leaderboard.loading}</p>
        ) : online ? (
          <OnlineBoard
            challenge={challenge}
            period={period}
            reload={reload}
            onRetry={() => setReload((r) => r + 1)}
            panelRef={panelRef}
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
