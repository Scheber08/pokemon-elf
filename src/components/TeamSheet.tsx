import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import { usePokemonData } from '../state/PokemonData';
import type { FormationId, PosCode, Pokemon, Slots, SpriteStyle } from '../types';
import { PosBadge, TypeBadges } from './Badges';
import { SS_INDEX } from './Pitch';
import { Sprite } from './Sprite';
import { PositionTooltip, StatTooltip } from './StatTooltip';

interface Props {
  formation: FormationId;
  slots: Slots;
  ss?: number | null;
  sprite: SpriteStyle;
  onRowClick?: (index: number) => void;
  title?: string;
}

/** Teamblatt: alle Positionen mit Kürzel, Sprite, Name und Typen. */
export function TeamSheet({ formation, slots, ss, sprite, onRowClick, title }: Props) {
  const { byId } = usePokemonData();
  const t = useT();
  const hoverTimer = useRef<number | undefined>(undefined);
  const [tip, setTip] = useState<{ pokemon: Pokemon | null; pos: PosCode; rect: DOMRect } | null>(null);

  // Tooltip schließen, sobald gescrollt bzw. geklickt wird
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('pointerdown', close);
    };
  }, [tip]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  /** Nur mit der Maus (am Handy öffnet ein Tipp den Auswahl-Dialog) */
  const hover = (pos: PosCode, pokemon: Pokemon | null) => ({
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.currentTarget;
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setTip({ pokemon, pos, rect: el.getBoundingClientRect() }), 300);
    },
    onPointerLeave: () => {
      window.clearTimeout(hoverTimer.current);
      setTip(null);
    },
    // Klick: geplanten Tooltip verwerfen (sonst erschiene er über dem Auswahl-Dialog)
    onPointerDown: () => {
      window.clearTimeout(hoverTimer.current);
      setTip(null);
    },
  });

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
          {title ?? t.builder.sheet.title}
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
                    <strong>{t.game.pokemon(p)}</strong>
                    <small>{t.game.dexNo(p.id)}</small>
                  </>
                ) : (
                  <em>{t.common.empty}</em>
                )}
              </span>
              <span className="sheet__types">{p && <TypeBadges types={p.types} small />}</span>
            </>
          );
          return (
            <li key={r.index} className={r.index === SS_INDEX ? 'sheet__row--ss' : ''}>
              {onRowClick ? (
                <button type="button" className="sheet__row" onClick={() => onRowClick(r.index)} {...hover(r.pos, p ?? null)}>
                  {content}
                </button>
              ) : (
                <div className="sheet__row" {...hover(r.pos, p ?? null)}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {tip &&
        (tip.pokemon ? (
          <StatTooltip pokemon={tip.pokemon} anchor={tip.rect} pos={tip.pos} />
        ) : (
          <PositionTooltip pos={tip.pos} anchor={tip.rect} />
        ))}
    </section>
  );
}
