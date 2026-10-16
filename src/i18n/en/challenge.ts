/** Texts: challenge (English). Must have exactly the keys of ../de/challenge.ts (checked by TypeScript). */
import type { Messages } from '../de';

const REROLL_KIND: Record<string, string> = { type: 'type', region: 'region', pokemon: 'Pokémon' };

const challenge: Messages['challenge'] = {
  // ---------------------------------------------------------------- Pages
  c340Lead: 'All 1,025 Pokémon. Can you go 34–0?',
  c340HowTo:
    'Each round rolls a region and a type. Put a matching Pokémon in a free spot, with no more than 2 Legendaries. Fill all 11 spots, then play a 34-match season. Can you go 34–0?',
  c151Lead: 'Only the original 151. Its own Gen 1 scaling, its own leaderboard.',
  c151HowTo:
    'Each round rolls a random Pokémon from the original 151. Put it in any free spot, fill all 11, then play a 34-match season. Can you go 34–0?',
  retro340HowTo:
    'Retro look, Gen 1 scaling: each round rolls a type. Pick a matching Pokémon from the original 151 and put it in a free spot, with no more than 2 Legendaries. Fill all 11 spots and play a 34-match season. Can you go 34–0?',
  mode: 'Mode',

  // ---------------------------------------------------------------- Setup (ChallengeParts)
  bestScore: 'Best score',
  bestRecord: 'Best record',
  runs: 'Runs',
  lastRun: 'Last run',
  howItWorks: 'How it works',
  setupAria: 'Set up a run',
  formation: 'Formation',
  off: 'Off',
  on: 'On',
  playerName: 'Your name on the leaderboard',
  playerNamePlaceholder: 'e.g. Ash',
  teamName: 'Team name',
  teamNamePlaceholder: (club) => `e.g. ${club}`,
  playerNameEmpty: 'Please enter your name for the leaderboard.',
  playerNameDefault: 'Everyone here is called “Trainer” – please choose a name of your own.',
  playerNameInvisible: 'Your name needs at least one letter, digit or emoji.',
  teamNameEmpty: 'Please give your team a name.',
  teamNameInvisible: 'The team name needs at least one letter, digit or emoji.',
  namesNeeded: 'Before the season kicks off: give yourself and your team a name.',
  namesAria: 'Names for the ranking',
  starting: 'Starting …',
  start: 'Start run',
  rollingAria: (label) => `${label}: rolling – tap to skip`,

  // ---------------------------------------------------------------- Board (RunBoard)
  noOtherRoll: 'No other roll possible',
  rerollsLeft: (left) => (left > 0 ? `(${left}×)` : '(used up)'),
  allPlaced: 'All spots filled',
  round: 'Round',
  original151: 'Original 151',
  legends: 'Legendaries',
  rerolls: 'Rerolls:',
  region: 'Region',
  type: 'Type',
  logTitle: (n) => `📜 Your rounds (${n})`,
  logFit: (n) => `Fit ${n}`,
  logAvgFit: (n) => `avg fit ${n}`,
  logRound: (n) => `R${n}`,
  logReroll: { type: 'Type', region: 'Region', pokemon: 'Pokémon' },
  rerollType: (left) => `Reroll type ${left}`,
  rerollRegion: (left) => `Reroll region ${left}`,
  yourPokemon: 'Your Pokémon',
  rerollPokemon: (left) => `Reroll Pokémon (${left})`,
  placeRolledBefore: 'Click a free spot on the pitch to lock in ',
  placeRolledAfter: '.',
  choose: 'Pick a Pokémon',
  selectedAfter: ' selected. Click a free spot on the pitch to lock it in.',
  hintType: 'Pick a Pokémon of this type from the original 151.',
  hintRegionType: 'Pick a Pokémon that matches the region and type. Players you’ve locked in stay put.',
  legendLimit: (max) => `Already ${max} Legendaries in the team`,
  done: 'Your XI is ready. Time for the season!',
  seasonRunning: 'Playing the season …',
  resend: 'Send again',
  showResult: 'See result',
  finishOffline: 'Finish offline (unranked)',
  abortConfirm: 'Really abandon this run?',
  abort: 'Abandon run',
  pitchAria: (formation) => `Pitch, formation ${formation}`,
  netChecking: 'Checking connection …',
  netOnline: 'Online – your runs go on the leaderboard',
  netOffline: 'Offline – runs are only saved on this device',
  closeNotice: 'Dismiss notice',
  badgeRanked: 'Ranked',
  badgeOffline: 'Offline',
  badgeRankedTitle: 'This run goes on the online leaderboard',
  badgeOfflineTitle: 'This run is only saved on this device',

  // ---------------------------------------------------------------- Start/finish (useChallengeRun, runFinish)
  offlineFallback: 'Server unreachable – this run is being played offline and won’t be ranked.',
  startFailed:
    'No connection to the server – your run hasn’t started yet. Try again in a moment or play offline (unranked).',
  offlineWithReason: (sentence) => `${sentence} This run is being played offline and won’t be ranked.`,
  startError: (msg) => `Couldn’t start the run: ${msg}`,
  finishFailed:
    'Server unreachable – your run hasn’t been ranked yet. Send it again in a moment or finish it offline (unranked).',
  alreadyRanked:
    'The server has already ranked this run, but the result hasn’t arrived here yet. Send it again in a moment to load your ranked result.',
  finishRateLimited: (sentence) =>
    `${sentence} Your run hasn’t been ranked yet – send it again later or finish it offline (unranked).`,
  finishError: (msg) => `Couldn’t finish the run: ${msg}`,
  playedOffline: 'Played offline – not ranked',
  notRanked: (msg) => `${msg} – run not ranked`,
  unreachableNotRanked: 'Server unreachable – run not ranked',

  // ---------------------------------------------------------------- Engine errors (code → text)
  engine: {
    finished: 'This run is already finished',
    noReroll: (kind) => `No ${REROLL_KIND[kind] ?? kind} reroll left`,
    noOtherRoll: 'No other roll possible',
    unknownPokemon: (id) => `Unknown Pokémon #${id}`,
    notAllowed: (name) => `${name} isn’t allowed in this challenge`,
    inTeam: (name) => `${name} is already in the team`,
    noMatch: (name) => `${name} doesn’t match the roll`,
    slotTaken: (slot) => `Slot ${slot} isn’t free`,
    poolEmpty: 'No pickable Pokémon left in the pool',
    unknownChallenge: (key) => `Unknown challenge: ${key}`,
    unknownFormation: (key) => `Unknown formation: ${key}`,
    badSeed: 'Invalid seed',
    badLog: 'Invalid move log',
    badPick: 'Invalid move',
  },
};

export default challenge;
