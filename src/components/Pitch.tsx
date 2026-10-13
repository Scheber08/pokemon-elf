import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import { usePokemonData } from '../state/PokemonData';
import type { FormationId, PosCode, Pokemon, Slots, SpriteStyle } from '../types';
import { PitchMarkings } from './PitchMarkings';
import { PlayerToken } from './PlayerToken';
import { Sprite } from './Sprite';
import { PositionTooltip, StatTooltip } from './StatTooltip';

/** Index des optionalen Standardschützen-Slots (neben dem Feld). */
export const SS_INDEX = 11;

export type SlotState = 'target' | 'locked' | 'selected' | undefined;

interface Props {
  formation: FormationId;
  slots: Slots;
  /** undefined = kein SS-Slot; null = leerer SS-Slot */
  ss?: number | null;
  sprite: SpriteStyle;
  onSlotClick?: (index: number) => void;
  /** Aktiviert Drag & Drop. Ziehen auf einen Spieler tauscht, auf einen leeren Slot verschiebt. */
  onSwap?: (from: number, to: number) => void;
  slotState?: (index: number) => SlotState;
  /** Markierte Slots (z. B. Schwachstellen im Ergebnis) */
  highlight?: number[];
  tooltips?: boolean;
  /**
   * Positions-Hinweise (Standard: an): Hover/Long-Press auf einen leeren Slot zeigt, welche
   * Werte dort zählen; bei besetzten Slots markiert der Werte-Tooltip die wichtigen Werte.
   */
  positionTips?: boolean;
  ariaLabel?: string;
  className?: string;
}

interface Press {
  index: number;
  x: number;
  y: number;
  pointerType: string;
  dragging: boolean;
  longPressed: boolean;
  timer: number | undefined;
}

interface DragState {
  from: number;
  x: number;
  y: number;
  over: number | null;
}

const LONG_PRESS_MS = 450;
const DRAG_THRESHOLD = 7;

