/**
 * Deutscher Katalog – die Quelle. Jeder Bereich hat eine eigene Datei; Werte sind
 * Strings oder Funktionen (für Platzhalter/Mehrzahl), z. B. picks: (n: number) => `${n} Picks`.
 * Der englische Katalog (../en) muss exakt dieselbe Form haben – TypeScript prüft das.
 */
import builder from './builder';
import challenge from './challenge';
import common from './common';
import daily from './daily';
import draft from './draft';
import errors from './errors';
import game from './game';
import info from './info';
import leaderboard from './leaderboard';
import nav from './nav';
import online from './online';
import result from './result';
import scouting from './scouting';
import trainer from './trainer';

export const de = { common, nav, game, builder, challenge, result, daily, leaderboard, draft, online, scouting, info, errors, trainer };

export type Messages = typeof de;
