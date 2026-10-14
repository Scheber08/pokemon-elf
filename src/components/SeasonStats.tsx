import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { playerTallies, teamTallies } from '../lib/leagueTimeline';
import type { LeagueResult } from '../lib/season';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { Segmented } from './Segmented';
import { Sprite } from './Sprite';

type Tab = 'goals' | 'assists' | 'points' | 'teams';

interface Props {
  league: Pick<LeagueResult, 'matches'>;
  you: number | null;
  nameOf: (team: number) => string;
  /** Welche Reiter (Standard: alle) */
  tabs?: Tab[];
  /** So viele Spieler je Liste */
  limit?: number;
}

/** Statistiken einer Saison: Torjäger, Vorlagen, Scorerpunkte und Teamwerte (Schüsse, xG, Ballbesitz). */
export function SeasonStats({ league, you, nameOf, tabs = ['goals', 'assists', 'points', 'teams'], limit = 10 }: Props) {
  const t = useT();
  const tx = t.draft.stats;
  const { byId } = usePokemonData();
  const { sprite } = useSettings();
  const players = useMemo(() => playerTallies(league), [league]);
  const teams = useMemo(() => teamTallies(league), [league]);
  // Ältere Ligen ohne Vorlagen bzw. Statistik: diese Reiter weglassen
  const hasAssists = players.some((p) => p.assists > 0);
  const shown = tabs.filter((x) => (x === 'teams' ? teams.length > 0 : x === 'goals' || hasAssists));
  const [tab, setTab] = useState<Tab>(shown[0]);
  if (!shown.length) return null;
  const active = shown.includes(tab) ? tab : shown[0];

  const key = (p: (typeof players)[number]) => (active === 'goals' ? p.goals : active === 'assists' ? p.assists : p.goals + p.assists);
  const list = players
    .filter((p) => key(p) > 0)
    .sort((a, b) => key(b) - key(a) || b.goals - a.goals || a.teamIndex - b.teamIndex || a.pokemonId - b.pokemonId)
    .slice(0, limit);

  return (
    <section className="card season-stats" aria-labelledby="season-stats-title">
      <h2 id="season-stats-title" className="section-title">
        {tx.title}
      </h2>
      {shown.length > 1 && (
        <Segmented<Tab> label={tx.title} hideLabel wrap value={active} onChange={setTab} options={shown.map((v) => ({ value: v, label: tx.tab[v] }))} />
      )}
      {active === 'teams' ? (
        <div className="table-scroll">
          <table className="league-table season-stats__teams">
            <thead>
              <tr>
                <th scope="col" className="left">
                  {t.draft.col.team}
                </th>
                <th scope="col" title={tx.shotsTitle}>
                  {tx.shots}
                </th>
                <th scope="col" title={tx.onTargetTitle}>
                  {tx.onTarget}
                </th>
                <th scope="col" title={tx.xgTitle}>
                  xG
                </th>
                <th scope="col" title={tx.xgaTitle}>
                  xGA
                </th>
                <th scope="col" title={tx.possessionTitle}>
                  {tx.possession}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...teams]
                .sort((a, b) => b.xg - b.xga - (a.xg - a.xga) || a.team - b.team)
                .map((r) => (
                  <tr key={r.team} className={r.team === you ? 'is-user' : ''}>
                    <td className="left">{nameOf(r.team)}</td>
                    <td>{(r.shots / r.games).toFixed(1)}</td>
                    <td>{(r.onTarget / r.games).toFixed(1)}</td>
                    <td>
                      {r.xg.toFixed(1)} <small className="muted">({r.goals})</small>
                    </td>
                    <td>
                      {r.xga.toFixed(1)} <small className="muted">({r.against})</small>
                    </td>
                    <td>{r.possession} %</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="muted small">{tx.teamsNote}</p>
        </div>
      ) : list.length ? (
        <ol className="scorers season-stats__players">
          {list.map((p, i) => {
            const mon = byId.get(p.pokemonId);
            return (
              <li key={`${p.teamIndex}-${p.pokemonId}`} className={p.teamIndex === you ? 'is-you' : ''}>
                <span className="draft-results__rank">{i + 1}.</span>
                {mon ? <Sprite pokemon={mon} style={sprite} className="scorers__sprite" /> : <span aria-hidden="true" />}
                <span className="scorers__name">
                  {mon ? t.game.pokemon(mon) : `#${p.pokemonId}`} <small className="muted">{nameOf(p.teamIndex)}</small>
                </span>
                <span className="scorers__goals" title={tx.split(p.goals, p.assists)}>
                  {key(p)}
                  {active === 'points' && <small className="muted season-stats__split"> {tx.short(p.goals, p.assists)}</small>}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">{tx.empty}</p>
      )}
    </section>
  );
}
