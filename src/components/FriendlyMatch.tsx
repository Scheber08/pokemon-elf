import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { friendlyMatch, friendlyOdds, friendlyStar, fullEleven, type FriendlySide } from '../lib/friendly';
import { formatMinute, type Goal } from '../lib/season';
import { load, STORAGE_KEYS } from '../lib/storage';
import { loadSavedTeams } from './SavedTeams';
import { usePokemonData } from '../state/PokemonData';
import { ReplayToggle, useMatchReport } from './MatchReport';
import type { FormationId } from '../types';
import { cleanJerseys, type Jerseys } from '../lib/jerseys';
import { cleanKit, type Kit } from '../lib/kits';
import '../styles/friendly.css';
import { cleanCheer } from '../lib/cheer';
import { cleanCrest, type Crest as CrestData } from '../lib/crest';

/** Gespeicherte Builder-Aufstellung (siehe pages/Builder.tsx) – nur die nötigen Felder. */
interface StoredLineup {
  formation?: FormationId;
  slots?: (number | null)[];
  ss?: number | null;
  ssEnabled?: boolean;
  teamName?: string;
  jerseys?: unknown;
  captain?: unknown;
  kit?: unknown;
  cheer?: unknown;
  crest?: unknown;
}

/** Seite eines Testspiels samt eigenen Trikotnummern (nur für die Wiedergabe) */
type Side = FriendlySide & { jerseys?: Jerseys; kit?: Kit | null; cheer?: string; crest?: CrestData | null };

const newSeed = () => Math.floor(Math.random() * 0x7fffffff);

