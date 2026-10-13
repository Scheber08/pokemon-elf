import { useMemo, type KeyboardEvent, type RefObject } from 'react';
import { TYPE_KEYS, TYPES } from '../config/pokemonTypes';
import { REGIONS } from '../config/regions';
import { useT } from '../i18n';
import type { Pokemon, RegionFilter, TypeKey } from '../types';

export interface PokemonFilters {
  query: string;
  type: TypeKey | null;
  region: RegionFilter;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');

/** Suche nach deutschem/englischem Namen oder Nummer („25", „#25", „Nr. 25", „No. 25"). */
export function matchesQuery(p: Pokemon, query: string): boolean {
  const q = fold(query.trim()).replace(/^#|^nr\.?\s*|^no\.?\s*(?=\d)/, '');
  if (!q) return true;
  if (/^\d+$/.test(q)) return String(p.id).startsWith(String(Number(q))) || String(p.id).padStart(4, '0').startsWith(q);
  return fold(p.de).includes(q) || fold(p.en).includes(q);
}

export function useFilteredPokemon(pool: Pokemon[], f: PokemonFilters): Pokemon[] {
  return useMemo(
    () =>
      pool.filter(
        (p) =>
          (f.region === 0 || p.gen === f.region) &&
          (!f.type || p.types.includes(f.type)) &&
          matchesQuery(p, f.query),
      ),
    [pool, f.region, f.type, f.query],
  );
}

interface Props {
  filters: PokemonFilters;
  onChange: (f: PokemonFilters) => void;
  showType?: boolean;
  showRegion?: boolean;
  searchRef?: RefObject<HTMLInputElement | null>;
  onSearchKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  resultCount?: number;
  /** Nur diese Regionen (Generationen) als Filter anbieten – z. B. die des Draft-Pools; fehlt: alle */
  regions?: readonly number[];
}

export function FilterBar({
  filters,
  onChange,
  showType = true,
  showRegion = true,
  searchRef,
  onSearchKeyDown,
  resultCount,
  regions,
}: Props) {
  const t = useT();
  return (
    <div className="filterbar">
      <div className="filterbar__search">
        <label className="sr-only" htmlFor="pokemon-search">
          {t.builder.filter.searchLabel}
        </label>
        <input
          id="pokemon-search"
          ref={searchRef}
          type="search"
          className="input"
          placeholder={t.builder.filter.searchPlaceholder}
          value={filters.query}
          autoComplete="off"
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          onKeyDown={onSearchKeyDown}
        />
        {resultCount != null && (
          <span className="filterbar__count" aria-live="polite">
            {t.builder.filter.results(resultCount)}
          </span>
        )}
      </div>
      {showType && (
        <div className="chips" role="group" aria-label={t.builder.filter.typeFilter}>
          <button
            type="button"
            className={`chip ${!filters.type ? 'is-active' : ''}`}
            aria-pressed={!filters.type}
            onClick={() => onChange({ ...filters, type: null })}
          >
            {t.common.allTypes}
          </button>
          {TYPE_KEYS.map((type) => (
            <button
              key={type}
              type="button"
              className={`chip chip--type ${filters.type === type ? 'is-active' : ''}`}
              style={{ ['--chip-color' as string]: TYPES[type].color, ['--chip-text' as string]: TYPES[type].text }}
              aria-pressed={filters.type === type}
              onClick={() => onChange({ ...filters, type: filters.type === type ? null : type })}
            >
              {t.game.type[type]}
            </button>
          ))}
        </div>
      )}
      {showRegion && (
        <div className="chips" role="group" aria-label={t.builder.filter.regionFilter}>
          <button
            type="button"
            className={`chip ${filters.region === 0 ? 'is-active' : ''}`}
            aria-pressed={filters.region === 0}
            onClick={() => onChange({ ...filters, region: 0 })}
          >
            {t.common.allRegions}
          </button>
          {REGIONS.filter((r) => !regions || regions.includes(r.gen)).map((r) => (
            <button
              key={r.gen}
              type="button"
              className={`chip ${filters.region === r.gen ? 'is-active' : ''}`}
              aria-pressed={filters.region === r.gen}
              onClick={() => onChange({ ...filters, region: r.gen as RegionFilter })}
            >
              {t.game.region[r.gen]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
