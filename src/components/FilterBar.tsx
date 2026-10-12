import { useMemo, type KeyboardEvent, type RefObject } from 'react';
import { TYPE_KEYS, TYPES } from '../config/pokemonTypes';
import { REGIONS } from '../config/regions';
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

/** Suche nach deutschem/englischem Namen oder Nummer. */
export function matchesQuery(p: Pokemon, query: string): boolean {
  const q = fold(query.trim()).replace(/^#|^nr\.?\s*/, '');
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
}

export function FilterBar({ filters, onChange, showType = true, showRegion = true, searchRef, onSearchKeyDown, resultCount }: Props) {
  return (
    <div className="filterbar">
      <div className="filterbar__search">
        <label className="sr-only" htmlFor="pokemon-search">
          Pokémon suchen
        </label>
        <input
          id="pokemon-search"
          ref={searchRef}
          type="search"
          className="input"
          placeholder="Name oder Nummer suchen …"
          value={filters.query}
          autoComplete="off"
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          onKeyDown={onSearchKeyDown}
        />
        {resultCount != null && (
          <span className="filterbar__count" aria-live="polite">
            {resultCount} Treffer
          </span>
        )}
      </div>
      {showType && (
        <div className="chips" role="group" aria-label="Typ-Filter">
          <button
            type="button"
            className={`chip ${!filters.type ? 'is-active' : ''}`}
            aria-pressed={!filters.type}
            onClick={() => onChange({ ...filters, type: null })}
          >
            Alle Typen
          </button>
          {TYPE_KEYS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip chip--type ${filters.type === t ? 'is-active' : ''}`}
              style={{ ['--chip-color' as string]: TYPES[t].color, ['--chip-text' as string]: TYPES[t].text }}
              aria-pressed={filters.type === t}
              onClick={() => onChange({ ...filters, type: filters.type === t ? null : t })}
            >
              {TYPES[t].de}
            </button>
          ))}
        </div>
      )}
      {showRegion && (
        <div className="chips" role="group" aria-label="Regions-Filter">
          <button
            type="button"
            className={`chip ${filters.region === 0 ? 'is-active' : ''}`}
            aria-pressed={filters.region === 0}
            onClick={() => onChange({ ...filters, region: 0 })}
          >
            Alle Regionen
          </button>
          {REGIONS.map((r) => (
            <button
              key={r.gen}
              type="button"
              className={`chip ${filters.region === r.gen ? 'is-active' : ''}`}
              aria-pressed={filters.region === r.gen}
              onClick={() => onChange({ ...filters, region: r.gen as RegionFilter })}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
