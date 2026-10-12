import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Pokemon, SpriteStyle, StatKey } from '../types';
import { TypeBadges } from './Badges';
import { Sprite } from './Sprite';
import { dexNo, StatTooltip } from './StatTooltip';

const MINI: { key: StatKey; label: string }[] = [
  { key: 'hp', label: 'KP' },
  { key: 'atk', label: 'ANG' },
  { key: 'def', label: 'VER' },
  { key: 'spa', label: 'SPA' },
  { key: 'spd', label: 'SPV' },
  { key: 'spe', label: 'INI' },
];

export function MiniStats({ pokemon }: { pokemon: Pokemon }) {
  const title = MINI.map((m) => `${m.label} ${pokemon[m.key]}`).join(' · ');
  return (
    <span className="ministats" title={title} aria-label={title}>
      {MINI.map((m) => (
        <span key={m.key} className="ministats__bar" data-label={m.label}>
          <span style={{ height: `${Math.min(100, (pokemon[m.key] / 180) * 100)}%` }} />
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
  ariaLabel = 'Pokémon-Auswahl',
  pageSize = 84,
  autoFocus,
  className = '',
}: Props) {
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

  useEffect(() => setLimit(pageSize), [items, pageSize]);

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
      <div ref={gridRef} className="pgrid" role="list" aria-label={ariaLabel} onKeyDown={onKeyDown}>
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
              >
                <Sprite pokemon={p} style={sprite} className="pcard__sprite" />
                <span className="pcard__no">{dexNo(p.id)}</span>
                <span className="pcard__name">{p.de}</span>
                <TypeBadges types={p.types} small />
                <MiniStats pokemon={p} />
                {(p.leg || p.myth) ? <span className="pcard__legend">{p.myth ? 'Myst.' : 'Leg.'}</span> : null}
                {hint && <span className="pcard__note">{hint}</span>}
                {reason && <span className="pcard__reason">{reason}</span>}
              </button>
            </div>
          );
        })}
      </div>
      {items.length === 0 && !emptyOption && <p className="pgrid__empty">Keine Pokémon gefunden.</p>}
      {limit < items.length && <div ref={sentinel} className="pgrid__sentinel" aria-hidden="true" />}
      {tip && <StatTooltip pokemon={tip.pokemon} anchor={tip.rect} />}
    </div>
  );
}
