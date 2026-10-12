import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildScale, type Scale } from '../lib/fit';
import type { Pokemon } from '../types';

export type ScaleKind = 'all' | 'gen1';

export interface PokemonData {
  list: Pokemon[];
  byId: Map<number, Pokemon>;
  /** Normalisierung über alle Pokémon oder nur Gen 1 (Retro / 151 Challenge). */
  scale(kind: ScaleKind): Scale;
}

const Ctx = createContext<PokemonData | null>(null);

export function PokemonDataProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Pokemon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scales = useRef(new Map<ScaleKind, Scale>());

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`${import.meta.env.BASE_URL}data/pokemon.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Pokemon[]>;
      })
      .then((data) => !cancelled && setList(data))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const scale = useCallback(
    (kind: ScaleKind) => {
      let s = scales.current.get(kind);
      if (!s && list) {
        s = buildScale(kind === 'gen1' ? list.filter((p) => p.gen === 1) : list, kind);
        scales.current.set(kind, s);
      }
      return s!;
    },
    [list],
  );

  const value = useMemo<PokemonData | null>(
    () => (list ? { list, byId: new Map(list.map((p) => [p.id, p])), scale } : null),
    [list, scale],
  );

  if (error) {
    return (
      <div className="boot boot--error" role="alert">
        <p>Die Pokémon-Daten konnten nicht geladen werden ({error}).</p>
        <button className="btn btn--primary" onClick={() => setAttempt((a) => a + 1)}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="boot" role="status" aria-live="polite">
        <div className="boot__ball" aria-hidden="true" />
        <p>Lade Kader …</p>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePokemonData(): PokemonData {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePokemonData außerhalb des Providers');
  return v;
}
