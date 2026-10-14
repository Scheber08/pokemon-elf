/** Texts: result (English). Must have exactly the keys of ../de/result.ts (checked by TypeScript). */
import type { Messages } from '../de';

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st … */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const result: Messages['result'] = {
  // ---------------------------------------------------------------- Season summary (SeasonResultView)
  defaultTeamName: 'My XI',
  title: 'Season summary',
  verdict: {
    perfect: 'Perfect season! Not a single point dropped.',
    unbeaten: 'Unbeaten! Only the draws stand between you and perfection.',
    champion: 'Champions! The trophy goes to your team.',
    top4: 'Top-four finish – a strong season.',
    europe: 'Pushing for Europe. There’s more to come.',
    midTable: 'Safely mid-table.',
    survived: 'Nervy right to the end – but you stayed up.',
    relegated: 'Relegated. Time for a squad rebuild.',
  },
  explainer:
    'Every Pokémon is rated on how well it fits its position – based on base stats, height, weight and type. Goalkeeper, centre-backs and strikers count the most, and your three weakest positions drag the whole team down. Your captain’s fit counts double. Opponents range from 350 to 910.',
  rankedOnline: 'Ranked online',
  rankToday: (n) => `${ordinal(n)} today`,
  rankAllTime: (n) => `${ordinal(n)} all-time`,
  rejected: 'The server didn’t rank this run.',
  notRanked: 'Not ranked',
  shareText: (record, score) => `My Pokémon XI went ${record}! Score ${score}`,
  imageSaved: 'Image saved, text copied to clipboard',
  shareFailed: 'Couldn’t share',
  imageFailed: 'Couldn’t create the image',
  nameSavedOnline: 'Name saved – online too',
  nameSaved: 'Name saved',
  nameFailed: 'Couldn’t save the name',
  yourTeam: 'Your XI',
  recordAria: (w, d, l) =>
    `Record: ${plural(w, 'win', 'wins')}, ${plural(d, 'draw', 'draws')}, ${plural(l, 'defeat', 'defeats')}`,
  recordLegend: 'Wins – Draws – Defeats',
  points: 'Points',
  teamScore: 'Team score',
  place: 'Position',
  goals: 'Goals',
  record: 'Record',
  ordinal,
  weakSpots: 'Weak spots according to scouting: ',
  weakSpotsNote: ' (marked on the pitch)',
  share: 'Share',
  saveImage: 'Save image',
  newRun: 'New run',
  nameLabel: 'Your name on the leaderboard',
  save: 'Save',
  finalTable: 'Final table',
  col: {
    place: 'Pos',
    team: 'Team',
    played: 'P',
    playedTitle: 'Played',
    won: 'W',
    wonTitle: 'Won',
    drawn: 'D',
    drawnTitle: 'Drawn',
    lost: 'L',
    lostTitle: 'Lost',
    goals: 'Goals',
    diff: 'GD',
    diffTitle: 'Goal difference',
    pts: 'Pts',
  },
  topScorers: 'Top scorers',
  noGoals: 'No goals – ouch.',
  details: (n) => `Season details – all ${n} matches`,
  venueHome: 'H',
  venueAway: 'A',
  vsHome: 'v',
  vsAway: '@',
  outcomeShort: { S: 'W', U: 'D', N: 'L' },
  weights: (items, rest) =>
    `Positions by weight: ${items.map(([pos, w]) => `${pos} ${w}`).join(' · ')} · others ${rest}`,

  // ---------------------------------------------------------------- Live ticker (SeasonTicker)
  outcome: { S: 'Win', U: 'Draw', N: 'Defeat' },
  announceDay: (round, outcome, gf, ga, home, opponent, record, points, place) =>
    `Matchday ${round}: ${outcome} ${gf}:${ga} ${home ? 'v' : 'at'} ${opponent}. Record ${record}, ${plural(points, 'point', 'points')}, ${ordinal(place)} place.`,
  announceEnd: (record, points, place) =>
    `Full time! Season record ${record}, ${plural(points, 'point', 'points')}, ${ordinal(place)} place.`,
  announceStart: 'Kick-off! The season is under way.',
  stateEnd: 'FT',
  statePause: 'Paused',
  stateLive: 'Live',
  ticker: 'Season ticker',
  resume: 'Resume',
  pause: 'Pause',
  speed: 'Speed',
  skip: 'Skip',
  matchday: 'Matchday',
  progressAria: 'Season progress',
  progressText: (played, total) => `${played} of ${total} matchdays played`,
  dotTitle: (round, gf, ga, home, opponent) => `Matchday ${round}: ${gf}:${ga} ${home ? 'v' : 'at'} ${opponent}`,
  table: 'Table',
  tableAfter: (round) => `Table after matchday ${round}`,
  noMatchYet: 'No matches played yet.',
  spaceHint: 'Space: pause / resume',
  strength: (n) => `Strength ${n}`,
  boardRound: (round) => `Matchday ${round}`,
  homeGame: 'Home',
  awayGame: 'Away',
  kickoff: 'Kick-off',
  noOwnGoal: 'Didn’t score',
  unchanged: ' (unchanged)',
  trend: (n, up) => `(${up ? 'up' : 'down'} ${plural(n, 'place', 'places')})`,
  perfectGoal: (total) => `Goal: ${total}–0 – win every match`,
  perfectAlive: (final, wins, round) => `${final ? 'Perfect' : 'Still perfect'}: ${wins}/${round} wins`,
  winStreak: (n) => `${plural(n, 'win', 'wins')} in a row`,
  unbeatenRun: (n) => `${plural(n, 'match', 'matches')} unbeaten`,
  perfectBroken: (total, round) => `${total}–0 bid over on matchday ${round}`,
  fullTime: 'Full time!',
  finaleLine: (points, place) => `${plural(points, 'point', 'points')} · ${ordinal(place)} place`,
  finalePerfect: ' · Perfect season!',
  finaleChampion: ' · Champions!',
  toSummary: 'See season summary',
  setPiece: (name) => `${name} (set piece)`,
};

export default result;
