/** Texte: builder (Deutsch – Quelle). Die englische Fassung in ../en/builder.ts muss dieselben Schlüssel haben. */
import type { StatKey } from '../../types';

const builder = {
  // Builder-Seite
  hintFine:
    'Klicke auf einen Spieler, um ihn auszutauschen, oder fahre darüber für seine Werte. Zieh einen Spieler auf einen anderen, um die Plätze zu tauschen.',
  /** Tastenkürzel unter dem Hinweis (nur mit Maus/Tastatur) */
  keysHint: '⌨️ Strg/Cmd+Z rückgängig · Strg+Y wiederholen · im Auswahl-Dialog: tippen sucht, ↓ ins Raster, Enter wählt',
  hintCoarse: 'Tippe auf einen Spieler, um ihn auszutauschen, oder halte gedrückt für seine Werte.',
  pitchAria: (formation: string) => `Spielfeld, Formation ${formation}`,
  pageTitle: 'Lineup-Builder',
  actions: 'Aktionen',
  saveImage: 'Bild speichern',
  jerseys: {
    title: 'Trikotnummern',
    note: 'Nummer 1–99 eintragen (Enter). Ist sie schon vergeben, tauschen die beiden. Die Nummer bleibt beim Pokémon, auch wenn du es umstellst.',
    bench: 'Bank',
    aria: (name: string) => `Trikotnummer von ${name}`,
    reset: 'Alle auf Standard zurücksetzen',
    dex: 'Pokédex-Nummern',
    dexTitle: 'Jedes Pokémon bekommt die letzten beiden Ziffern seiner Pokédex-Nummer (Doppelte behalten die Vorgabe)',
    random: 'Würfeln',
    randomTitle: 'Zufällige, eindeutige Nummern von 1 bis 99',
  },
  savingImage: 'Erstelle Bild …',
  random: 'Zufällig',
  copyText: 'Als Text kopieren',
  textCopied: 'Aufstellung als Text kopiert',
  textCaptain: ' (K)',
  textHeader: (name: string, formation: string) => `⚽ ${name || 'Meine Elf'} (${formation})`,
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
    /** Volle Liste: diese Elf fällt beim Speichern weg */
    full: (name: string) => `Liste voll – beim Speichern fällt die älteste weg: „${name}“`,
    current: '✓ aktuell',
    score: (n: number) => `Score ${n}`,
    /** Eindeutig stärkste gespeicherte Elf (höchster Team-Score) */
    strongest: 'Deine stärkste gespeicherte Elf',
    scoreTitle: 'Team-Score über alle 1.025 Pokémon (mit Kapitän) – wie im Testspiel',
    loaded: (name: string) => `„${name}" geladen`,
    friendly: 'Testspiel',
    link: 'Link',
    linkTitle: (name: string) => `Link zu ${name} kopieren`,
    loadingFriendly: 'Testspiel wird geladen …',
    friendlyTitle: (name: string) => `Aktuelle Elf gegen ${name} (Hin- und Rückspiel)`,
  },
  best: 'Beste Elf',
  fillGaps: 'Lücken füllen',
  fillGapsTitle: 'Besetzt nur die leeren Plätze mit den bestpassenden Pokémon – deine Spieler bleiben',
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
    avgFit: (n: number) => `Ø Fit ${n}`,
    fit: (n: number) => `Fit ${n}`,
    /** Eindeutig schwächster Fit der vollen Elf */
    /** Eindeutig stärkster Fit der vollen Elf */
    strongest: 'Stärkster Fit der Elf',
    weakest: 'Schwächster Fit der Elf – hier lohnt ein Tausch',
  },
  picker: {
    title: 'Wähle ein Pokémon',
    /** Wer gerade auf der Position steht – mit Fit zum Vergleich */
    current: (name: string, fit: number) => `Aktuell hier: ${name} (Fit ${fit})`,
    swapHint: 'Wählst du jemanden, der schon auf dem Feld steht, tauschen die beiden die Plätze.',
    emptySlot: 'Leerer Slot',
    onField: (pos: string) => `auf dem Feld: ${pos}`,
    megaLimit: (max: number) => (max === 1 ? 'Limit: ein Mega' : `Limit: ${max} Megas`),
    sort: 'Sortierung',
    sortDex: 'Nummer',
    sortFit: 'Beste für die Position',
    hideOnField: 'Aufgestellte ausblenden',
    /** Fit auf der Position, dazu (falls belegt) die Differenz zum aktuellen Spieler */
    fitNote: (fit: number, diff: number | null = null) => (diff ? `Fit ${fit} · ${diff > 0 ? '+' : '−'}${Math.abs(diff)}` : `Fit ${fit}`),
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
