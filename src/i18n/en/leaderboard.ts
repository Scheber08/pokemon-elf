/** Texts: leaderboard (English). Must have exactly the keys of ../de/leaderboard.ts (checked by TypeScript). */
import type { Messages } from '../de';
import { fmtNumber } from '../lang';
import errors from './errors';

/**
 * English text for a stable API error code (same wording as the errors catalog). The server's
 * message is German; unknown codes keep the message as it came.
 */
function apiErrorText(code: string | null, message: string): string {
  if (code === 'network') return errors.network;
  // Response without a message (e.g. a 503 from the CDN): keep the status
  const http = code === 'server_error' ? /HTTP (\d{3})/.exec(message) : null;
  if (http) return errors.http(Number(http[1]));
  if (code != null && Object.prototype.hasOwnProperty.call(errors.code, code)) {
    return errors.code[code as keyof typeof errors.code];
  }
  return message;
}

const leaderboard: Messages['leaderboard'] = {
  title: 'Leaderboard',
  lead: 'Each player’s best run counts – sorted by points, then team score.',
  colRank: 'Pos',
  colPlayer: 'Player',
  colRecord: 'Record',
  colPoints: 'Pts',
  colScore: 'Score',
  yourRank: 'Your position',
  playNow: 'Play now',
  today: 'Today',
  allTime: 'All time',
  week: 'This week',
  weekOf: (n) => `This week · Week ${n}`,
  todayOn: (date) => `Today · ${date}`,
  players: (n) => `${fmtNumber(n, 0, 'en')} ${n === 1 ? 'player' : 'players'}`,
  loading: 'Loading …',
  loadError: (message) => `Leaderboard unavailable: ${message}`,
  retry: 'Try again',
  emptyOnline: 'No entries yet – be the first!',
  localError: (message) => `Couldn’t read this device’s runs: ${message}`,
  emptyLocalToday: 'No runs on this device today.',
  emptyLocalWeek: 'No runs on this device this week yet.',
  emptyLocal: 'No runs on this device yet.',
  localMeta: (period) => `${period} · this device only, including unranked runs`,
  nameSavedOnline: 'Name saved – updated online too',
  nameSavedNotOnline: 'Name saved – can’t update online right now',
  nameSaved: 'Name saved',
  nameSaveFailed: 'Couldn’t save name',
  checking: 'Checking connection to the online leaderboard …',
  serverDown: 'Server unreachable – showing this device’s runs.',
  noticeOnline:
    'Online leaderboard – only runs started online are ranked. Your device is your profile, no sign-up needed.',
  noticeLocal: 'This device’s runs – including ones played offline, which don’t go on the online leaderboard.',
  sourceLabel: 'Source',
  sourceOnline: 'Online',
  sourceLocal: 'This device',
  challengeTabs: 'Challenge',
  periodLabel: 'Period',
  nameLabel: 'Your name on the leaderboard',
  save: 'Save',
  nameHintOnline: 'Applies online to all runs from this device and locally to new runs.',
  nameHintLocal: 'Applies to new runs on this device.',
  apiError: apiErrorText,
  viewTeam: 'View team',
  viewTeamOf: (team, player) => (team ? `View team: ${team} by ${player}` : `View team by ${player}`),
  entry: {
    untitled: (player) => `Team by ${player}`,
    kicker: (challenge, date) => (date ? `${challenge} · ${date}` : challenge),
    byline: (player, rank) => (rank != null ? `by ${player} · Rank ${rank}` : `by ${player}`),
    record: 'Record',
    recordSpoken: (w, d, l) =>
      `${w} ${w === 1 ? 'win' : 'wins'}, ${d} ${d === 1 ? 'draw' : 'draws'}, ${l} ${l === 1 ? 'defeat' : 'defeats'}`,
    points: 'Points',
    score: 'Team score',
    formation: 'Formation',
    pitchAria: (team, formation) => `Lineup of ${team} (${formation})`,
    sheetTitle: 'Lineup',
    loading: 'Loading team …',
    gone: 'This team is no longer on the leaderboard.',
    goneHint: 'There’s probably a better run by now – reload the leaderboard.',
    reloadBoard: 'Reload leaderboard',
    loadError: (message) => `Team unavailable: ${message}`,
    unreadable: 'This lineup can’t be displayed.',
    openInBuilder: 'Open in builder',
    openInBuilderHint: 'Replaces your lineup in the builder.',
    profile: 'Profile',
    profileTitle: (player) => `${player}’s profile`,
    friendly: 'Friendly against your XI',
    friendlyAgain: 'Play again',
    friendlyTitle: 'Friendly',
    friendlyNeedEleven: 'For a friendly you need a full XI in the builder.',
    friendlyToBuilder: 'To the builder',
    friendlyYou: 'Your XI',
    friendlyPick: 'With:',
    friendlyCurrent: (name) => `${name} (current XI)`,
    friendlyFirst: 'First leg',
    friendlySecond: 'Second leg',
    friendlyAggregate: 'Aggregate',
    friendlyWin: 'You win the tie!',
    friendlyDraw: 'Level over both legs.',
    friendlyLoss: 'The tie goes to your opponent.',
    friendlyScore: (own, opp) => `Team score ${own} : ${opp}`,
    friendlyScorers: (list) => `Goals: ${list}`,
    friendlyNote: 'Just for fun – doesn’t count for any leaderboard. Rated across all 1,025 Pokémon.',
  },
  profile: {
    kicker: 'Player profile',
    since: (date) => `Playing since ${date}`,
    runs: (n) => (n === 1 ? '1 ranked run' : `${n} ranked runs`),
    achievements: (done, total) => `🏅 ${done}/${total} achievements`,
    online: (titles, leagues) => `🏆 ${titles} ${titles === 1 ? 'title' : 'titles'} in ${leagues} online ${leagues === 1 ? 'league' : 'leagues'}`,
    perChallenge: 'Best runs',
    runsCol: 'Runs',
    perfectTitle: (n) => (n === 1 ? 'One perfect season (wins only)' : `${n} perfect seasons (wins only)`),
    best: 'Best run',
    showTeam: 'View team',
    recent: 'Recent runs',
    loading: 'Loading profile …',
    gone: 'This profile isn’t available (any more) – the entry is no longer on the leaderboard.',
    error: (message) => `Profile unavailable: ${message}`,
    toBoard: 'To the leaderboard',
    share: 'Share profile',
    linkCopied: 'Profile link copied',
    copyFailed: 'Could not copy',
    pts: (n) => `${n} pts`,
    score: (n) => `Score ${n}`,
    place: (place, players) => `Rank ${place} of ${players}`,
    placeTitle: 'Current all-time leaderboard rank',
  },
};

export default leaderboard;
