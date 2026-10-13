/** Spielbegriffe (Deutsch) – Positionen, Profile, Werte, Typen, Regionen, Challenges, Vereine. */
import type { ChallengeKey, FactorKey, PosCode, Pokemon, ProfileKey, TypeKey } from '../../types';

const game = {
  /** Positionskürzel auf Namensschildern */
  posShort: {
    TW: 'TW', IV: 'IV', LV: 'LV', RV: 'RV', LWB: 'LWB', RWB: 'RWB', DM: 'DM', ZM: 'ZM',
    OM: 'OM', LM: 'LM', RM: 'RM', LF: 'LF', RF: 'RF', ST: 'ST', SS: 'SS',
  } as Record<PosCode, string>,
  posName: {
    TW: 'Torwart', IV: 'Innenverteidiger', LV: 'Linker Verteidiger', RV: 'Rechter Verteidiger',
    LWB: 'Linker Schienenspieler', RWB: 'Rechter Schienenspieler', DM: 'Defensives Mittelfeld',
    ZM: 'Zentrales Mittelfeld', OM: 'Offensives Mittelfeld', LM: 'Linkes Mittelfeld', RM: 'Rechtes Mittelfeld',
    LF: 'Linksaußen', RF: 'Rechtsaußen', ST: 'Stürmer', SS: 'Standardschütze',
  } as Record<PosCode, string>,
  /** Kürzel-Gruppen für den Scouting-Guide */
  profileCodes: {
    TW: 'TW', IV: 'IV', AV: 'LV/RV', WB: 'LWB/RWB', DM: 'DM', ZM: 'ZM', OM: 'OM', FM: 'LM/RM', FL: 'LF/RF', ST: 'ST', SS: 'SS',
  } as Record<ProfileKey, string>,
  profileTitle: {
    TW: 'Torwart', IV: 'Innenverteidiger', AV: 'Außenverteidiger', WB: 'Schienenspieler', DM: 'Sechser',
    ZM: 'Zentrales Mittelfeld', OM: 'Zehner', FM: 'Außenbahn', FL: 'Flügelstürmer', ST: 'Stürmer', SS: 'Standardschütze',
  } as Record<ProfileKey, string>,
  profileRole: {
    TW: 'Hält Bälle, organisiert die Abwehr.',
    IV: 'Zweikämpfe und Kopfbälle.',
    AV: 'Verteidigen die Flanke und schalten sich ein.',
    WB: 'Die ganze Seitenlinie rauf und runter.',
    DM: 'Balleroberer vor der Abwehr.',
    ZM: 'Taktgeber und Box-to-Box.',
    OM: 'Kreativspieler hinter den Spitzen.',
    FM: 'Flanken und Tempo.',
    FL: 'Dribbling und Abschluss von außen.',
    ST: 'Tore schießen, Bälle festmachen.',
    SS: 'Freistöße und Elfmeter. Optional, zählt nicht zum Team-Score.',
  } as Record<ProfileKey, string>,
  profileNotes: {
    TW: { spd: 'Reflexe/Ruhe' },
    AV: { hp: 'Ausdauer' },
    ZM: { spa: 'Passspiel', spd: 'Spielübersicht' },
    ST: { atk: 'Schusskraft', spa: 'Abschluss', height: 'Kopfball' },
    SS: { spa: 'Technik', atk: 'Schusskraft' },
  } as Partial<Record<ProfileKey, Partial<Record<FactorKey, string>>>>,
  /** Kurze Faktor-Labels (Tabellen) */
  factor: {
    hp: 'KP', atk: 'ANG', def: 'VERT', spa: 'SP.ANG', spd: 'SP.VERT', spe: 'INIT', height: 'GRÖSSE', weight: 'GEWICHT',
  } as Record<FactorKey, string>,
  factorLong: {
    hp: 'KP', atk: 'Angriff', def: 'Verteidigung', spa: 'Sp.-Angriff', spd: 'Sp.-Verteidigung', spe: 'Initiative',
    height: 'Größe', weight: 'Gewicht',
  } as Record<FactorKey, string>,
  level: { 3: 'Schlüssel', 2: 'Hilft', 1: 'Kleiner Anteil', 0: 'Zählt nicht' } as Record<0 | 1 | 2 | 3, string>,
  type: {
    normal: 'Normal', fire: 'Feuer', water: 'Wasser', electric: 'Elektro', grass: 'Pflanze', ice: 'Eis',
    fighting: 'Kampf', poison: 'Gift', ground: 'Boden', flying: 'Flug', psychic: 'Psycho', bug: 'Käfer',
    rock: 'Gestein', ghost: 'Geist', dragon: 'Drache', dark: 'Unlicht', steel: 'Stahl', fairy: 'Fee',
  } as Record<TypeKey, string>,
  /** Regionen nach Generation (1–9) */
  region: ['', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Einall', 'Kalos', 'Alola', 'Galar', 'Paldea'],
  allRegions: 'Alle',
  challenge: {
    c340: '34–0 Challenge',
    daily: 'Tägliche Elf',
    retro340: 'Retro 34–0',
    c151: '151 Challenge',
  } as Record<ChallengeKey, string>,
  legendary: 'Legendär',
  mythical: 'Mysteriös',
  ultraBeast: 'Ultrabestie',
  mega: 'Mega',
  /** Name eines Pokémon in dieser Sprache */
  pokemon: (p: Pick<Pokemon, 'de' | 'en'>) => p.de,
  /** Vereinsname (intern deutsch gespeichert) in dieser Sprache */
  club: (name: string) => name,
  /** Nationaldex-Nummer */
  dexNo: (id: number) => `Nr. ${String(id).padStart(4, '0')}`,
  /** „12.10.2026" aus „2026-10-12" */
  day: (day: string) => {
    const [y, m, d] = day.split('-');
    return `${d}.${m}.${y}`;
  },
};

export default game;
