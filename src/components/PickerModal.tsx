import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import type { PosCode, Pokemon, RegionFilter, SpriteStyle } from '../types';
import { PosBadge } from './Badges';
import { FilterBar, useFilteredPokemon, type PokemonFilters } from './FilterBar';
import { Modal } from './Modal';
import { PokemonGrid } from './PokemonGrid';
import { PositionKeys } from './StatTooltip';

interface Props {
  pos: PosCode;
  pool: Pokemon[];
  initialRegion: RegionFilter;
  sprite: SpriteStyle;
  currentId: number | null;
  /** Pokémon, die bereits auf dem Feld stehen → Positionskürzel */
  onField: Map<number, PosCode>;
  onPick: (id: number | null) => void;
  onClose: () => void;
}

/** „Wähle ein Pokémon" – Suche, Typ-/Regionsfilter, Raster, Tastatur (Pfeile, Enter, Esc). */
export function PickerModal({ pos, pool, initialRegion, sprite, currentId, onField, onPick, onClose }: Props) {
  const t = useT();
  const [filters, setFilters] = useState<PokemonFilters>({ query: '', type: null, region: initialRegion });
  const items = useFilteredPokemon(pool, filters);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Am Desktop direkt tippen können; am Handy nicht ungefragt die Tastatur öffnen
  // (dort bleibt der Fokus auf dem Dialog selbst).
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus();
  }, []);

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && items[0]) {
      e.preventDefault();
      onPick(items[0].id);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      bodyRef.current?.querySelector<HTMLElement>('.pgrid [data-grid-item]')?.focus();
    }
  };

  return (
    <Modal
      className="picker"
      labelId="picker-title"
      onClose={onClose}
      title={
        <>
          <PosBadge pos={pos} /> {t.builder.picker.title} <span className="picker__pos">{t.game.posName[pos]}</span>
        </>
      }
    >
      <div ref={bodyRef} className="picker__body">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          searchRef={searchRef}
          onSearchKeyDown={onSearchKeyDown}
          resultCount={items.length}
        />
        <PositionKeys pos={pos} />
        <p className="hint hint--small">{t.builder.picker.swapHint}</p>
        <PokemonGrid
          items={items}
          sprite={sprite}
          selectedId={currentId}
          emptyOption={{ label: t.builder.picker.emptySlot, onPick: () => onPick(null) }}
          note={(p) => {
            const at = onField.get(p.id);
            return at && p.id !== currentId ? t.builder.picker.onField(t.game.posShort[at]) : null;
          }}
          onPick={(p) => onPick(p.id)}
          tipPos={pos}
        />
      </div>
    </Modal>
  );
}
