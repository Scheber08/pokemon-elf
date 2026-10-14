import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { friendlyMatch, fullEleven, type FriendlySide } from '../lib/friendly';
import { formatMinute, type Goal } from '../lib/season';
import { load, STORAGE_KEYS } from '../lib/storage';
import { loadSavedTeams } from './SavedTeams';
import { usePokemonData } from '../state/PokemonData';
import { ReplayToggle, useMatchReport } from './MatchReport';
import type { FormationId } from '../types';
import { cleanJerseys, type Jerseys } from '../lib/jerseys';
import '../styles/friendly.css';

/** Gespeicherte Builder-Aufstellung (siehe pages/Builder.tsx) – nur die nötigen Felder. */
interface StoredLineup {
  formation?: FormationId;
  slots?: (number | null)[];
  ss?: number | null;
  ssEnabled?: boolean;
  teamName?: string;
  jerseys?: unknown;
  captain?: unknown;
}

/** Seite eines Testspiels samt eigenen Trikotnummern (nur für die Wiedergabe) */
type Side = FriendlySide & { jerseys?: Jerseys };

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
      return { name: s.teamName?.trim() || fallback, formation: s.formation, slots, ss, captain, jerseys: cleanJerseys(s.jerseys) };
    };
    const current = sideOf(load<StoredLineup | null>(STORAGE_KEYS.lineup, null), tr.friendlyYou);
    const saved = loadSavedTeams<StoredLineup>().map((x) => sideOf(x.state, x.name));
    return [current, ...saved].filter((x): x is Side => !!x);
  }, [byId, tr.friendlyYou]);
  const [choice, setChoice] = useState(0);
  const own = sides[Math.min(choice, sides.length - 1)] ?? null;
  const result = useMemo(() => (own ? friendlyMatch(own, opponent, byId, scale('all'), seed) : null), [own, opponent, byId, scale, seed]);
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
      return side ? { formation: side.formation, ids: side.slots, jerseys: side.jerseys } : null;
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
  return (
    <section className="card friendly" aria-labelledby="friendly-title" aria-live="polite">
      <h3 id="friendly-title" className="section-title">
        {tr.friendlyTitle}: {own.name} – {opponent.name}
      </h3>
      {sides.length > 1 && (
        <label className="friendly__pick">
          {tr.friendlyPick}{' '}
          <select className="input" value={Math.min(choice, sides.length - 1)} onChange={(e) => setChoice(Number(e.target.value))}>
            {sides.map((x, i) => (
              <option key={i} value={i}>
                {i === 0 ? tr.friendlyCurrent(x.name) : x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted small">{tr.friendlyScore(result.ratings[0], result.ratings[1])}</p>
      <ol className="friendly__legs">
        {result.matches.map((m, i) => {
          const ownHome = m.home === 0;
          const ownGoals = ownHome ? m.hg : m.ag;
          const oppGoals = ownHome ? m.ag : m.hg;
          const ownScorers = scorers(ownHome ? m.homeScorers : m.awayScorers);
          return (
            <li key={i}>
              <strong>{i === 0 ? tr.friendlyFirst : tr.friendlySecond}:</strong>{' '}
              {ownHome ? `${own.name} ${ownGoals}:${oppGoals} ${opponent.name}` : `${opponent.name} ${oppGoals}:${ownGoals} ${own.name}`}
              {ownScorers && <small className="muted friendly__scorers"> · {tr.friendlyScorers(ownScorers)}</small>}
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
      <p className="muted small">{tr.friendlyNote}</p>
      <ReplayToggle />
      {report.element}
      <button type="button" className="btn btn--small" onClick={() => setSeed(newSeed())}>
        {tr.friendlyAgain}
      </button>
    </section>
  );
}
