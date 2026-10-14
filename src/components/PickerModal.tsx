import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { positionFit } from '../lib/fit';
import { load, save } from '../lib/storage';
import { usePokemonData } from '../state/PokemonData';
import type { PosCode, Pokemon, RegionFilter, SpriteStyle } from '../types';
import { PosBadge } from './Badges';
import { FilterBar, useFilteredPokemon, type PokemonFilters } from './FilterBar';
import { Modal } from './Modal';
import { PokemonGrid } from './PokemonGrid';
import { Segmented } from './Segmented';
import { PositionKeys } from './StatTooltip';

type SortMode = 'dex' | 'fit';
const SORT_KEY = 'picker-sort';

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
  /** Grund, warum ein Pokémon gerade nicht wählbar ist (z. B. Mega-Limit) – null = wählbar */
  disabledReason?: (p: Pokemon) => string | null;
}

/** „Wähle ein Pokémon" – Suche, Typ-/Regionsfilter, Raster, Tastatur (Pfeile, Enter, Esc). */
export function PickerModal({ pos, pool, initialRegion, sprite, currentId, onField, onPick, onClose, disabledReason }: Props) {
  const t = useT();
  const [filters, setFilters] = useState<PokemonFilters>({ query: '', type: null, region: initialRegion });
  const { scale } = usePokemonData();
  // Sortierung merken: nach Nummer oder „Beste für diese Position zuerst"
  const [sort, setSort] = useState<SortMode>(() => (load<string>(SORT_KEY, 'dex') === 'fit' ? 'fit' : 'dex'));
  const sorted = useMemo(() => {
    if (sort !== 'fit') return pool;
    const sc = scale('all');
    const fit = new Map(pool.map((p) => [p.id, positionFit(p, pos, sc)]));
    return [...pool].sort((a, b) => fit.get(b.id)! - fit.get(a.id)! || a.id - b.id);
  }, [pool, sort, pos, scale]);
  const items = useFilteredPokemon(sorted, filters);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Am Desktop direkt tippen können; am Handy nicht ungefragt die Tastatur öffnen
  // (dort bleibt der Fokus auf dem Dialog selbst).
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus();
  }, []);

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const first = items.find((p) => !disabledReason?.(p));
    if (e.key === 'Enter' && first) {
      e.preventDefault();
      onPick(first.id);
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
        <Segmented
          label={t.builder.picker.sort}
          value={sort}
          onChange={(v) => {
            setSort(v);
            save(SORT_KEY, v);
          }}
          options={[
            { value: 'dex', label: t.builder.picker.sortDex },
            { value: 'fit', label: t.builder.picker.sortFit },
          ]}
        />
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
          disabledReason={disabledReason}
          tipPos={pos}
        />
      </div>
    </Modal>
  );
}
