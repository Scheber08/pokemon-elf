/** Game vocabulary (English) – positions, profiles, stats, types, regions, challenges, clubs. */
import { CLUB_NAMES } from '../../config/season';
import type { Messages } from '../de';

/** English club names, same order as CLUB_NAMES (German, used internally and for determinism). */
const CLUBS_EN = [
  'FC Celadon',
  'Viridian 04',
  'SV Vermilion',
  'Cerulean Waves',
  'Pewter 1910',
  'Lavender Ghosts',
  'Fuchsia Ninjas',
  'Saffron United',
  'Cinnabar Kickers',
  'Pallet United',
  'Goldenrod City FC',
  'Ecruteak Red-White',
  'Blackthorn Athletic',
  'Victoria Violet',
  'Rapid Cherrygrove',
  'Dynamo Mahogany',
  'Olivine Sporting',
  'Azalea Albion',
  'New Bark Rovers',
  'Cianwood Wanderers',
  'Borussia Petalburg',
  'Rustboro Town',
  'Fortuna Dewford',
  'Littleroot Wanderers',
  'Fortree Forest',
  'Hearthome City',
  'Oreburgh Miners',
  'SC Mossdeep',
  'Mauville Lightning',
  'Indigo Plateau 1996',
];
const CLUB_MAP = new Map(CLUB_NAMES.map((de, i) => [de, CLUBS_EN[i] ?? de]));

const game: Messages['game'] = {
  posShort: {
    TW: 'GK', IV: 'CB', LV: 'LB', RV: 'RB', LWB: 'LWB', RWB: 'RWB', DM: 'DM', ZM: 'CM',
    OM: 'AM', LM: 'LM', RM: 'RM', LF: 'LW', RF: 'RW', ST: 'ST', SS: 'SP',
  },
  posName: {
    TW: 'Goalkeeper', IV: 'Centre-back', LV: 'Left-back', RV: 'Right-back',
    LWB: 'Left wing-back', RWB: 'Right wing-back', DM: 'Defensive midfielder',
    ZM: 'Central midfielder', OM: 'Attacking midfielder', LM: 'Left midfielder', RM: 'Right midfielder',
    LF: 'Left winger', RF: 'Right winger', ST: 'Striker', SS: 'Set-piece taker',
  },
  profileCodes: {
    TW: 'GK', IV: 'CB', AV: 'LB/RB', WB: 'LWB/RWB', DM: 'DM', ZM: 'CM', OM: 'AM', FM: 'LM/RM', FL: 'LW/RW', ST: 'ST', SS: 'SP',
  },
  profileTitle: {
    TW: 'Goalkeeper', IV: 'Centre-back', AV: 'Full-back', WB: 'Wing-back', DM: 'Holding midfielder',
    ZM: 'Central midfielder', OM: 'Playmaker', FM: 'Wide midfielder', FL: 'Winger', ST: 'Striker', SS: 'Set-piece taker',
  },
  profileRole: {
    TW: 'Stops shots, organises the defence.',
    IV: 'Tackles and headers.',
    AV: 'Defend the flank and push forward.',
    WB: 'Up and down the whole touchline.',
    DM: 'Wins the ball in front of the back line.',
    ZM: 'Sets the tempo, box-to-box.',
    OM: 'Creative force behind the strikers.',
    FM: 'Crosses and pace.',
    FL: 'Dribbling and finishing from wide.',
    ST: 'Scores goals, holds up the ball.',
    SS: 'Free kicks and penalties. Optional, does not count towards the team score.',
  },
  profileNotes: {
    TW: { spd: 'reflexes/composure' },
    AV: { hp: 'stamina' },
    ZM: { spa: 'passing', spd: 'vision' },
    ST: { atk: 'shot power', spa: 'finishing', height: 'headers' },
    SS: { spa: 'technique', atk: 'shot power' },
  },
  factor: {
    hp: 'HP', atk: 'ATK', def: 'DEF', spa: 'SP.ATK', spd: 'SP.DEF', spe: 'SPE', height: 'HEIGHT', weight: 'WEIGHT',
  },
  factorLong: {
    hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed',
    height: 'Height', weight: 'Weight',
  },
  level: { 3: 'Key', 2: 'Helps', 1: 'Minor', 0: 'Doesn’t count' },
  type: {
    normal: 'Normal', fire: 'Fire', water: 'Water', electric: 'Electric', grass: 'Grass', ice: 'Ice',
    fighting: 'Fighting', poison: 'Poison', ground: 'Ground', flying: 'Flying', psychic: 'Psychic', bug: 'Bug',
    rock: 'Rock', ghost: 'Ghost', dragon: 'Dragon', dark: 'Dark', steel: 'Steel', fairy: 'Fairy',
  },
  region: ['', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea'],
  allRegions: 'All',
  challenge: {
    c340: '34–0 Challenge',
    daily: 'Daily XI',
    retro340: 'Retro 34–0',
    c151: '151 Challenge',
  },
  legendary: 'Legendary',
  mythical: 'Mythical',
  ultraBeast: 'Ultra Beast',
  mega: 'Mega',
  pokemon: (p) => p.en,
  club: (name) => CLUB_MAP.get(name) ?? name,
  dexNo: (id) => `#${String(id).padStart(4, '0')}`,
  day: (day) => {
    const ms = Date.parse(`${day}T00:00:00Z`);
    return Number.isNaN(ms)
      ? day
      : new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  },
};

export default game;
