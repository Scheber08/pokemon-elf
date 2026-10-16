import { RAINBOW_TYPES, TYPES, dominantType, typeVariety } from '../config/pokemonTypes';
import { useT } from '../i18n';
import type { Pokemon } from '../types';

/**
 * Typ-Elf (ab vier Pokémon eines Typs, z. B. „Feuer ×4“) und 🌈 Typen-Regenbogen (ab RAINBOW_TYPES Typen) über dem Feld
 * – wie die Chips auf dem Draft-Board, aber ohne Draft-Code (Builder und Challenges liegen im Start-Paket).
 */
export function TypeChips({ pokemon }: { pokemon: Pokemon[] }) {
  const t = useT();
  const dom = dominantType(pokemon);
  const variety = typeVariety(pokemon);
  if (!dom && variety < RAINBOW_TYPES) return null;
  const domLabel = dom ? t.draft.board.typeTitle(t.game.type[dom.type], dom.n) : '';
  return (
    <p className="builder__types">
      {dom && (
        <span className="builder__type" title={domLabel} style={{ background: TYPES[dom.type].color, color: TYPES[dom.type].text }}>
          <span aria-hidden="true">
            {t.game.type[dom.type]} ×{dom.n}
          </span>
          <span className="sr-only">{domLabel}</span>
        </span>
      )}
      {variety >= RAINBOW_TYPES && (
        <span className="builder__type builder__rainbow" title={t.draft.board.rainbowTitle(variety)}>
          <span aria-hidden="true">🌈 {variety}</span>
          <span className="sr-only">{t.draft.board.rainbowTitle(variety)}</span>
        </span>
      )}
    </p>
  );
}
