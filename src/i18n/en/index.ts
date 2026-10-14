/** English catalog – same shape as ../de (enforced by the Messages type). */
import type { Messages } from '../de';
import builder from './builder';
import captain from './captain';
import challenge from './challenge';
import common from './common';
import crest from './crest';
import daily from './daily';
import draft from './draft';
import errors from './errors';
import game from './game';
import kit from './kit';
import info from './info';
import leaderboard from './leaderboard';
import manager from './manager';
import nav from './nav';
import online from './online';
import result from './result';
import scouting from './scouting';
import trainer from './trainer';

export const en: Messages = { common, nav, game, builder, challenge, result, daily, leaderboard, draft, online, scouting, info, errors, trainer, manager, captain, kit, crest };
