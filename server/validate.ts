/**
 * Strenge Prüfung aller Eingaben. Ungültiges wird mit 400 (bad_request) und
 * einer deutschen Meldung abgewiesen – die Spiellogik prüft danach nur noch
 * die Legalität der Züge (422).
 */
import { isDefaultPlayerName, LIMITS, type DeviceAuth, type Period } from '../src/lib/api/contract';
import type { PickLog, RerollKind } from '../src/lib/challengeEngine';
import { FORMATION_IDS } from '../src/config/formations';
import type { ChallengeKey, FormationId } from '../src/types';
import { ApiError, badRequest } from './http';

export const CHALLENGE_KEYS: ChallengeKey[] = ['c340', 'daily', 'retro340', 'c151'];

/** Maximale Größe eines Request-Bodys (ein voller Run braucht ~1 KB). */
export const MAX_BODY_BYTES = 16 * 1024;
/** Höchstens so viele Züge (11 Feldspieler + Standardschütze). */
const MAX_PICKS = 12;
/** Höchstens so viele Rerolls in einem Zug (die Engine erlaubt pro Run noch weniger). */
const MAX_REROLLS_PER_PICK = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX32_RE = /^[0-9a-f]{32}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
/** Steuerzeichen und einzelne Surrogate */
const CONTROL_RE = /[\p{Cc}\p{Cs}]/gu;
/** Formatzeichen: Bidi-Steuerung, ZWSP, ZWJ/ZWNJ, weiches Trennzeichen, Wortverbinder, BOM, Tags … */
const FORMAT_RE = /\p{Cf}/u;
/** Füllzeichen, die leer aussehen, aber als Buchstabe/Symbol gelten (Hangul-Filler, leere Braille-Zelle) */
const BLANK_RE = /[\u115F\u1160\u3164\uFFA0\u2800]/u;
const MARK_RE = /\p{M}/u;
const PICTO_RE = /\p{Extended_Pictographic}/u;
/** Darf zwischen Emoji und ZWJ stehen: Variantenwähler-16 und Hautfarben */
const EMOJI_SUFFIX_RE = /[\uFE0F\p{Emoji_Modifier}]/u;
/** Sichtbarer Inhalt: Buchstabe, Ziffer oder Emoji */
// Flaggen (Regional Indicators) und Keycaps (#️⃣) sind keine Extended_Pictographic, zählen aber als Emoji.
const VISIBLE_RE = /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u;
const ZWJ = '\u200D';
/** Höchstens so viele Kombinationszeichen (Akzente …) pro Grundzeichen */
const MAX_MARKS = 2;

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const tooLarge = () => badRequest('Anfrage ist zu groß');

/**
 * Liest den Body als Text, höchstens `max` Bytes: Es wird beim Lesen gezählt und
 * abgebrochen, sobald es mehr sind – auch ohne Content-Length (chunked), ohne vorher
 * alles zu puffern.
 */
async function readBodyText(request: Request, max: number): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Liest den Body als JSON-Objekt (max. MAX_BODY_BYTES). */
export async function readJsonBody(request: Request): Promise<Obj> {
  // Schnell abweisen, wenn die angekündigte Länge schon zu groß ist.
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw tooLarge();
  const text = await readBodyText(request, MAX_BODY_BYTES);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw badRequest('Anfrage ist kein gültiges JSON');
  }
  if (!isObject(data)) throw badRequest('Anfrage muss ein JSON-Objekt sein');
  return data;
}

/** Geräte-ID: UUID oder 32 Hex-Zeichen (klein geschrieben normalisiert) – sonst null. */
export function normalizeDeviceId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const id = v.trim().toLowerCase();
  return UUID_RE.test(id) || HEX32_RE.test(id) ? id : null;
}

export function parseDeviceAuth(body: Obj): DeviceAuth {
  const deviceId = normalizeDeviceId(body.deviceId);
  if (!deviceId) throw badRequest('Ungültige Geräte-ID');
  const secret = body.deviceSecret;
  if (typeof secret !== 'string' || !HEX64_RE.test(secret)) throw badRequest('Ungültiger Geräte-Schlüssel');
  return { deviceId, deviceSecret: secret };
}

export function parseChallenge(v: unknown): ChallengeKey {
  if (typeof v !== 'string' || !CHALLENGE_KEYS.includes(v as ChallengeKey)) throw badRequest('Unbekannte Challenge');
  return v as ChallengeKey;
}

