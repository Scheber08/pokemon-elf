import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { usePokemonData } from '../state/PokemonData';
import type { SpriteStyle } from '../types';
import { Sprite } from './Sprite';

interface Props {
  /** Bankplätze (Pokémon-ID oder leer) */
  bench: (number | null)[];
  sprite: SpriteStyle;
  /** Klick auf einen Bankplatz (Index) – ohne: nur Anzeige */
  onClick?: (index: number) => void;
  /** Zustand je Platz: Ziel (anklickbar) bzw. ausgewählt */
  state?: (index: number) => 'target' | 'selected' | undefined;
  /** Zusatz unter dem Namen (z. B. Tagesform) */
  extra?: (pokemonId: number) => ReactNode;
}

/** Bank der Manager-Saison: Pokémon neben dem Feld (Draft und Aufstellung). */
export function BenchRow({ bench, sprite, onClick, state, extra }: Props) {
  const t = useT();
  const { byId } = usePokemonData();
  const tx = t.draft.bench;
  return (
    <div className="bench draft-bench" role="group" aria-label={tx.label}>
      <span className="bench__label">{tx.label}</span>
      <ul className="draft-bench__list">
        {bench.map((id, i) => {
          const p = id != null ? byId.get(id) : undefined;
          const st = state?.(i);
          const content = p ? (
            <>
              <Sprite pokemon={p} style={sprite} className="draft-bench__sprite" />
              <span className="draft-bench__name">{t.game.pokemon(p)}</span>
              {extra?.(p.id)}
            </>
          ) : (
            <span className="draft-bench__empty">{tx.empty(i + 1)}</span>
          );
          const cls = `draft-bench__slot ${p ? 'is-filled' : 'is-empty'} ${st ? `is-${st}` : ''}`;
          return (
            <li key={i}>
              {onClick ? (
                <button
                  type="button"
                  className={cls}
                  aria-pressed={st === 'selected'}
                  aria-label={p ? tx.filledAria(i + 1, t.game.pokemon(p)) : tx.emptyAria(i + 1)}
                  onClick={() => onClick(i)}
                >
                  {content}
                </button>
              ) : (
                <div className={cls}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
