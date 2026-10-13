/** Texts: builder (English). Must have exactly the keys of ../de/builder.ts (checked by TypeScript). */
import type { Messages } from '../de';

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st … */
const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

const builder: Messages['builder'] = {
  hintFine: 'Click a player to replace them, or hover over them to see their stats. Drag a player onto another to swap places.',
  hintCoarse: 'Tap a player to replace them, or press and hold to see their stats.',
  pitchAria: (formation) => `Pitch, formation ${formation}`,
  actions: 'Actions',
  saveImage: 'Save image',
  savingImage: 'Creating image …',
  random: 'Random',
  reset: 'Reset',
  clearAll: 'Clear all',
  region: 'Region',
  gen: (gen) => `Gen ${gen}`,
  allGens: 'Gen 1–9',
  pool: 'Pokémon / Legendaries',
  poolPokemon: 'Pokémon',
  poolLegends: 'Legendaries',
  description: (regionPhrase, legends) =>
    `Lineup ${regionPhrase}, ${legends ? 'including legendaries and mythicals' : 'no legendaries'}.`,
  forms: 'Forms',
  formsNote: 'Regional forms (Alola, Galar, Hisui, Paldea) and special forms such as Rotom or Therian Formes.',
  megas: 'Megas',
  megasUnlimited: 'Unlimited',
  megasNote: (max) =>
    max === 0 ? 'No Mega Evolutions.' : max == null ? 'As many Megas as you like.' : max === 1 ? 'At most one Mega in the lineup.' : `At most ${max} Megas in the lineup.`,
  formation: 'Formation',
  sprites: 'Sprites',
  teamName: 'Team name',
  teamNameNote: '(optional, shown in the image)',
  teamNamePlaceholder: 'e.g. Pallet Town Rovers',
  sharedLoaded: 'Shared lineup loaded',
  linkUnreadable: 'The link could not be read',
  imageSaved: 'Image saved',
  imageFailed: 'Couldn’t create the image',

  pitch: {
    label: 'Pitch',
    filled: (pos, name, clickable) => `${pos}: ${name}${clickable ? ' – replace' : ''}`,
    empty: (pos, clickable) => `${pos}: empty${clickable ? ' – pick a Pokémon' : ''}`,
    ssNote: 'doesn’t count towards the team score',
  },
  sheet: {
    title: 'Team sheet',
  },
  picker: {
    title: 'Pick a Pokémon',
    swapHint: 'Pick someone who’s already on the pitch and the two swap places.',
    emptySlot: 'Empty slot',
    onField: (pos) => `on the pitch: ${pos}`,
    megaLimit: (max) => (max === 1 ? 'Limit: one Mega' : `Limit: ${max} Megas`),
  },
  filter: {
    searchLabel: 'Search Pokémon',
    searchPlaceholder: 'Search name or number …',
    results: (n) => (n === 1 ? '1 result' : `${n} results`),
    typeFilter: 'Type filter',
    regionFilter: 'Region filter',
  },
  grid: {
    label: 'Pokémon selection',
    legShort: 'Leg.',
    mythShort: 'Myth.',
    ubShort: 'UB',
    megaShort: 'Mega',
    none: 'No Pokémon found.',
    mini: { hp: 'HP', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD', spe: 'SPE' },
  },
  statTip: {
    importantAs: (pos) => `What counts at ${pos}`,
    countsHere: 'What counts here:',
    height: (value) => `Height ${value} m`,
    weight: (value) => `Weight ${value} kg`,
    typeBonus: 'Type bonus',
    noTypeBonus: 'No type bonus',
    teamWeight: (weight) => `Team score weighting: ${weight}`,
  },
  exportCard: {
    defaultTeam: 'My XI',
    stats: (points, score, position) => `${points} pts · Score ${score} · ${ordinal(position)} place`,
  },
  data: {
    loading: 'Loading squad …',
    error: (detail) => `Couldn’t load the Pokémon data (${detail}).`,
  },
};

export default builder;