/** Endet `out` (ggf. vor VS16/Hautfarbe) mit einem Emoji? */
function endsWithEmoji(out: string[]): boolean {
  let i = out.length - 1;
  while (i >= 0 && out.length - i <= 2 && EMOJI_SUFFIX_RE.test(out[i])) i--;
  return i >= 0 && PICTO_RE.test(out[i]);
}

/**
 * Säubert Namen (gegen unsichtbare, verdrehte oder übermalte Namen): NFC, ohne
 * Steuer- und Formatzeichen (ZWJ bleibt nur zwischen Emoji, etwa in Berufs-Emoji),
 * leer aussehende Füllzeichen werden Leerzeichen, höchstens MAX_MARKS Kombinations-
 * zeichen pro Grundzeichen, Leerraum zusammengefasst und getrimmt.
 */
export function cleanText(v: string): string {
  const cps = [...v.normalize('NFC').replace(CONTROL_RE, '')];
  const out: string[] = [];
  let marks = 0;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (FORMAT_RE.test(c)) {
      if (c === ZWJ && endsWithEmoji(out) && PICTO_RE.test(cps[i + 1] ?? '')) out.push(c);
      continue;
    }
    if (MARK_RE.test(c)) {
      if (++marks > MAX_MARKS) continue;
    } else {
      marks = 0;
    }
    out.push(BLANK_RE.test(c) ? ' ' : c);
  }
  return out.join('').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Enthält der (gesäuberte) Text etwas Sichtbares – Buchstabe, Ziffer oder Emoji? */
export const hasVisible = (s: string) => VISIBLE_RE.test(s);

/** Länge in Zeichen (Codepoints, ein Emoji = 1). */
const charCount = (s: string) => [...s].length;

/**
 * Teamname; ohne sichtbaren Inhalt wird er leer. Leer ist er hier noch erlaubt – finishRun
 * lehnt ihn erst nach dem Wiederholungsfall ab (400 team_name_required), damit ein schon
 * gewerteter Run weiter sein gespeichertes Ergebnis bekommt.
 */
export function parseTeamName(v: unknown): string {
  if (v == null) return '';
  if (typeof v !== 'string') throw badRequest('Teamname muss ein Text sein');
  const name = cleanText(v);
  if (charCount(name) > LIMITS.teamNameMax) throw badRequest(`Teamname ist zu lang (max. ${LIMITS.teamNameMax} Zeichen)`);
  return hasVisible(name) ? name : '';
}

/** Leerer Name oder Standardname („Trainer") bei POST /api/player. */
const badName = (message: string) => new ApiError(400, 'bad_name', message);

/** Teamname fehlt beim Abschluss eines gewerteten Runs. */
export const teamNameRequired = () =>
  new ApiError(400, 'team_name_required', 'Bitte gib deinem Team einen Namen – ohne Teamnamen wird der Run nicht gewertet');

/**
 * Neuer Spielername (POST /api/player): gesäubert, 1–24 Zeichen, mit sichtbarem Inhalt
 * (sonst 400 bad_request) – leer oder der Standardname „Trainer" → 400 bad_name.
 */
export function parsePlayerName(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('Spielername fehlt');
  const name = cleanText(v);
  if (!name) throw badName('Spielername darf nicht leer sein – bitte wähle einen eigenen Namen');
  if (charCount(name) > LIMITS.playerMax) throw badRequest(`Spielername ist zu lang (max. ${LIMITS.playerMax} Zeichen)`);
  if (!hasVisible(name)) {
    throw badRequest('Spielername braucht mindestens einen Buchstaben, eine Ziffer oder ein Emoji');
  }
  if (isDefaultPlayerName(name)) throw badName(`„${name}" ist der Standardname – bitte wähle einen eigenen Namen`);
  return name;
}

/**
 * Spielername beim Abschluss: wie parsePlayerName, nur ein leerer, unsichtbarer oder
 * Standardname („Trainer") lässt den gespeicherten Namen unverändert (null) – der
 * gewertete Run soll daran nicht scheitern, und ein eigener Name wird so nie zurück auf
 * den Standardnamen gesetzt.
 */
function parseFinishPlayer(v: unknown): string | null {
  if (typeof v !== 'string') throw badRequest('Spielername fehlt');
  const name = cleanText(v);
  if (charCount(name) > LIMITS.playerMax) throw badRequest(`Spielername ist zu lang (max. ${LIMITS.playerMax} Zeichen)`);
  return hasVisible(name) && !isDefaultPlayerName(name) ? name : null;
}

