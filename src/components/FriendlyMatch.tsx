import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { friendlyMatch, fullEleven, type FriendlySide } from '../lib/friendly';
import type { Goal } from '../lib/season';
import { load, STORAGE_KEYS } from '../lib/storage';
import { usePokemonData } from '../state/PokemonData';
import type { FormationId } from '../types';

/** Gespeicherte Builder-Aufstellung (siehe pages/Builder.tsx) – nur die nötigen Felder. */
interface StoredLineup {
  formation?: FormationId;
  slots?: (number | null)[];
  ss?: number | null;
  ssEnabled?: boolean;
  teamName?: string;
}

const newSeed = () => Math.floor(Math.random() * 0x7fffffff);

/** Testspiel der eigenen Builder-Elf gegen ein Ranglisten-Team (Hin- und Rückspiel). */
export function FriendlyMatch({ opponent }: { opponent: FriendlySide }) {
  const t = useT();
  const tr = t.leaderboard.entry;
  const { byId, scale } = usePokemonData();
  const [seed, setSeed] = useState(newSeed);
  const own = useMemo((): FriendlySide | null => {
    const s = load<StoredLineup | null>(STORAGE_KEYS.lineup, null);
    if (!s?.formation || !s.slots) return null;
    const slots = s.slots.map((id) => (id != null && byId.has(id) ? id : null));
    if (!fullEleven(slots)) return null;
    const ss = s.ssEnabled && s.ss != null && byId.has(s.ss) ? s.ss : null;
    return { name: s.teamName?.trim() || tr.friendlyYou, formation: s.formation, slots, ss };
  }, [byId, tr.friendlyYou]);
  const result = useMemo(() => (own ? friendlyMatch(own, opponent, byId, scale('all'), seed) : null), [own, opponent, byId, scale, seed]);

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
        return p ? t.game.pokemon(p) : `#${g.pokemonId}`;
      })
      .join(', ');
  const [gf, ga] = result.aggregate;
  const verdict = gf > ga ? tr.friendlyWin : gf < ga ? tr.friendlyLoss : tr.friendlyDraw;
  return (
    <section className="card friendly" aria-labelledby="friendly-title" aria-live="polite">
      <h3 id="friendly-title" className="section-title">
        {tr.friendlyTitle}: {own.name} – {opponent.name}
      </h3>
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
      <button type="button" className="btn btn--small" onClick={() => setSeed(newSeed())}>
        {tr.friendlyAgain}
      </button>
    </section>
  );
}
