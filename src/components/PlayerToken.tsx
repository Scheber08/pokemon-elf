import { useT } from '../i18n';
import type { PosCode, Pokemon, SpriteStyle } from '../types';
import { PosBadge } from './Badges';
import { Sprite, type SpriteSource } from './Sprite';

interface Props {
  pos: PosCode;
  pokemon: Pokemon | null | undefined;
  sprite: SpriteStyle;
  /** Vorbereitete Bildquelle für den Bild-Export */
  source?: SpriteSource;
}

/** Spieler auf dem Feld: Sprite über einem Namensschild – oder ein leerer, gestrichelter Slot. */
export function PlayerToken({ pos, pokemon, sprite, source }: Props) {
  const t = useT();
  if (!pokemon) {
    return (
      <span className="token token--empty">
        <span className="token__ring">
          <span className="token__ring-label">{t.game.posShort[pos]}</span>
        </span>
      </span>
    );
  }
  return (
    <span className="token">
      <span className="token__sprite-wrap">
        <Sprite pokemon={pokemon} style={sprite} className="token__sprite" loading="eager" source={source} />
      </span>
      <span className="token__plate">
        <PosBadge pos={pos} className="token__pos" />
        <span className="token__name">{t.game.pokemon(pokemon)}</span>
      </span>
    </span>
  );
}
