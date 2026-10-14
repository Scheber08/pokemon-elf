/** Texts: errors (English). Must have exactly the keys of ../de/errors.ts (checked by TypeScript). */
import type { Messages } from '../de';

const errors: Messages['errors'] = {
  network: 'Server unreachable',
  rateLimited: 'Too many requests in a short time – please try again later',
  unexpected: 'Unexpected response from the server',
  http: (status) => `Request failed (HTTP ${status})`,
  code: {
    bad_request: 'Invalid request',
    unauthorized: 'Device not recognised – the device key doesn’t match this device ID',
    not_found: 'Not found',
    method_not_allowed: 'Method not allowed',
    already_played: 'You’ve already played the Daily XI – there’s a new one tomorrow!',
    invalid_run: 'Invalid run',
    token_used: 'This run has already been ranked',
    token_expired: 'This run has expired',
    rate_limited: 'Too many requests in a short time – please try again later',
    server_error: 'Internal server error – please try again later',
    bad_name: 'Please choose a name of your own',
    name_required: 'Please choose your name for the leaderboard first',
    team_name_required: 'Please give your team a name',
    locked_item: 'You need to buy that in the shop first',
    not_enough_coins: 'You don’t have enough coins for that yet',
    not_on_sale: 'This item isn’t available right now – only in its season',
  },
  runNotFound: 'Run not found',
  invalidPlayerName: 'That name won’t work – please choose another one',
  alreadyPlayedOn: (day) => `You’ve already played the Daily XI for ${day} – there’s a new one tomorrow!`,
  invalidRunInRound: (round) => `Invalid run (round ${round})`,
  tokenExpired: (hours) => `This run has expired (older than ${hours} hours)`,
  tooManyRuns: 'Too many runs in a short time – please try again later',
  tooManyFinishes: 'Too many ranked runs in a short time – please try again later',
  tooManyDevices: 'Too many new devices from this connection – please try again in an hour',
};

export default errors;