/** Testspiel der eigenen Builder-Elf gegen ein Ranglisten-Team (Hin- und Rückspiel). */
export function FriendlyMatch({ opponent }: { opponent: Side }) {
  const t = useT();
  const tr = t.leaderboard.entry;
  const { byId, scale } = usePokemonData();
  const [seed, setSeed] = useState(newSeed);
  /** Wählbare eigene Elfen: die aktuelle Builder-Elf, dann „Meine Teams" – nur vollständige */
  const sides = useMemo((): Side[] => {
    const sideOf = (s: StoredLineup | null, fallback: string): Side | null => {
      if (!s?.formation || !s.slots) return null;
      const slots = s.slots.map((id) => (id != null && byId.has(id) ? id : null));
      if (!fullEleven(slots)) return null;
      const ss = s.ssEnabled && s.ss != null && byId.has(s.ss) ? s.ss : null;
      const captain = typeof s.captain === 'number' && slots.includes(s.captain) ? s.captain : null;
      return { name: s.teamName?.trim() || fallback, formation: s.formation, slots, ss, captain, jerseys: cleanJerseys(s.jerseys), kit: cleanKit(s.kit), cheer: cleanCheer(s.cheer), crest: cleanCrest(s.crest) };
    };
    const current = sideOf(load<StoredLineup | null>(STORAGE_KEYS.lineup, null), tr.friendlyYou);
    const saved = loadSavedTeams<StoredLineup>().map((x) => sideOf(x.state, x.name));
    return [current, ...saved].filter((x): x is Side => !!x);
  }, [byId, tr.friendlyYou]);
  const [choice, setChoice] = useState(0);
  /** Bisherige Testspiele dieser Paarung (vor dem aktuellen): 1 Sieg, 0 Remis, -1 Niederlage */
  // Frühere Testspiele dieser Paarung: Tore [eigene, gegnerische]
  const [history, setHistory] = useState<[number, number][]>([]);
  const own = sides[Math.min(choice, sides.length - 1)] ?? null;
  const result = useMemo(() => (own ? friendlyMatch(own, opponent, byId, scale('all'), seed) : null), [own, opponent, byId, scale, seed]);
  const odds = useMemo(() => (own ? friendlyOdds(own, opponent, byId, scale('all')) : null), [own, opponent, byId, scale]);
  // Spielwiedergabe (2D/Bericht) – beide Elfen mit ihren Pokémon
  const report = useMatchReport(
    (i) => (i === 0 ? (own?.name ?? '') : opponent.name),
    (id) => {
      const p = byId.get(id);
      return p ? t.game.pokemon(p) : `#${id}`;
    },
    (m) => (m.home === 0 ? tr.friendlyFirst : tr.friendlySecond),
    undefined,
    (i) => {
      const side = i === 0 ? own : opponent;
      return side ? { formation: side.formation, ids: side.slots, jerseys: side.jerseys, captain: side.captain, kit: side.kit, cheer: side.cheer, crest: side.crest } : null;
    },
  );

  if (!own || !result) {
    return (
      <section className="card friendly" aria-label={tr.friendlyTitle}>
        <p>{tr.friendlyNeedEleven}</p>
        <Link className="btn btn--small" to="/">
          {tr.friendlyToBuilder}
        </Link>
      </section>
    );
  }

  const scorers = (goals: Goal[]) =>
    goals
      .map((g) => {
        const p = byId.get(g.pokemonId);
        const name = p ? t.game.pokemon(p) : `#${g.pokemonId}`;
        return g.minute != null ? `${name} ${formatMinute(g.minute)}` : name;
      })
      .join(', ');
  const [gf, ga] = result.aggregate;
  const verdict = gf > ga ? tr.friendlyWin : gf < ga ? tr.friendlyLoss : tr.friendlyDraw;
  // Bilanz aller Testspiele dieser Paarung samt dem aktuellen (erst ab dem zweiten)
  const games: [number, number][] = [...history, [gf, ga]];
  const outcomes = games.map(([a, b]) => Math.sign(a - b));
  const tally = (v: number) => outcomes.filter((o) => o === v).length;
  const goalsFor = games.reduce((n, [a]) => n + a, 0);
  const goalsAgainst = games.reduce((n, [, b]) => n + b, 0);
  return (
    <section className="card friendly" aria-labelledby="friendly-title" aria-live="polite">
      <h3 id="friendly-title" className="section-title">
        {tr.friendlyTitle}: {own.name} – {opponent.name}
      </h3>
      {sides.length > 1 && (
        <label className="friendly__pick">
          {tr.friendlyPick}{' '}
          <select className="input" value={Math.min(choice, sides.length - 1)} onChange={(e) => {
              setChoice(Number(e.target.value));
              setHistory([]);
            }}>
            {sides.map((x, i) => (
              <option key={i} value={i}>
                {i === 0 ? tr.friendlyCurrent(x.name) : x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted small">{tr.friendlyScore(result.ratings[0], result.ratings[1])}</p>
      {odds && <p className="small friendly__odds">{tr.friendlyOdds(odds.win, odds.draw, odds.loss)}</p>}
      <ol className="friendly__legs">
        {result.matches.map((m, i) => {
          const ownHome = m.home === 0;
          const ownGoals = ownHome ? m.hg : m.ag;
          const oppGoals = ownHome ? m.ag : m.hg;
          const ownScorers = scorers(ownHome ? m.homeScorers : m.awayScorers);
          const oppScorers = scorers(ownHome ? m.awayScorers : m.homeScorers);
          return (
            <li key={i}>
              <strong>{i === 0 ? tr.friendlyFirst : tr.friendlySecond}:</strong>{' '}
              {ownHome ? `${own.name} ${ownGoals}:${oppGoals} ${opponent.name}` : `${opponent.name} ${oppGoals}:${ownGoals} ${own.name}`}
              {ownScorers && <small className="muted friendly__scorers"> · {tr.friendlyTeamScorers(own.name, ownScorers)}</small>}
              {oppScorers && <small className="muted friendly__scorers friendly__scorers--opp"> · {tr.friendlyTeamScorers(opponent.name, oppScorers)}</small>}
              {report.open && (
                <button type="button" className="btn btn--small btn--ghost friendly__report" onClick={() => report.open?.(m)}>
                  {t.draft.report.title}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <p className="friendly__verdict">
        <strong>
          {tr.friendlyAggregate} {gf}:{ga}
        </strong>{' '}
        – {verdict}
      </p>
      {(() => {
        const star = friendlyStar(result.matches);
        const p = star ? byId.get(star.pokemonId) : undefined;
        return star && p && <p className="friendly__star small">{tr.friendlyStar(t.game.pokemon(p), star.team === 0 ? own.name : opponent.name, star.goals)}</p>;
      })()}
      {outcomes.length > 1 && (
        <p className="friendly__tally small">
          {tr.friendlyTally(outcomes.length, tally(1), tally(0), tally(-1))}
          {tr.friendlyGoals(goalsFor, goalsAgainst)}
        </p>
      )}
      <p className="muted small">{tr.friendlyNote}</p>
      <ReplayToggle />
      {report.element}
      <button
        type="button"
        className="btn btn--small"
        onClick={() => {
          setHistory((h) => [...h, [gf, ga]]);
          setSeed(newSeed());
        }}
      >
        {tr.friendlyAgain}
      </button>
    </section>
  );
}