function parsePicks(v: unknown): PickLog[] {
  if (!Array.isArray(v)) throw badRequest('Züge fehlen');
  if (v.length > MAX_PICKS) throw badRequest(`Zu viele Züge (max. ${MAX_PICKS})`);
  return v.map((pick, i) => {
    const nr = i + 1;
    if (!isObject(pick)) throw badRequest(`Zug ${nr} ist ungültig`);
    const { rerolls, pokemonId, slot } = pick;
    if (!Array.isArray(rerolls) || rerolls.length > MAX_REROLLS_PER_PICK || !rerolls.every((k) => typeof k === 'string')) {
      throw badRequest(`Zug ${nr}: ungültige Rerolls`);
    }
    if (typeof pokemonId !== 'number' || !Number.isInteger(pokemonId) || pokemonId < 1 || pokemonId > 100_000) {
      throw badRequest(`Zug ${nr}: ungültige Pokémon-ID`);
    }
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 11) {
      throw badRequest(`Zug ${nr}: ungültiger Slot`);
    }
    // Unbekannte Reroll-Arten prüft die Engine (→ 422); hier nur sauber kopieren.
    return { rerolls: rerolls as RerollKind[], pokemonId, slot };
  });
}

export interface FinishInput {
  auth: DeviceAuth;
  token: string;
  formation: FormationId;
  ssEnabled: boolean;
  picks: PickLog[];
  /** Gesäubert; '' = kein Teamname (finishRun lehnt das ab, außer im Wiederholungsfall) */
  teamName: string;
  /** null: kein gültiger (eigener) Name mitgeschickt – der gespeicherte bleibt */
  player: string | null;
}

export function parseStart(body: Obj): { auth: DeviceAuth; challenge: ChallengeKey } {
  const challenge = parseChallenge(body.challenge);
  return { auth: parseDeviceAuth(body), challenge };
}

export function parseFinish(body: Obj): FinishInput {
  const auth = parseDeviceAuth(body);
  const token = body.token;
  if (typeof token !== 'string' || !HEX64_RE.test(token)) throw badRequest('Ungültiger Run-Token');
  const formation = body.formation;
  if (typeof formation !== 'string' || !FORMATION_IDS.includes(formation as FormationId)) {
    throw badRequest('Unbekannte Formation');
  }
  if (typeof body.ssEnabled !== 'boolean') throw badRequest('ssEnabled muss true oder false sein');
  return {
    auth,
    token,
    formation: formation as FormationId,
    ssEnabled: body.ssEnabled,
    picks: parsePicks(body.picks),
    teamName: parseTeamName(body.teamName),
    player: parseFinishPlayer(body.player),
  };
}

export function parseRename(body: Obj): { auth: DeviceAuth; player: string } {
  return { auth: parseDeviceAuth(body), player: parsePlayerName(body.player) };
}

/**
 * Eintrags-ID, genau so, wie der Server sie vergibt (newId = crypto.randomUUID): UUID v4,
 * klein geschrieben, mit Bindestrichen. Alles andere ist kein Eintrag.
 */
export const ENTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Eintrags-ID aus der URL (GET /api/entries/:id) – sonst 400. */
export function parseEntryId(raw: string): string {
  if (!ENTRY_ID_RE.test(raw)) throw badRequest('Ungültige Eintrags-ID');
  return raw;
}

export interface LeaderboardQuery {
  challenge: ChallengeKey;
  period: Period;
  limit: number;
  me: string | null;
}

export function parseLeaderboardQuery(params: URLSearchParams): LeaderboardQuery {
  const challenge = parseChallenge(params.get('challenge'));
  const rawPeriod = params.get('period') ?? 'all';
  if (rawPeriod !== 'today' && rawPeriod !== 'all') throw badRequest('Zeitraum muss „today" oder „all" sein');
  const rawLimit = params.get('limit');
  let limit = 50;
  if (rawLimit != null && rawLimit !== '') {
    limit = /^\d{1,4}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!(limit >= 1 && limit <= LIMITS.leaderboardMax)) {
      throw badRequest(`Limit muss zwischen 1 und ${LIMITS.leaderboardMax} liegen`);
    }
  }
  const rawMe = params.get('me');
  let me: string | null = null;
  if (rawMe != null && rawMe !== '') {
    me = normalizeDeviceId(rawMe);
    if (!me) throw badRequest('Ungültige Geräte-ID');
  }
  return { challenge, period: rawPeriod, limit, me };
}
