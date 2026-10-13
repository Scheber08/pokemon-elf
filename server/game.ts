/**
 * Spieldaten und -logik des Servers: dieselbe Engine und Auswertung wie im
 * Browser (challengeEngine, runCompute), nur mit den gebündelten Pokémon-Daten.
 */
import formsJson from '../public/data/forms.json';
import pokemonJson from '../public/data/pokemon.json';
import { createEngineData, MODE_RULES, replayRun, type PickLog, type RunState } from '../src/lib/challengeEngine';
import { buildScale, type Scale } from '../src/lib/fit';
import { computeRun, type ComputedRun } from '../src/lib/runCompute';
import type { ChallengeKey, FormationId, Pokemon } from '../src/types';

const LIST = pokemonJson as Pokemon[];

/** Engine-Daten – einmal pro Isolate aufgebaut. */
export const ENGINE_DATA = createEngineData(LIST);

/**
 * Pokémon des Online-Drafts: die 1.025 plus Formen (Megas, Regional- und Sonderformen). Welche
 * davon im Pool sind, entscheiden die Liga-Einstellungen – ohne forms/megas genau die 1.025.
 */
export const DRAFT_LIST: Pokemon[] = [...LIST, ...(formsJson as Pokemon[])];

/**
 * Normalisierungen (alle 1.025 bzw. nur Gen 1) – bewusst schon beim Start des
 * Isolates gebaut: Das kostet einige Millisekunden CPU, die so nicht auf das
 * 10-ms-Limit einer einzelnen Anfrage (Free-Plan) angerechnet werden.
 */
const SCALES: Record<'all' | 'gen1', Scale> = {
  all: buildScale(LIST, 'all'),
  gen1: buildScale(
    LIST.filter((p) => p.gen === 1),
    'gen1',
  ),
};

/** Normalisierung der Challenge (alle 1.025 oder nur Gen 1). */
export function scaleFor(challenge: ChallengeKey): Scale {
  return SCALES[MODE_RULES[challenge].scale];
}

/** Normalisierung des Online-Drafts (CPU- und Timer-Picks) – alle 1.025 wie im lokalen Draft. */
export function draftScale(): Scale {
  return SCALES.all;
}

export interface VerifiedRun {
  state: RunState;
  computed: ComputedRun;
}

export type VerifyResult = { ok: true; run: VerifiedRun } | { ok: false; error: string; round: number };

/**
 * Spielt das Zug-Protokoll nach und wertet den Run mit dem Saison-Seed aus.
 * Liefert den Grund (deutsch), falls ein Zug illegal war.
 */
export function verifyRun(args: {
  challenge: ChallengeKey;
  formation: FormationId;
  ssEnabled: boolean;
  seed: number;
  picks: PickLog[];
  teamName: string;
  seasonSeed: number;
}): VerifyResult {
  const { challenge, formation, ssEnabled, seed } = args;
  const replay = replayRun({ challenge, formation, ssEnabled, seed }, args.picks, ENGINE_DATA);
  if (!replay.ok) return replay;
  const { state } = replay;
  const computed = computeRun(
    { formation, slots: state.slots, ss: ssEnabled ? state.ss : undefined, teamName: args.teamName, seed: args.seasonSeed },
    ENGINE_DATA.byId,
    scaleFor(challenge),
  );
  return { ok: true, run: { state, computed } };
}
