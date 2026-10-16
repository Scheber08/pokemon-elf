import { ago } from '../lib/ago';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EntryDialog, type EntrySource } from '../components/EntryDialog';
import { useT } from '../i18n';
import { ApiRequestError, fetchPlayerProfile } from '../lib/api/client';
import type { PlayerProfile } from '../lib/api/contract';
import { copyText } from '../lib/exportImage';
import { formatRecord } from '../lib/season';
import { useToast } from '../state/Toast';
import { TrainerAvatar } from '../components/TrainerAvatar';
import { parseLook } from '../lib/trainer';
import type { ChallengeKey } from '../types';
import '../styles/leaderboard.css';

type Status = { status: 'loading' } | { status: 'ready'; profile: PlayerProfile } | { status: 'gone' } | { status: 'error'; message: string };

/** /spieler/:entryId – Profil des Spielers hinter einem Ranglisten-Eintrag. */
export function Profile() {
  const { entryId = '' } = useParams();
  const t = useT();
  const tp = t.leaderboard.profile;
  const [state, setState] = useState<Status>({ status: 'loading' });
  const [open, setOpen] = useState<EntrySource | null>(null);
  /** „Letzte Runs“ nur einer Wertung (null = alle) */
  const [only, setOnly] = useState<ChallengeKey | null>(null);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    fetchPlayerProfile(entryId).then(
      (profile) => alive && setState({ status: 'ready', profile }),
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) setState({ status: 'gone' });
        else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [entryId]);

  useEffect(() => {
    if (state.status === 'ready') document.title = `${t.leaderboard.entry.profileTitle(state.profile.player)} · Pokémon Elf`;
  }, [state, t]);

  if (state.status !== 'ready') {
    return (
      <div className="page profile">
        <section className="card prose empty">
          <span className="kicker">{tp.kicker}</span>
          <p role="status">
            {state.status === 'loading' ? tp.loading : state.status === 'gone' ? tp.gone : tp.error(state.message)}
          </p>
          {state.status !== 'loading' && (
            <Link className="btn" to="/rangliste">
              {tp.toBoard}
            </Link>
          )}
        </section>
      </div>
    );
  }

  const p = state.profile;

  /** Profil-Link teilen (Teilen-Menü, sonst Zwischenablage) */
  const share = async () => {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t.leaderboard.entry.profileTitle(p.player), url });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    toast((await copyText(url)) ? tp.linkCopied : tp.copyFailed);
  };
  const date = (iso: string) => t.game.day(iso.slice(0, 10));
  return (
    <div className="page profile">
      <header className="page-head">
        <div className="profile__head">
          {p.trainer && <TrainerAvatar look={parseLook(p.trainer)} size={96} label={t.trainer.editorTitle} />}
          <div>
            <span className="kicker">{tp.kicker}</span>
            <h1 className="page-title">{p.player}</h1>
            {p.trainer && p.trainer.title !== 'none' && t.trainer.titles[p.trainer.title] && (
              <span className="trainer-editor__title">{t.trainer.titles[p.trainer.title]}</span>
            )}
            <p className="page-lead">
              {tp.since(date(p.since))} · {tp.runs(p.runs)}
              {p.recent[0] && <span className="profile__active"> · {tp.lastActive(ago(Date.parse(p.recent[0].createdAt), t))}</span>}
              {p.achievements && <> · {tp.achievements(p.achievements.done, p.achievements.total)}</>}
              {p.online && p.online.leagues > 0 && <> · {tp.online(p.online.titles, p.online.leagues)}</>}
              {!!p.online?.managerCups && <> · {tp.managerCups(p.online.managerCups)}</>}
              {!!p.online?.shinies && <> · {tp.shinies(p.online.shinies)}</>}
              {!!p.online?.captainGoals && <> · {tp.captainGoals(p.online.captainGoals)}</>}
              {!!p.online?.goalsReached && <> · {tp.goalsReached(p.online.goalsReached)}</>}
              {(() => {
                // ⭐ Lieblings-Challenge: die mit den meisten Runs (nur eindeutig und bei mindestens zwei gespielten)
                const played = p.challenges.filter((c) => c.runs > 0).sort((a, b) => b.runs - a.runs);
                if (played.length < 2 || played[0].runs === played[1].runs) return null;
                return <> · <span className="profile__fav">{tp.favourite(t.game.challenge[played[0].challenge], played[0].runs)}</span></>;
              })()}
            </p>
          </div>
        </div>
      </header>

      <section className="card" aria-labelledby="profile-best">
        <h2 id="profile-best" className="section-title">
          {tp.perChallenge}
        </h2>
        <div className="table-scroll">
          <table className="league-table">
            <tbody>
              {p.challenges.map((c) => (
                <tr key={c.challenge}>
                  <th scope="row" className="left">
                    {t.game.challenge[c.challenge]}
                  </th>
                  <td>
                    {c.place != null && !!c.players && (
                      <span className="profile__place" title={tp.placeTitle}>
                        {tp.place(c.place, c.players)}
                      </span>
                    )}
                  </td>
                  <td>
                    {c.runs} {tp.runsCol}
                    {c.perfect > 0 && (
                      <span className="profile__perfect" title={tp.perfectTitle(c.perfect)}>
                        {' '}
                        🏆 {c.perfect}
                      </span>
                    )}
                  </td>
                  {c.best ? (
                    <>
                      <td className="left">{c.best.teamName}</td>
                      <td>
                        <strong>{formatRecord(c.best.record)}</strong>
                      </td>
                      <td>{tp.pts(c.best.points)}</td>
                      <td>{tp.score(c.best.score)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() =>
                            setOpen({
                              kind: 'online',
                              entryId: c.best!.entryId,
                              summary: {
                                challenge: c.challenge,
                                day: c.best!.day,
                                player: p.player,
                                teamName: c.best!.teamName,
                                record: c.best!.record,
                                points: c.best!.points,
                                score: c.best!.score,
                                formation: c.best!.formation,
                                rank: null,
                              },
                            })
                          }
                        >
                          {tp.showTeam}
                        </button>
                      </td>
                    </>
                  ) : (
                    <td colSpan={5} />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="profile-recent">
        <h2 id="profile-recent" className="section-title">
          {tp.recent}
        </h2>
        {(() => {
          // Filter nach Wertung – nur, wenn die letzten Runs aus mehreren stammen
          const keys = [...new Set(p.recent.map((r) => r.challenge))];
          if (keys.length < 2) return null;
          return (
            <p className="profile__filter" role="group" aria-label={tp.recentFilter}>
              {([null, ...keys] as (ChallengeKey | null)[]).map((k) => (
                <button key={k ?? 'all'} type="button" className={`chip ${only === k ? 'is-active' : ''}`} aria-pressed={only === k} onClick={() => setOnly(k)}>
                  {k ? t.game.challenge[k] : tp.recentAll}
                </button>
              ))}
            </p>
          );
        })()}
        {(() => {
          // Ø Punkte der gezeigten Runs (ab zwei) mit dem besten, dazu der Trend: die neuesten drei gegen die älteren (ab sechs)
          const rows = p.recent.filter((r) => !only || r.challenge === only);
          if (rows.length < 2) return null;
          const avg = (xs: typeof rows) => xs.reduce((n, r) => n + r.points, 0) / xs.length;
          const trend = rows.length >= 6 ? Math.round(avg(rows.slice(0, 3)) - avg(rows.slice(3))) : 0;
          return (
            <p className="small profile__avg">
              {tp.recentAvg(Math.round(avg(rows)), rows.length)}
              <span className="profile__top"> · {tp.recentBest(Math.max(...rows.map((r) => r.points)))}</span>
              {trend !== 0 && (
                <span className={`profile__trend ${trend > 0 ? 'is-up' : 'is-down'}`}> · {tp.recentTrend(trend)}</span>
              )}
            </p>
          );
        })()}
        <div className="table-scroll">
          <table className="league-table">
            <tbody>
              {p.recent.filter((r) => !only || r.challenge === only).map((r, i) => (
                <tr key={`${r.createdAt}-${i}`}>
                  <td className="left muted">{date(r.createdAt)}</td>
                  <td className="left">{t.game.challenge[r.challenge]}</td>
                  <td className="left">
                    {r.teamName}
                    {(() => {
                      // 🏅 Dieser Run ist der Bestwert seiner Wertung
                      const b = p.challenges.find((c) => c.challenge === r.challenge)?.best;
                      const isBest = b && b.day === r.day && b.teamName === r.teamName && b.points === r.points && b.score === r.score;
                      return isBest ? (
                        <span className="profile__best" title={tp.bestRunTitle}>
                          {' '}
                          🏅
                        </span>
                      ) : null;
                    })()}
                  </td>
                  <td>
                    <strong>{formatRecord(r.record)}</strong>
                    {/* 🏆 Perfekte Saison (nur Siege), sonst 🛡️ ungeschlagen (keine Niederlage) */}
                    {r.record.l === 0 && r.record.d === 0 && r.record.w > 0 ? (
                      <span className="profile__perfect-run" role="img" title={tp.perfectRunTitle} aria-label={tp.perfectRunTitle}>
                        {' '}
                        🏆
                      </span>
                    ) : (
                      r.record.l === 0 && (
                        <span className="profile__unbeaten" role="img" title={tp.unbeatenTitle} aria-label={tp.unbeatenTitle}>
                          {' '}
                          🛡️
                        </span>
                      )
                    )}
                  </td>
                  <td>{tp.pts(r.points)}</td>
                  <td>{tp.score(r.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="actionbar">
        <button type="button" className="btn btn--primary" onClick={share}>
          {tp.share}
        </button>
        <Link className="btn" to="/rangliste">
          {tp.toBoard}
        </Link>
      </div>

      {open && <EntryDialog source={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
