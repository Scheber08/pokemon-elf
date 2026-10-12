import { FORMATIONS } from '../config/formations';
import { usePokemonData } from '../state/PokemonData';
import type { FormationId, PosCode, Slots, SpriteStyle } from '../types';
import { PosBadge, TypeBadges } from './Badges';
import { SS_INDEX } from './Pitch';
import { Sprite } from './Sprite';
import { dexNo } from './StatTooltip';

interface Props {
  formation: FormationId;
  slots: Slots;
  ss?: number | null;
  sprite: SpriteStyle;
  onRowClick?: (index: number) => void;
  title?: string;
}

/** Teamblatt: alle Positionen mit Kürzel, Sprite, Name und Typen. */
export function TeamSheet({ formation, slots, ss, sprite, onRowClick, title = 'Teamblatt' }: Props) {
  const { byId } = usePokemonData();
  const rows: { index: number; pos: PosCode; id: number | null }[] = FORMATIONS[formation].slots.map((d, i) => ({
    index: i,
    pos: d.pos,
    id: slots[i] ?? null,
  }));
  if (ss !== undefined) rows.push({ index: SS_INDEX, pos: 'SS', id: ss });
  const filled = rows.filter((r) => r.id != null && r.index !== SS_INDEX).length;

  return (
    <section className="sheet card" aria-labelledby="sheet-title">
      <header className="sheet__head">
        <h2 id="sheet-title" className="section-title">
          {title}
        </h2>
        <span className="sheet__count">{filled}/11</span>
      </header>
      <ol className="sheet__list">
        {rows.map((r) => {
          const p = r.id != null ? byId.get(r.id) : undefined;
          const content = (
            <>
              <PosBadge pos={r.pos} />
              <span className="sheet__sprite">{p ? <Sprite pokemon={p} style={sprite} /> : <span className="sheet__dash" />}</span>
              <span className="sheet__name">
                {p ? (
                  <>
                    <strong>{p.de}</strong>
                    <small>{dexNo(p.id)}</small>
                  </>
                ) : (
                  <em>leer</em>
                )}
              </span>
              <span className="sheet__types">{p && <TypeBadges types={p.types} small />}</span>
            </>
          );
          return (
            <li key={r.index} className={r.index === SS_INDEX ? 'sheet__row--ss' : ''}>
              {onRowClick ? (
                <button type="button" className="sheet__row" onClick={() => onRowClick(r.index)}>
                  {content}
                </button>
              ) : (
                <div className="sheet__row">{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
