import { useT } from '../i18n';
import type { DraftTeam } from '../lib/api/draftContract';
import type { SpriteStyle } from '../types';
import { usePokemonData } from '../state/PokemonData';
import { Pitch } from './Pitch';
import { TypeChips } from './TypeChips';

interface Props {
  /** Shinys der Liga */
  shinies?: readonly number[];
  teams: DraftTeam[];
  /** Team-Score je Team (Reihenfolge wie teams) */
  ratings: number[];
  /** Anzeigenamen (CPU-Vereine übersetzt) */
  names: string[];
  /** Eigenes Team (Index) oder null */
  highlight: number | null;
  sprite: SpriteStyle;
  /** Standardschützen-Slot anzeigen */
  setPiece: boolean;
}

/**
 * Die fertigen Kader vor dem Anpfiff der gemeinsamen Saison: eigenes Team zuerst, dann nach
 * Team-Score. So bleibt nach dem letzten Pick Zeit, sich das Draft-Ergebnis anzusehen.
 */
export function DraftSquads({ teams, ratings, names, highlight, sprite, setPiece, shinies }: Props) {
  const t = useT();
  const { byId } = usePokemonData();
  const order = teams
    .map((team, i) => ({ team, i, rating: ratings[i] ?? 0 }))
    .sort((a, b) => Number(b.i === highlight) - Number(a.i === highlight) || b.rating - a.rating || a.i - b.i);
  return (
    <section className="draft-squads" aria-labelledby="draft-squads-title">
      <h3 id="draft-squads-title" className="section-title">
        {t.draft.local.squads}
      </h3>
      <div className="draft-results__rosters">
        {order.map(({ team, i, rating }) => (
          <article key={team.id} className={`card draft-results__roster ${i === highlight ? 'is-you' : ''}`}>
            <header className="draft-results__roster-head">
              <h4 className="draft-results__roster-name">
                {names[i]}
                {i === highlight && <span className="draft-results__you-tag">{t.draft.you}</span>}
                {team.cpu && <span className="rating">{t.draft.cpu}</span>}
              </h4>
              <span className="draft-results__score" title={t.draft.col.teamScore}>
                {rating}
              </span>
            </header>
            <p className="draft-results__roster-meta muted small">{team.formation}</p>
            {/* Typ-Elf und 🌈 Regenbogen wie auf dem Draft-Board */}
            <TypeChips pokemon={[...team.slots, setPiece ? team.ss : null].flatMap((id) => (id != null && byId.has(id) ? [byId.get(id)!] : []))} />
            <Pitch
              formation={team.formation}
              slots={team.slots}
              ss={setPiece ? team.ss : undefined}
              sprite={sprite}
              ariaLabel={t.draft.local.squadAria(names[i])}
              jerseys={team.jerseys}
              captain={team.captain ?? null}
              shinies={shinies}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
