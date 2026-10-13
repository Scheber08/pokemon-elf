/** Texte: builder (Deutsch – Quelle). Die englische Fassung in ../en/builder.ts muss dieselben Schlüssel haben. */
import type { StatKey } from '../../types';

const builder = {
  // Builder-Seite
  hintFine:
    'Klicke auf einen Spieler, um ihn auszutauschen, oder fahre darüber für seine Werte. Zieh einen Spieler auf einen anderen, um die Plätze zu tauschen.',
  hintCoarse: 'Tippe auf einen Spieler, um ihn auszutauschen, oder halte gedrückt für seine Werte.',
  pitchAria: (formation: string) => `Spielfeld, Formation ${formation}`,
  actions: 'Aktionen',
  saveImage: 'Bild speichern',
  savingImage: 'Erstelle Bild …',
  random: 'Zufällig',
  reset: 'Zurücksetzen',
  clearAll: 'Alles leeren',
  region: 'Region',
  gen: (gen: number) => `Gen ${gen}`,
  allGens: 'Gen 1–9',
  pool: 'Pokémon / Legendäre',
  poolPokemon: 'Pokémon',
  poolLegends: 'Legendäre',
  /** „Aufstellung aus den ersten 151 Pokémon, ohne Legendäre." */
  description: (regionPhrase: string, legends: boolean) =>
    `Aufstellung ${regionPhrase}, ${legends ? 'mit Legendären und Mysteriösen' : 'ohne Legendäre'}.`,
  formation: 'Formation',
  sprites: 'Sprites',
  teamName: 'Teamname',
  teamNameNote: '(optional, erscheint im Bild)',
  teamNamePlaceholder: 'z. B. Rot-Weiß Alabastia',
  sharedLoaded: 'Geteilte Aufstellung geladen',
  linkUnreadable: 'Der Link konnte nicht gelesen werden',
  imageSaved: 'Bild gespeichert',
  imageFailed: 'Bild konnte nicht erstellt werden',

  /** Spielfeld (auch Challenges und Draft) */
  pitch: {
    label: 'Spielfeld',
    filled: (pos: string, name: string, clickable: boolean) => `${pos}: ${name}${clickable ? ' – austauschen' : ''}`,
    empty: (pos: string, clickable: boolean) => `${pos}: leer${clickable ? ' – Pokémon wählen' : ''}`,
    ssNote: 'zählt nicht zum Team-Score',
  },
  sheet: {
    title: 'Teamblatt',
  },
  picker: {
    title: 'Wähle ein Pokémon',
    swapHint: 'Wählst du jemanden, der schon auf dem Feld steht, tauschen die beiden die Plätze.',
    emptySlot: 'Leerer Slot',
    onField: (pos: string) => `auf dem Feld: ${pos}`,
  },
  filter: {
    searchLabel: 'Pokémon suchen',
    searchPlaceholder: 'Name oder Nummer suchen …',
    results: (n: number) => `${n} Treffer`,
    typeFilter: 'Typ-Filter',
    regionFilter: 'Regions-Filter',
  },
  grid: {
    label: 'Pokémon-Auswahl',
    legShort: 'Leg.',
    mythShort: 'Myst.',
    ubShort: 'UB',
    none: 'Keine Pokémon gefunden.',
    /** Kürzel der Mini-Balken auf den Karten */
    mini: { hp: 'KP', atk: 'ANG', def: 'VER', spa: 'SPA', spd: 'SPV', spe: 'INI' } as Record<StatKey, string>,
  },
  /** Werte- und Positions-Tooltip (auch im Draft) */
  statTip: {
    importantAs: (pos: string) => `Wichtig als ${pos}`,
    /** Vor der Liste der Werte, die auf einer Position zählen (Auswahl-Dialog) */
    countsHere: 'Zählt hier:',
    height: (value: string) => `Größe ${value} m`,
    weight: (value: string) => `Gewicht ${value} kg`,
    typeBonus: 'Typ-Bonus',
    noTypeBonus: 'Kein Typ-Bonus',
    teamWeight: (weight: string) => `Gewicht im Team-Score: ${weight}`,
  },
  /** Exportiertes Bild */
  exportCard: {
    defaultTeam: 'Meine Elf',
    stats: (points: number, score: number, position: number) => `${points} Pkt · Score ${score} · Platz ${position}`,
  },
  /** Laden der Pokémon-Daten beim Start */
  data: {
    loading: 'Lade Kader …',
    error: (detail: string) => `Die Pokémon-Daten konnten nicht geladen werden (${detail}).`,
  },
};

export default builder;
