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
  todayOn: (date) => `Today · ${date}`,
  players: (n) => `${fmtNumber(n, 0, 'en')} ${n === 1 ? 'player' : 'players'}`,
  loading: 'Loading …',
  loadError: (message) => `Leaderboard unavailable: ${message}`,
  retry: 'Try again',
  emptyOnline: 'No entries yet – be the first!',
  localError: (message) => `Couldn’t read this device’s runs: ${message}`,
  emptyLocalToday: 'No runs on this device today.',
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
  },
};

export default leaderboard;
