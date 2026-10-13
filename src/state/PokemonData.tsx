import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { byDex } from '../config/categories';
import { useT } from '../i18n';
import { buildScale, type Scale } from '../lib/fit';
import type { Pokemon } from '../types';

export type ScaleKind = 'all' | 'gen1';

export interface PokemonData {
  /** Die 1.025 Pokémon (Basis aller Challenges und der Normalisierung) */
  list: Pokemon[];
  /** Formen: Megas, Regional- und sonstige Formen (public/data/forms.json) */
  forms: Pokemon[];
  /** Pokémon und Formen, nach Pokédex-Nummer (Formen hinter ihrer Art) */
  all: Pokemon[];
  /** Pokémon und Formen */
  byId: Map<number, Pokemon>;
  /** Normalisierung über alle Pokémon oder nur Gen 1 (Retro / 151 Challenge). */
  scale(kind: ScaleKind): Scale;
}

const Ctx = createContext<PokemonData | null>(null);

export function PokemonDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<{ list: Pokemon[]; forms: Pokemon[] } | null>(null);
  const list = data?.list ?? null;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scales = useRef(new Map<ScaleKind, Scale>());
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const get = (file: string) =>
      fetch(`${import.meta.env.BASE_URL}data/${file}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Pokemon[]>;
      });
    // Formen sind eine Zugabe: Fehlen sie (Netz, alter Cache), geht es ohne sie weiter
    Promise.all([get('pokemon.json'), get('forms.json').then(
      (f) => (Array.isArray(f) ? f : []),
      (): Pokemon[] => [],
    )])
      .then(([list, forms]) => !cancelled && setData({ list, forms }))
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

  const value = useMemo<PokemonData | null>(() => {
    if (!data) return null;
    const all = [...data.list, ...data.forms].sort(byDex);
    return { list: data.list, forms: data.forms, all, byId: new Map(all.map((p) => [p.id, p])), scale };
  }, [data, scale]);

  if (error) {
    return (
      <div className="boot boot--error" role="alert">
        <p>{t.builder.data.error(error)}</p>
        <button className="btn btn--primary" onClick={() => setAttempt((a) => a + 1)}>
          {t.common.retry}
        </button>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="boot" role="status" aria-live="polite">
        <div className="boot__ball" aria-hidden="true" />
        <p>{t.builder.data.loading}</p>
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
