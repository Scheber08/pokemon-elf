/** Builder: „🌈 noch n Typen bis zum Regenbogen“ bei 8 oder 9 Typen (nur mit size, also im Builder). */
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RAINBOW_TYPES, typeVariety } from '../src/config/pokemonTypes';
import { TypeChips } from '../src/components/TypeChips';
import { ALL } from './helpers';

/** Pokémon mit genau n verschiedenen Typen (je ein einfarbiges Pokémon pro Typ, ohne Typ-Elf) */
function withTypes(n: number) {
  const seen = new Set<string>();
  const out = [];
  for (const p of ALL) {
    if (p.types.length !== 1 || seen.has(p.types[0])) continue;
    seen.add(p.types[0]);
    out.push(p);
    if (out.length === n) break;
  }
  expect(typeVariety(out)).toBe(n);
  return out;
}

describe('TypeChips: knapp vor dem Regenbogen', () => {
  it('8 und 9 Typen im Builder: Hinweis mit fehlender Anzahl; 7 oder ohne size: keiner', () => {
    expect(renderToStaticMarkup(h(TypeChips, { pokemon: withTypes(RAINBOW_TYPES - 2), size: true }))).toContain('🌈 noch 2 Typen bis zum Regenbogen');
    expect(renderToStaticMarkup(h(TypeChips, { pokemon: withTypes(RAINBOW_TYPES - 1), size: true }))).toContain('🌈 noch ein Typ bis zum Regenbogen');
    expect(renderToStaticMarkup(h(TypeChips, { pokemon: withTypes(RAINBOW_TYPES - 3), size: true }))).not.toContain('Regenbogen');
    expect(renderToStaticMarkup(h(TypeChips, { pokemon: withTypes(RAINBOW_TYPES - 1) }))).toBe('');
    // Ab dem Regenbogen kein Hinweis mehr, sondern der 🌈-Chip
    const full = renderToStaticMarkup(h(TypeChips, { pokemon: withTypes(RAINBOW_TYPES), size: true }));
    expect(full).not.toContain('bis zum Regenbogen');
    expect(full).toContain(`🌈 ${RAINBOW_TYPES}`);
  });
});
