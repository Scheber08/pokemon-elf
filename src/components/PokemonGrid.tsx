import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { dexId, isMega, isUltraBeast } from '../config/categories';
import { useT } from '../i18n';
import type { PosCode, Pokemon, SpriteStyle, StatKey } from '../types';
import { TypeBadges } from './Badges';
import { Sprite } from './Sprite';
import { StatTooltip } from './StatTooltip';

const MINI: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export function MiniStats({ pokemon }: { pokemon: Pokemon }) {
  const labels = useT().builder.grid.mini;
  const title = MINI.map((k) => `${labels[k]} ${pokemon[k]}`).join(' · ');
  return (
    <span className="ministats" role="img" title={title} aria-label={title}>
      {MINI.map((k) => (
        <span key={k} className="ministats__bar" data-label={labels[k]}>
          <span style={{ height: `${Math.min(100, (pokemon[k] / 180) * 100)}%` }} />
        </span>
      ))}
    </span>
  );
}

interface Props {
  items: Pokemon[];
  sprite: SpriteStyle;
  onPick: (p: Pokemon) => void;
  selectedId?: number | null;
  /** Grund, warum ein Pokémon nicht wählbar ist (wird ausgegraut) */
  disabledReason?: (p: Pokemon) => string | null;
  /** Kleiner Hinweis auf der Karte, z. B. „auf dem Feld: ST" */
  note?: (p: Pokemon) => string | null;
  emptyOption?: { label: string; onPick: () => void };
  ariaLabel?: string;
  pageSize?: number;
  /** Fokus beim Mount auf das ausgewählte bzw. erste Element setzen */
  autoFocus?: boolean;
  className?: string;
  /**
   * Die inkrementelle Anzeige beginnt nur wieder bei pageSize, wenn sich dieser Schlüssel ändert
   * (z. B. Filter). Ohne Schlüssel: bei jeder neuen items-Liste. So bleibt die Scrollposition
   * erhalten, wenn nur einzelne Einträge wegfallen (Pick im Live-Draft).
   */
  resetKey?: string | number;
  /** Zielposition (z. B. im Auswahl-Dialog): der Werte-Tooltip markiert, was dort zählt */
  tipPos?: PosCode;
}

/** Raster aus Pokémon-Karten, per Pfeiltasten bedienbar, rendert inkrementell. */
export function PokemonGrid({
  items,
  sprite,
  onPick,
  selectedId,
  disabledReason,
  note,
  emptyOption,
  ariaLabel,
  pageSize = 84,
  autoFocus,
  className = '',
  resetKey,
  tipPos,
}: Props) {
  const t = useT();
  const [limit, setLimit] = useState(pageSize);
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [tip, setTip] = useState<{ pokemon: Pokemon; rect: DOMRect } | null>(null);

  // Werte-Tooltip beim Scrollen/Klicken schließen (die Karte wandert sonst darunter weg).
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

  const resetOn: unknown = resetKey === undefined ? items : resetKey;
  useEffect(() => setLimit(pageSize), [resetOn, pageSize]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setLimit((l) => l + pageSize),
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items, pageSize, limit]);

  useEffect(() => {
    if (!autoFocus) return;
    const grid = gridRef.current;
    const target =
      grid?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? grid?.querySelector<HTMLElement>('[data-grid-item]');
    target?.focus({ preventScroll: false });
  }, [autoFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-grid-item]'));
    const current = cells.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    e.preventDefault();
    const top = cells[0]?.offsetTop ?? 0;
    const cols = Math.max(1, cells.filter((c) => c.offsetTop === top).length);
    let next = current;
    if (e.key === 'ArrowRight') next = current + 1;
    if (e.key === 'ArrowLeft') next = current - 1;
    if (e.key === 'ArrowDown') next = current + cols;
    if (e.key === 'ArrowUp') next = current - cols;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = cells.length - 1;
    if (next >= cells.length - cols && limit < items.length) setLimit((l) => l + pageSize);
    next = Math.max(0, Math.min(cells.length - 1, next));
    cells[next]?.focus();
    cells[next]?.scrollIntoView({ block: 'nearest' });
  };

  const visible = items.slice(0, limit);
  return (
    <div className={`pgrid-wrap ${className}`}>
      <div ref={gridRef} className="pgrid" role="list" aria-label={ariaLabel ?? t.builder.grid.label} onKeyDown={onKeyDown}>
        {emptyOption && (
          <div role="listitem">
            <button type="button" className="pcard pcard--empty" data-grid-item onClick={emptyOption.onPick}>
              <span className="pcard__ring" aria-hidden="true" />
              <span className="pcard__name">{emptyOption.label}</span>
            </button>
          </div>
        )}
        {visible.map((p) => {
          const reason = disabledReason?.(p) ?? null;
          const hint = note?.(p) ?? null;
          const selected = selectedId === p.id;
          return (
            <div role="listitem" key={p.id}>
              <button
                type="button"
                className={`pcard ${selected ? 'is-selected' : ''} ${reason ? 'is-disabled' : ''}`}
                data-grid-item
                aria-pressed={selected}
                aria-disabled={!!reason}
                title={reason ?? undefined}
                onClick={() => !reason && onPick(p)}
                onPointerEnter={(e) => {
                  if (e.pointerType !== 'mouse') return;
                  const el = e.currentTarget;
                  window.clearTimeout(hoverTimer.current);
                  hoverTimer.current = window.setTimeout(() => setTip({ pokemon: p, rect: el.getBoundingClientRect() }), 450);
                }}
                onPointerLeave={() => {
                  window.clearTimeout(hoverTimer.current);
                  setTip(null);
                }}
                onPointerDown={() => window.clearTimeout(hoverTimer.current)}
              >
                <Sprite pokemon={p} style={sprite} className="pcard__sprite" />
                <span className="pcard__no">{t.game.dexNo(dexId(p))}</span>
                <span className="pcard__name">{t.game.pokemon(p)}</span>
                <TypeBadges types={p.types} small />
                <MiniStats pokemon={p} />
                {isMega(p) ? (
                  <span className="pcard__legend pcard__legend--mega" title={t.game.mega}>
                    {t.builder.grid.megaShort}
                  </span>
                ) : p.leg || p.myth ? (
                  <span className="pcard__legend">{p.myth ? t.builder.grid.mythShort : t.builder.grid.legShort}</span>
                ) : isUltraBeast(p) ? (
                  <span className="pcard__legend pcard__legend--ub" title={t.game.ultraBeast}>
                    {t.builder.grid.ubShort}
                  </span>
                ) : null}
                {hint && <span className="pcard__note">{hint}</span>}
                {reason && <span className="pcard__reason">{reason}</span>}
              </button>
            </div>
          );
        })}
      </div>
      {items.length === 0 && !emptyOption && <p className="pgrid__empty">{t.builder.grid.none}</p>}
      {limit < items.length && <div ref={sentinel} className="pgrid__sentinel" aria-hidden="true" />}
      {tip && <StatTooltip pokemon={tip.pokemon} anchor={tip.rect} pos={tipPos} />}
    </div>
  );
}
