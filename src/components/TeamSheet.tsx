import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { dexId } from '../config/categories';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import { BULLSEYE_FIT, positionFit, type Scale } from '../lib/fit';
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
  /** Mit Skala: Fit jedes Pokémon auf seiner Position hinter der Pokédex-Nummer */
  fitScale?: Scale;
}

/** Teamblatt: alle Positionen mit Kürzel, Sprite, Name und Typen. */
export function TeamSheet({ formation, slots, ss, sprite, onRowClick, title, fitScale }: Props) {
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
  // Schwächster Fit der vollen Elf (eindeutig) – dort lohnt ein Tausch am meisten
  const weakest = (() => {
    if (!fitScale || filled < 11) return null;
    const fits = rows
      .filter((r) => r.id != null && r.index !== SS_INDEX && byId.get(r.id))
      .map((r) => ({ index: r.index, fit: Math.round(positionFit(byId.get(r.id!)!, r.pos, fitScale)) }));
    const min = Math.min(...fits.map((f) => f.fit));
    const at = fits.filter((f) => f.fit === min);
    return at.length === 1 ? at[0].index : null;
  })();

  return (
    <section className="sheet card" aria-labelledby="sheet-title">
      <header className="sheet__head">
        <h2 id="sheet-title" className="section-title">
          {title ?? t.builder.sheet.title}
        </h2>
        <span className="sheet__count">
          {(() => {
            // Ø Fit der aufgestellten Feldspieler (ohne Standardschützen) – nur mit Skala
            if (!fitScale) return null;
            const fits = rows.flatMap((r) => {
              const p = r.id != null && r.index !== SS_INDEX ? byId.get(r.id) : undefined;
              return p ? [positionFit(p, r.pos, fitScale)] : [];
            });
            return fits.length > 0 && <span className="sheet__avg">{t.builder.sheet.avgFit(Math.round(fits.reduce((a, b) => a + b, 0) / fits.length))} · </span>;
          })()}
          {filled}/11
        </span>
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
                    <small>
                      {t.game.dexNo(dexId(p))}
                      {fitScale &&
                        (() => {
                          const fit = Math.round(positionFit(p, r.pos, fitScale));
                          return (
                            <span className={`sheet__fit ${fit >= BULLSEYE_FIT ? 'is-bullseye' : ''}`}>
                              <span className="sheet__fit-sep"> · </span>
                              {t.builder.sheet.fit(fit)}
                              {/* Im Fit-Span, damit es auf dem Handy in derselben Zeile bleibt */}
                              {r.index === weakest && (
                                <span className="sheet__weakest" role="img" title={t.builder.sheet.weakest} aria-label={t.builder.sheet.weakest}>
                                  {' '}
                                  🔻
                                </span>
                              )}
                            </span>
                          );
                        })()}
                    </small>
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
