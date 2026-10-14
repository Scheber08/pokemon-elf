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
  undo: 'Rückgängig',
  /** Meine Teams: gespeicherte Elfen auf diesem Gerät */
  saved: {
    title: 'Meine Teams',
    note: (max: number) => `(bis zu ${max}, nur dieses Gerät)`,
    save: 'Aktuelle Elf speichern',
    load: 'Laden',
    remove: 'Löschen',
    removeAria: (name: string) => `${name} löschen`,
    unnamed: (n: number) => `Elf ${n}`,
    saved: (name: string) => `„${name}" gespeichert`,
    updated: (name: string) => `„${name}" aktualisiert`,
    loaded: (name: string) => `„${name}" geladen`,
    friendly: 'Testspiel',
    friendlyTitle: (name: string) => `Aktuelle Elf gegen ${name} (Hin- und Rückspiel)`,
  },
  best: 'Beste Elf',
  bestTitle: 'Stellt die stärkste Elf aus der gewählten Region und den Einstellungen auf',
  undoTitle: 'Letzte Änderung an der Aufstellung zurücknehmen (Strg/Cmd+Z)',
  redo: 'Wiederholen',
  redoTitle: 'Zurückgenommene Änderung wiederherstellen (Strg+Y bzw. Strg/Cmd+Umschalt+Z)',
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
  forms: 'Formen',
  formsNote: 'Regionalformen (Alola, Galar, Hisui, Paldea) und Sonderformen wie Rotom oder Tiergeist-Formen.',
  megas: 'Megas',
  megasUnlimited: 'Unbegrenzt',
  megasNote: (max: number | null) =>
    max === 0 ? 'Ohne Mega-Entwicklungen.' : max == null ? 'Beliebig viele Megas.' : max === 1 ? 'Höchstens ein Mega in der Elf.' : `Höchstens ${max} Megas in der Elf.`,
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
    megaLimit: (max: number) => (max === 1 ? 'Limit: ein Mega' : `Limit: ${max} Megas`),
    sort: 'Sortierung',
    sortDex: 'Nummer',
    sortFit: 'Beste für die Position',
  },
  filter: {
    searchLabel: 'Pokémon suchen',
    searchPlaceholder: 'Name oder Nummer suchen …',
    /** Tooltip am Suchfeld, wenn „/" dorthin springt */
    slashHint: 'Tastenkürzel: /',
    results: (n: number) => `${n} Treffer`,
    typeFilter: 'Typ-Filter',
    regionFilter: 'Regions-Filter',
  },
  grid: {
    label: 'Pokémon-Auswahl',
    legShort: 'Leg.',
    mythShort: 'Myst.',
    ubShort: 'UB',
    megaShort: 'Mega',
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
