import type { TypeKey } from '../types';

/** Deutsche Typnamen und offizielle Typfarben. */
export const TYPES: Record<TypeKey, { de: string; color: string; text: string }> = {
  normal: { de: 'Normal', color: '#A8A77A', text: '#1a1a1a' },
  fire: { de: 'Feuer', color: '#EE8130', text: '#1a1a1a' },
  water: { de: 'Wasser', color: '#6390F0', text: '#0b1020' },
  electric: { de: 'Elektro', color: '#F7D02C', text: '#1a1a1a' },
  grass: { de: 'Pflanze', color: '#7AC74C', text: '#1a1a1a' },
  ice: { de: 'Eis', color: '#96D9D6', text: '#1a1a1a' },
  fighting: { de: 'Kampf', color: '#C22E28', text: '#ffffff' },
  poison: { de: 'Gift', color: '#A33EA1', text: '#ffffff' },
  ground: { de: 'Boden', color: '#E2BF65', text: '#1a1a1a' },
  flying: { de: 'Flug', color: '#A98FF3', text: '#1a1a1a' },
  psychic: { de: 'Psycho', color: '#F95587', text: '#1a1a1a' },
  bug: { de: 'Käfer', color: '#A6B91A', text: '#1a1a1a' },
  rock: { de: 'Gestein', color: '#B6A136', text: '#1a1a1a' },
  ghost: { de: 'Geist', color: '#735797', text: '#ffffff' },
  dragon: { de: 'Drache', color: '#6F35FC', text: '#ffffff' },
  dark: { de: 'Unlicht', color: '#705746', text: '#ffffff' },
  steel: { de: 'Stahl', color: '#B7B7CE', text: '#1a1a1a' },
  fairy: { de: 'Fee', color: '#D685AD', text: '#1a1a1a' },
};

export const TYPE_KEYS = Object.keys(TYPES) as TypeKey[];