export function Pitch({
  formation,
  slots,
  ss,
  sprite,
  onSlotClick,
  onSwap,
  slotState,
  highlight,
  tooltips = true,
  positionTips = true,
  ariaLabel,
  className = '',
}: Props) {
  const { byId } = usePokemonData();
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [tip, setTip] = useState<{ pokemon: Pokemon | null; pos: PosCode; rect: DOMRect } | null>(null);
  const [pw, setPw] = useState(0);

  // Feldbreite als CSS-Variable – alle Größen auf dem Feld skalieren damit.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setPw(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const defs = FORMATIONS[formation].slots;
  const idAt = useCallback((i: number) => (i === SS_INDEX ? ss ?? null : slots[i] ?? null), [slots, ss]);
  const posAt = (i: number): PosCode => (i === SS_INDEX ? 'SS' : defs[i].pos);

  const slotFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot-index]');
    if (!el || !wrapRef.current?.contains(el)) return null;
    return Number(el.dataset.slotIndex);
  };

  // Tooltip schließen, sobald irgendwo getippt/gescrollt wird.
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('scroll', close);
      window.removeEventListener('pointerdown', close);
    };
  }, [tip]);

  /** Gibt es für diesen Slot etwas anzuzeigen? (Pokémon-Werte bzw. Positions-Hinweis) */
  const hasTip = (index: number) => tooltips && (idAt(index) != null || positionTips);

  const showTip = (index: number, el: HTMLElement) => {
    if (!hasTip(index)) return;
    const id = idAt(index);
    const p = id != null ? byId.get(id) ?? null : null;
    if (!p && !positionTips) return;
    setTip({ pokemon: p, pos: posAt(index), rect: el.getBoundingClientRect() });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, index: number) => {
    // Geplanter Hover-Tooltip entfällt (sonst erschiene er nach dem Klick, z. B. über dem Dialog)
    window.clearTimeout(hoverTimer.current);
    if (e.button !== 0) return;
    suppressClick.current = false;
    const el = e.currentTarget;
    const state: Press = {
      index,
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
      dragging: false,
      longPressed: false,
      timer: undefined,
    };
    press.current = state;
    if (e.pointerType !== 'mouse' && hasTip(index)) {
      state.timer = window.setTimeout(() => {
        state.longPressed = true;
        suppressClick.current = true;
        showTip(index, el);
      }, LONG_PRESS_MS);
    }

    const move = (ev: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      const dist = Math.hypot(ev.clientX - p.x, ev.clientY - p.y);
      if (!p.dragging && dist > DRAG_THRESHOLD) {
        window.clearTimeout(p.timer);
        if (onSwap && !p.longPressed && idAt(p.index) != null && slotState?.(p.index) !== 'locked') {
          p.dragging = true;
          setTip(null);
        }
      }
      if (p.dragging) {
        ev.preventDefault();
        setDrag({ from: p.index, x: ev.clientX, y: ev.clientY, over: slotFromPoint(ev.clientX, ev.clientY) });
      }
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      const p = press.current;
      press.current = null;
      if (!p) return;
      window.clearTimeout(p.timer);
      if (p.dragging) {
        suppressClick.current = true;
        setDrag(null);
        const target = slotFromPoint(ev.clientX, ev.clientY);
        if (target != null && target !== p.index && slotState?.(target) !== 'locked') onSwap?.(p.index, target);
      }
    };
    const cancel = () => {
      cleanup();
      if (press.current) window.clearTimeout(press.current.timer);
      press.current = null;
      setDrag(null);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const onClick = (index: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    window.clearTimeout(hoverTimer.current);
    setTip(null);
    onSlotClick?.(index);
  };

  const onPointerEnter = (e: ReactPointerEvent<HTMLElement>, index: number) => {
    if (e.pointerType !== 'mouse' || drag) return;
    const el = e.currentTarget;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => showTip(index, el), 140);
  };
  const onPointerLeave = () => {
    window.clearTimeout(hoverTimer.current);
    if (!press.current?.longPressed) setTip(null);
  };

  const renderSlot = (index: number, style?: CSSProperties) => {
    const id = idAt(index);
    const pokemon = id != null ? byId.get(id) ?? null : null;
    const pos = posAt(index);
    const state = slotState?.(index);
    const interactive = !!onSlotClick || !!onSwap;
    const classes = [
      'slot',
      pokemon ? 'slot--filled' : 'slot--empty',
      state ? `slot--${state}` : '',
      highlight?.includes(index) ? 'slot--highlight' : '',
      drag?.from === index ? 'slot--drag-src' : '',
      drag && drag.over === index && drag.from !== index ? 'slot--drag-over' : '',
      onSwap && pokemon && state !== 'locked' ? 'slot--draggable' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const label = pokemon
      ? t.builder.pitch.filled(t.game.posName[pos], t.game.pokemon(pokemon), !!onSlotClick)
      : t.builder.pitch.empty(t.game.posName[pos], !!onSlotClick);
    const content = <PlayerToken key={`${index}-${id ?? 'x'}`} pos={pos} pokemon={pokemon} sprite={sprite} />;
    if (!interactive) {
      return (
        <div
          key={index}
          className={classes}
          style={style}
          data-slot-index={index}
          aria-label={label}
          onPointerEnter={(e) => onPointerEnter(e, index)}
          onPointerLeave={onPointerLeave}
          onPointerDown={(e) => {
            window.clearTimeout(hoverTimer.current);
            if (tooltips && e.pointerType !== 'mouse') onPointerDown(e, index);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {content}
        </div>
      );
    }
    return (
      <button
        key={index}
        type="button"
        className={classes}
        style={style}
        data-slot-index={index}
        aria-label={label}
        onClick={() => onClick(index)}
        onPointerDown={(e) => onPointerDown(e, index)}
        onPointerEnter={(e) => onPointerEnter(e, index)}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        {content}
      </button>
    );
  };

  const dragPokemon = drag ? byId.get(idAt(drag.from) ?? -1) : undefined;

  return (
    <div
      ref={wrapRef}
      className={`pitch-wrap ${drag ? 'is-dragging' : ''} ${className}`}
      style={{ ['--pw' as string]: `${pw || 560}px`, ['--ps' as string]: (pw || 560) / 560 }}
    >
      <div className="pitch" role="group" aria-label={ariaLabel ?? t.builder.pitch.label}>
        <PitchMarkings />
        {defs.map((d, i) => renderSlot(i, { left: `${d.x}%`, top: `${d.y}%`, zIndex: Math.round(d.y) }))}
      </div>
      {ss !== undefined && (
        <div className="bench">
          <span className="bench__label">{t.game.posName.SS}</span>
          {renderSlot(SS_INDEX)}
          <span className="bench__note">{t.builder.pitch.ssNote}</span>
        </div>
      )}
      {tip &&
        (tip.pokemon ? (
          <StatTooltip pokemon={tip.pokemon} anchor={tip.rect} pos={positionTips ? tip.pos : undefined} />
        ) : (
          <PositionTooltip pos={tip.pos} anchor={tip.rect} />
        ))}
      {drag &&
        dragPokemon &&
        createPortal(
          <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            <Sprite pokemon={dragPokemon} style={sprite} loading="eager" />
          </div>,
          document.body,
        )}
    </div>
  );
}
