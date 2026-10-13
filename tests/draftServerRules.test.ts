/**
 * Online-Draft auf dem Server: die neuen Einstellungen (Generationen, Typen, Legendäre und
 * Mysteriöse, Legendären-Limit, Zufallsmodus mit Rerolls, Snake an/aus) durch DraftRoomCore –
 * ganze Drafts „pro Pick" und „pro Runde" mit Rerolls und CPU-Picks, ältere gespeicherte Ligen
 * (region/legends), die Prüfung der Einstellungen, die Lobby-Zeile (region 0 / n / 10) und
 * abgelehnte Rerolls.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TYPE_KEYS } from '../src/config/pokemonTypes';
import type { ApiErrorBody, DeviceAuth } from '../src/lib/api/contract';
import {
  DEFAULT_DRAFT_SETTINGS,
  DRAFT_ALL_GENS,
  LOBBY_REGION_MANY,
  type CreateDraftResponse,
  type DraftRerollKind,
  type DraftRoll,
  type DraftServerMessage,
  type DraftSettings,
  type DraftSettingsPatch,
  type DraftSnapshot,
  type PublicLobbiesResponse,
} from '../src/lib/api/draftContract';
import {
  allowedPicks,
  canReroll,
  currentTeam,
  draftedIds,
  DRAFT_SS_SLOT,
  freeSlots,
  legendsOf,
  matchesRoll,
  maxTeamsForPool,
  poolOf,
  rerollsLeft,
  rerollsUsedOf,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { cleanSettingsPatch, LOBBY_SYNC_MS, lobbyFields, lobbyPoolFields, type LobbyRow } from '../server/draftCore';
import { handleApi, type Env } from '../server/handler';
import { D1Shim } from './d1shim';
import { FakeNamespace, FakeRoom, type FakeSocket } from './fakeSocket';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');
const BY_ID = new Map(ALL.map((p) => [p.id, p]));

let db: D1Shim;
let drafts: FakeNamespace;
let env: Env;

beforeEach(() => {
  db = new D1Shim();
  drafts = new FakeNamespace(() => new FakeRoom({ DB: db }, ALL, SCALE));
  env = { DB: db, DRAFTS: drafts };
});

// ---------------------------------------------------------------- Helfer

type ErrorMsg = Extract<DraftServerMessage, { type: 'error' }>;

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await handleApi(new Request(`http://localhost${path}`, init), env);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, text };
}

const createBody = (dev: DeviceAuth, settings: unknown) => ({ ...dev, settings, teamName: 'Host-Elf', formation: '4-3-3' });

async function createLeague(dev: DeviceAuth, settings: DraftSettingsPatch = {}) {
  const res = await call<CreateDraftResponse>('POST', '/api/drafts', createBody(dev, settings));
  expect(res.status, res.text).toBe(200);
  return { code: res.body.code, room: drafts.room(res.body.code) };
}

async function hello(room: FakeRoom, dev: DeviceAuth): Promise<FakeSocket> {
  const sock = room.connect();
  await room.send(sock, { type: 'hello', ...dev });
  return sock;
}

/**
 * Nachricht schicken – mit kleiner Pause davor (Limits pro Verbindung und für Lobby-Änderungen).
 * Liefert den Fehler auf genau diese Nachricht (mit for) oder null.
 */
async function act(room: FakeRoom, sock: FakeSocket, msg: unknown, ms = 700): Promise<ErrorMsg | null> {
  room.now += ms;
  const before = sock.received.length;
  await room.send(sock, msg);
  return sock.received.slice(before).find((m): m is ErrorMsg => m.type === 'error') ?? null;
}

async function lobbyWithGuest(settings: DraftSettingsPatch = {}) {
  const hostDev = newDevice();
  const guestDev = newDevice();
  const { code, room } = await createLeague(hostDev, settings);
  const host = await hello(room, hostDev);
  const guest = await hello(room, guestDev);
  await act(room, guest, { type: 'join', teamName: 'Gast-Elf', formation: '4-4-2' });
  return { code, room, host, guest, hostDev, guestDev, hostTeam: host.state!.you!, guestTeam: guest.state!.you! };
}

/** Draft läuft: Reihenfolge Host → Gast, ohne Timer (bzw. mit `settings`). */
async function started(settings: DraftSettingsPatch = {}) {
  const ctx = await lobbyWithGuest({ order: 'host', pickSeconds: 0, ...settings });
  await act(ctx.room, ctx.host, { type: 'start' });
  expect(currentTeam(ctx.host.state!)!.id).toBe(ctx.hostTeam);
  return ctx;
}

const lobbyRow = (code: string) => db.query<LobbyRow>('SELECT * FROM draft_lobbies WHERE code = ?', code)[0];
const updates = () => db.executed.filter((e) => e.sql.includes('UPDATE draft_lobbies SET name')).length;
const strip = (s: DraftSnapshot) => ({ ...s, you: null });
const rollOf = (r: DraftRoll) => ({ gen: r.gen, type: r.type });

/** Erstes freies Pool-Pokémon in den ersten freien Slot (ohne Zufallsmodus). */
function simpleChoice(s: DraftSnapshot, teamId: string) {
  const team = s.teams.find((t) => t.id === teamId)!;
  const taken = draftedIds(s);
  const p = poolOf(s.settings, ALL).find((x) => !taken.has(x.id))!;
  return { pokemonId: p.id, slot: freeSlots(team, s.settings)[0] };
}

/**
 * Spielt den Draft zu Ende: CPU-Teams per Alarm, Menschen wählen das erste erlaubte Pokémon
 * (allowedPicks – Wurf und Legendären-Limit) – vorher darf `beforePick` z. B. neu würfeln.
 * Liefert je Pick-Index den Stand, unter dem gewählt wurde.
 */
async function driveDraft(
  room: FakeRoom,
  watcher: FakeSocket,
  seats: Map<string, FakeSocket>,
  beforePick?: (s: DraftSnapshot, sock: FakeSocket) => Promise<void>,
): Promise<DraftSnapshot[]> {
  const under: DraftSnapshot[] = [];
  for (let guard = 0; watcher.state!.phase === 'drafting'; guard++) {
    expect(guard).toBeLessThan(400);
    const s = watcher.state!;
    const cur = currentTeam(s)!;
    if (cur.cpu) {
      under[s.pickIndex] = s;
      await room.fireAlarm();
      continue;
    }
    const sock = seats.get(cur.id)!;
    if (beforePick) await beforePick(s, sock);
    const now = watcher.state!;
    expect(now.pickIndex).toBe(s.pickIndex);
    under[now.pickIndex] = now;
    const team = now.teams.find((t) => t.id === cur.id)!;
    const choice = allowedPicks(now, cur.id, ALL)[0];
    expect(choice, `Pick ${now.pickIndex}`).toBeDefined();
    const err = await act(room, sock, { type: 'pick', pokemonId: choice.id, slot: freeSlots(team, now.settings)[0] });
    expect(err, `Pick ${now.pickIndex}`).toBeNull();
  }
  return under;
}

// ---------------------------------------------------------------- Ganze Drafts im Zufallsmodus

describe('Zufallsmodus: ganze Drafts durch den Raum', () => {
  it('„pro Pick": jeder Pick hat seinen Wurf, Menschen rerollen, CPU-Teams picken passend', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await lobbyWithGuest({
      order: 'host',
      pickSeconds: 0,
      roll: 'pick',
      rerolls: { type: 2, region: 1 },
      gens: [1, 2, 3],
      legendary: true,
      mythical: true,
      maxLegends: 1,
      setPiece: true,
    });
    await act(room, host, { type: 'add-cpu' });
    const spectator = await hello(room, newDevice());
    expect(await act(room, host, { type: 'start' })).toBeNull();
    const s0 = host.state!;
    expect(s0.phase).toBe('drafting');
    expect(s0.roll).toMatchObject({ own: false });
    expect([1, 2, 3]).toContain(s0.roll!.gen);
    expect(s0).not.toHaveProperty('roundRoll');
    expect(s0.rerollsUsed).toEqual({});
    expect(spectator.state!.roll).toEqual(s0.roll);

    // Ein Pokémon, das nicht zum Wurf passt, geht nicht
    const wrong = poolOf(s0.settings, ALL).find((p) => !matchesRoll(p, s0.roll!))!;
    expect(await act(room, host, { type: 'pick', pokemonId: wrong.id, slot: 0 })).toMatchObject({
      code: 'bad_pick',
      message: `${wrong.de} passt nicht zum Wurf`,
      for: 'pick',
    });

    const rerolls: { pick: number; teamId: string; kind: DraftRerollKind }[] = [];
    const triedEmpty = new Set<string>();
    const under = await driveDraft(
      room,
      host,
      new Map([
        [hostTeam, host],
        [guestTeam, guest],
      ]),
      async (start, sock) => {
        const me = sock.state!.you!;
        let s = start;
        for (const kind of ['type', 'region'] as const) {
          while (canReroll(s, me, kind, ALL)) {
            const before = s.roll!;
            const used = rerollsUsedOf(s, me)[kind];
            expect(await act(room, sock, { type: 'reroll', kind })).toBeNull();
            const after = host.state!;
            expect(after.pickIndex).toBe(s.pickIndex);
            expect(after.deadline).toBe(s.deadline);
            expect(after.roll!.own).toBe(true);
            if (kind === 'type') {
              expect(after.roll!.gen).toBe(before.gen);
              expect(after.roll!.type).not.toBe(before.type);
            } else {
              expect(after.roll!.type).toBe(before.type);
              expect(after.roll!.gen).not.toBe(before.gen);
            }
            expect(rerollsUsedOf(after, me)[kind]).toBe(used + 1);
            // Alle sehen denselben Wurf
            expect(spectator.state!.roll).toEqual(after.roll);
            expect(guest.state!.roll).toEqual(after.roll);
            rerolls.push({ pick: s.pickIndex, teamId: me, kind });
            s = after;
          }
        }
        // Vorrat aufgebraucht: einmal pro Team die Ablehnung prüfen
        if (rerollsLeft(s, me, 'type') === 0 && !triedEmpty.has(me)) {
          triedEmpty.add(me);
          const before = room.stored;
          expect(await act(room, sock, { type: 'reroll', kind: 'type' })).toMatchObject({
            code: 'no_reroll',
            message: 'Kein Typ-Reroll mehr übrig',
            for: 'reroll',
          });
          expect(room.stored).toBe(before);
        }
      },
    );

    const final = host.state!;
    expect(final.phase).toBe('done');
    expect(final.picks).toHaveLength(36);
    expect(final.roll).toBeNull();
    for (const p of final.picks) {
      const mon = BY_ID.get(p.pokemonId)!;
      const roll = under[p.pick].roll!;
      expect(p.roll, `Pick ${p.pick}`).toEqual(rollOf(roll));
      expect(matchesRoll(mon, roll), `Pick ${p.pick}`).toBe(true);
    }
    for (const t of final.teams) expect(legendsOf(t, ALL), t.name).toBeLessThanOrEqual(1);
    const cpu = final.teams.find((t) => t.cpu)!;
    expect(final.picks.filter((p) => p.teamId === cpu.id)).toHaveLength(12);
    expect(final.picks.filter((p) => p.teamId === cpu.id).every((p) => p.auto)).toBe(true);
    // Beide Menschen haben ihren Vorrat genutzt, die CPU würfelt nie neu
    expect(final.rerollsUsed).toEqual({ [hostTeam]: { type: 2, region: 1 }, [guestTeam]: { type: 2, region: 1 } });
    expect(rerolls).toHaveLength(6);
    expect(triedEmpty.size).toBe(2);
    // Alle sehen denselben Endstand – und der Seed bleibt geheim
    expect(strip(spectator.state!)).toEqual(strip(final));
    expect(strip(guest.state!)).toEqual(strip(final));
    for (const raw of host.raw) expect(raw).not.toContain(String(room.stored!.state.seed));
    expect(room.stored!.state.league).toBeTruthy();
  });

  it('„pro Runde" ohne Snake: ein Wurf je Runde für alle, Reroll ändert nur den eigenen Wurf', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await lobbyWithGuest({
      order: 'host',
      pickSeconds: 0,
      roll: 'round',
      snake: false,
      rerolls: { type: 1, region: 1 },
      gens: [4, 5],
    });
    await act(room, host, { type: 'add-cpu' });
    expect(await act(room, host, { type: 'start' })).toBeNull();
    const s0 = host.state!;
    expect(s0.roundRoll).toBeTruthy();
    expect(s0.roll).toEqual({ ...s0.roundRoll!, own: false });

    let rerolledInRound = 0;
    const under = await driveDraft(
      room,
      host,
      new Map([
        [hostTeam, host],
        [guestTeam, guest],
      ]),
      async (start, sock) => {
        const me = sock.state!.you!;
        let s = start;
        for (const kind of ['type', 'region'] as const) {
          if (!canReroll(s, me, kind, ALL)) continue;
          expect(await act(room, sock, { type: 'reroll', kind })).toBeNull();
          const after = host.state!;
          // Nur der Wurf dieses Picks ändert sich – der Rundenwurf bleibt
          expect(after.roundRoll).toEqual(s.roundRoll);
          expect(after.roll).toMatchObject({ own: true });
          expect(after.roll).not.toEqual(s.roll);
          rerolledInRound++;
          s = after;
        }
      },
    );
    expect(rerolledInRound).toBe(4);

    const final = host.state!;
    expect(final.phase).toBe('done');
    expect(final.roll).toBeNull();
    expect(final.roundRoll).toBeNull();
    const n = final.teams.length;
    expect(n).toBe(3);
    expect(final.picks).toHaveLength(33);
    for (const p of final.picks) {
      // Ohne Snake: jede Runde dieselbe Reihenfolge
      expect(p.teamId, `Pick ${p.pick}`).toBe(final.teams[p.pick % n].id);
      const s = under[p.pick];
      expect(s.roundRoll, `Pick ${p.pick}`).toEqual(under[p.pick - (p.pick % n)].roundRoll);
      // Ohne eigenen Wurf gilt der Rundenwurf
      if (!s.roll!.own) expect(rollOf(s.roll!)).toEqual(s.roundRoll);
      expect(p.roll).toEqual(rollOf(s.roll!));
      expect(matchesRoll(BY_ID.get(p.pokemonId)!, s.roll!), `Pick ${p.pick}`).toBe(true);
    }
    const cpu = final.teams.find((t) => t.cpu)!;
    expect(final.rerollsUsed).not.toHaveProperty(cpu.id);
    expect(final.rerollsUsed).toEqual({ [hostTeam]: { type: 1, region: 1 }, [guestTeam]: { type: 1, region: 1 } });
  });

  it('Timer im Zufallsmodus: Reroll verschiebt die Bedenkzeit nicht, der Auto-Pick folgt dem neuen Wurf', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await started({ roll: 'pick', pickSeconds: 30, gens: [2] });
    const s0 = host.state!;
    const deadline = s0.deadline!;
    expect(room.alarmAt).toBe(deadline);
    expect(canReroll(s0, hostTeam, 'type', ALL)).toBe(true);
    expect(await act(room, host, { type: 'reroll', kind: 'type' }, 5000)).toBeNull();
    const s1 = host.state!;
    expect(s1.roll).toMatchObject({ gen: 2, own: true });
    expect(s1.deadline).toBe(deadline);
    expect(s1.turnStartedAt).toBe(s0.turnStartedAt);
    expect(room.alarmAt).toBe(deadline);

    await room.advanceTo(deadline);
    const s2 = guest.state!;
    expect(s2.picks[0]).toMatchObject({ teamId: hostTeam, auto: true, roll: rollOf(s1.roll!) });
    expect(matchesRoll(BY_ID.get(s2.picks[0].pokemonId)!, s1.roll!)).toBe(true);
    expect(currentTeam(s2)!.id).toBe(guestTeam);
    expect(s2.roll).toMatchObject({ gen: 2, own: false });
    expect(s2.rerollsUsed).toEqual({ [hostTeam]: { type: 1, region: 0 } });
    expect(rerollsLeft(s2, guestTeam, 'type')).toBe(1);
    expect(rerollsLeft(s2, hostTeam, 'type')).toBe(0);
  });

  it('Legendären-Limit gilt auf dem Server – auch für den Standardschützen', async () => {
    const { room, host, guest } = await started({ gens: [1], legendary: true, mythical: true, maxLegends: 1, setPiece: true });
    expect(await act(room, host, { type: 'pick', pokemonId: 144, slot: 0 })).toBeNull();
    expect(await act(room, guest, { type: 'pick', pokemonId: 150, slot: 0 })).toBeNull();
    expect(await act(room, guest, { type: 'pick', pokemonId: 1, slot: 1 })).toBeNull();
    const limit = { code: 'bad_pick', message: 'Höchstens ein Legendäres/Mysteriöses pro Team', for: 'pick' };
    expect(await act(room, host, { type: 'pick', pokemonId: 151, slot: DRAFT_SS_SLOT })).toMatchObject(limit);
    expect(await act(room, host, { type: 'pick', pokemonId: 145, slot: 1 })).toMatchObject(limit);
    expect(await act(room, host, { type: 'pick', pokemonId: 4, slot: 1 })).toBeNull();
    expect(host.state!.pickIndex).toBe(4);
  });
});

// ---------------------------------------------------------------- Abgelehnte Rerolls

describe('Reroll: nur das Team am Zug', () => {
  it('andere Teams, Zuschauer, CPU-Zug, Lobby, leerer Vorrat und fehlende Alternative → Fehler mit for: reroll', async () => {
    const { room, host, guest, hostTeam } = await lobbyWithGuest({
      order: 'host',
      pickSeconds: 0,
      roll: 'pick',
      gens: [1],
      rerolls: { type: 1, region: 1 },
    });
    expect(await act(room, host, { type: 'reroll', kind: 'type' })).toMatchObject({ code: 'not_drafting', for: 'reroll' });
    await act(room, host, { type: 'add-cpu' });
    await act(room, host, { type: 'start' });
    const spectator = await hello(room, newDevice());
    const before = room.stored;

    expect(await act(room, guest, { type: 'reroll', kind: 'type' })).toMatchObject({
      code: 'not_your_turn',
      message: 'Du bist nicht dran',
      for: 'reroll',
    });
    expect(await act(room, spectator, { type: 'reroll', kind: 'type' })).toMatchObject({
      code: 'not_joined',
      message: 'Du bist in dieser Liga nicht dabei',
      for: 'reroll',
    });
    // Nur Generation 1 im Pool: kein anderer Regions-Wurf
    expect(await act(room, host, { type: 'reroll', kind: 'region' })).toMatchObject({
      code: 'no_other_roll',
      message: 'Kein anderer Wurf möglich',
      for: 'reroll',
    });
    expect(room.stored).toBe(before);

    expect(await act(room, host, { type: 'reroll', kind: 'type' })).toBeNull();
    expect(host.state!.roll).toMatchObject({ gen: 1, own: true });
    expect(guest.state!.roll).toEqual(host.state!.roll);
    expect(await act(room, host, { type: 'reroll', kind: 'type' })).toMatchObject({
      code: 'no_reroll',
      message: 'Kein Typ-Reroll mehr übrig',
      for: 'reroll',
    });
    expect(host.state!.rerollsUsed).toEqual({ [hostTeam]: { type: 1, region: 0 } });

    // Host, Gast – dann ist die CPU dran: Niemand würfelt für sie
    for (const sock of [host, guest]) {
      const s = sock.state!;
      const team = s.teams.find((t) => t.id === s.you)!;
      const p = allowedPicks(s, team.id, ALL)[0];
      expect(await act(room, sock, { type: 'pick', pokemonId: p.id, slot: freeSlots(team, s.settings)[0] })).toBeNull();
    }
    expect(currentTeam(host.state!)!.cpu).toBe(true);
    for (const sock of [host, guest]) {
      expect(await act(room, sock, { type: 'reroll', kind: 'type' })).toMatchObject({ code: 'not_your_turn', for: 'reroll' });
    }
    await room.fireAlarm();
    expect(host.state!.picks[2].auto).toBe(true);
    expect(Object.keys(host.state!.rerollsUsed!)).toEqual([hostTeam]);
  });

  it('gezielter Reroll: Zug schon weiter (Timer beim Snake-Doppelzug) → „stale", kein ungesehener Wurf, nichts verbraucht', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await started({
      roll: 'pick',
      pickSeconds: 30,
      gens: [1, 2, 3],
      rerolls: { type: 2, region: 0 },
    });
    // Host wählt Pick 0 – der Gast ist (Snake, 2 Teams) für Pick 1 und 2 dran
    const p0 = allowedPicks(host.state!, hostTeam, ALL)[0];
    expect(await act(room, host, { type: 'pick', pokemonId: p0.id, slot: 0 })).toBeNull();
    const s1 = guest.state!;
    expect(s1.pickIndex).toBe(1);
    expect(currentTeam(s1)!.id).toBe(guestTeam);
    const seen = { pickIndex: s1.pickIndex, roll: rollOf(s1.roll!) };

    // Der Timer wählt für Pick 1, kurz bevor der Reroll ankommt
    await room.advanceTo(s1.deadline!);
    const s2 = guest.state!;
    expect(s2.pickIndex).toBe(2);
    expect(s2.picks[1]).toMatchObject({ teamId: guestTeam, auto: true });
    expect(currentTeam(s2)!.id).toBe(guestTeam);
    const before = room.stored;
    expect(await act(room, guest, { type: 'reroll', kind: 'type', ...seen }, 1)).toEqual({
      type: 'error',
      code: 'stale',
      message: 'Dieser Zug ist schon vorbei',
      for: 'reroll',
    });
    expect(room.stored).toBe(before);
    expect(guest.state!.roll).toEqual(s2.roll);
    expect(guest.state!.rerollsUsed).toEqual({});

    // Nur der Wurf passt nicht mehr (gleicher Pick): ebenso „stale"
    const other = { gen: s2.roll!.gen, type: s2.roll!.type === 'fire' ? 'water' : 'fire' };
    expect(await act(room, guest, { type: 'reroll', kind: 'type', pickIndex: 2, roll: other })).toMatchObject({
      code: 'stale',
      for: 'reroll',
    });
    expect(room.stored).toBe(before);

    // Mit dem Stand, den der Gast jetzt sieht, geht es
    expect(await act(room, guest, { type: 'reroll', kind: 'type', pickIndex: 2, roll: rollOf(s2.roll!) })).toBeNull();
    expect(guest.state!.pickIndex).toBe(2);
    expect(guest.state!.roll).toMatchObject({ gen: s2.roll!.gen, own: true });
    expect(guest.state!.rerollsUsed).toEqual({ [guestTeam]: { type: 1, region: 0 } });
  });

  it('zwei Tabs desselben Geräts schicken denselben Reroll: nur einer zählt (ohne Ziel wie bisher)', async () => {
    const { room, host, hostDev, hostTeam } = await started({ roll: 'pick', gens: [1, 2], rerolls: { type: 3, region: 1 } });
    const tab2 = await hello(room, hostDev);
    expect(tab2.state!.you).toBe(hostTeam);
    const seen = { pickIndex: host.state!.pickIndex, roll: rollOf(host.state!.roll!) };
    expect(tab2.state!.roll).toEqual(host.state!.roll);

    expect(await act(room, host, { type: 'reroll', kind: 'type', ...seen })).toBeNull();
    const after = host.state!.roll;
    expect(rollOf(after!)).not.toEqual(seen.roll);
    expect(await act(room, tab2, { type: 'reroll', kind: 'type', ...seen })).toMatchObject({ code: 'stale', for: 'reroll' });
    expect(host.state!.roll).toEqual(after);
    expect(host.state!.rerollsUsed).toEqual({ [hostTeam]: { type: 1, region: 0 } });

    // Ältere Clients ohne Ziel: wird wie bisher auf den aktuellen Wurf angewendet
    expect(await act(room, tab2, { type: 'reroll', kind: 'type' })).toBeNull();
    expect(host.state!.rerollsUsed).toEqual({ [hostTeam]: { type: 2, region: 0 } });
  });

  it('ohne Zufallsmodus: „Gerade gibt es keinen Wurf"', async () => {
    const { room, host } = await started({ gens: [1] });
    expect(host.state!.roll).toBeNull();
    expect(await act(room, host, { type: 'reroll', kind: 'type' })).toMatchObject({
      code: 'no_roll',
      message: 'Gerade gibt es keinen Wurf',
      for: 'reroll',
    });
  });

  it('Rerolls zählen zum Limit pro Verbindung, nicht zu den Lobby-Änderungen', async () => {
    const { room, host, guest, hostDev } = await started({ roll: 'pick', gens: [1] });
    room.now += 60_000;
    guest.reset();
    for (let i = 0; i < 12; i++) await room.send(guest, { type: 'reroll', kind: 'type' });
    const errors = guest.received.filter((m): m is ErrorMsg => m.type === 'error');
    expect(errors.filter((e) => e.code === 'not_your_turn' && e.for === 'reroll')).toHaveLength(10);
    expect(errors.filter((e) => e.code === 'rate_limited')).toEqual([
      { type: 'error', code: 'rate_limited', message: 'Zu viele Nachrichten – bitte kurz warten' },
    ]);
    // Ein erfolgreicher Reroll des Hosts (gespeichert) verbraucht nichts vom Eimer der Lobby-Änderungen
    expect(room.stored!.rates?.[hostDev.deviceId]).toBeUndefined();
    expect(await act(room, host, { type: 'reroll', kind: 'type' })).toBeNull();
    expect(room.stored!.state.rerollsUsed).toEqual({ [host.state!.you!]: { type: 1, region: 0 } });
    expect(room.stored!.rates?.[hostDev.deviceId]).toBeUndefined();
  });
});

// ---------------------------------------------------------------- Ältere gespeicherte Ligen

/** Einstellungen, wie ältere Ligen sie gespeichert haben (vor gens/types/legendary/…) */
const legacySettings = (s: DraftSettings, region: number, legends: boolean) => ({
  name: s.name,
  region,
  legends,
  setPiece: s.setPiece,
  maxTeams: s.maxTeams,
  pickSeconds: s.pickSeconds,
  order: s.order,
  visibility: s.visibility,
});

describe('Ältere gespeicherte Ligen (region/legends)', () => {
  it('laufender Draft: wird beim Laden umgeschrieben, gespeichert und spielt weiter bis „done"', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await started({ gens: [1] });
    expect(await act(room, host, { type: 'pick', ...simpleChoice(host.state!, hostTeam) })).toBeNull();
    // So sah der Speicher einer Liga vor den neuen Einstellungen aus: ohne roll/rerollsUsed
    const old = room.stored!;
    const { roll: _roll, roundRoll: _roundRoll, rerollsUsed: _used, ...rest } = old.state;
    room.stored = { ...old, state: { ...rest, settings: legacySettings(old.state.settings, 1, false) as never } };
    room.restart();

    expect(await room.core.exists()).toBe(true);
    const expected: DraftSettings = { ...DEFAULT_DRAFT_SETTINGS, gens: [1], pickSeconds: 0, order: 'host' };
    // Schon beim Laden in der aktuellen Form gespeichert
    expect(room.stored!.state.settings).toEqual(expected);
    expect(room.stored!.state.settings).not.toHaveProperty('region');
    expect(room.stored!.state.picks).toHaveLength(1);

    // Der Gast ist dran (Snake) und spielt weiter; alle bekommen die neue Form
    expect(await act(room, guest, { type: 'pick', ...simpleChoice(guest.state!, guestTeam) })).toBeNull();
    const s = host.state!;
    expect(s.pickIndex).toBe(2);
    // Dazu die gespiegelten älteren Schlüssel für offene Tabs mit altem Bundle (genau der alte Pool)
    expect(s.settings).toEqual({ ...expected, region: 1, legends: false });
    expect(s.roll).toBeNull();
    expect(s.rerollsUsed).toEqual({});
    expect(s.picks[1]).not.toHaveProperty('roll');

    await driveDraft(
      room,
      host,
      new Map([
        [hostTeam, host],
        [guestTeam, guest],
      ]),
    );
    const final = host.state!;
    expect(final.phase).toBe('done');
    expect(final.picks).toHaveLength(22);
    expect(new Set(final.picks.map((p) => p.pokemonId)).size).toBe(22);
    expect(final.picks.every((p) => BY_ID.get(p.pokemonId)!.gen === 1)).toBe(true);
    expect(room.stored!.state.league).toBeTruthy();
  });

  it('Lobby mit region 0 / legends: alle Generationen mit Legendären und Mysteriösen – Lobby-Zeile bleibt gleich', async () => {
    const hostDev = newDevice();
    const { code, room } = await createLeague(hostDev, {
      name: 'Alt',
      visibility: 'public',
      gens: [...DRAFT_ALL_GENS],
      legendary: true,
      mythical: true,
    });
    const old = room.stored!;
    room.stored = { ...old, state: { ...old.state, settings: legacySettings(old.state.settings, 0, true) as never } };
    room.restart();
    const writes = updates();

    const snap = await call<DraftSnapshot>('GET', `/api/drafts/${code}`);
    expect(snap.status).toBe(200);
    const upgraded: DraftSettings = {
      ...DEFAULT_DRAFT_SETTINGS,
      name: 'Alt',
      visibility: 'public',
      gens: [...DRAFT_ALL_GENS],
      legendary: true,
      mythical: true,
    };
    // Gespeichert nur die neue Form – der Schnappschuss spiegelt region/legends für ältere Clients
    expect(snap.body.settings).toEqual({ ...upgraded, region: 0, legends: true });
    expect(room.stored!.state.settings).toEqual(upgraded);

    // Gleiche gelistete Felder → die Lobby-Zeile wird nicht neu geschrieben
    const host = await hello(room, hostDev);
    await room.advance(LOBBY_SYNC_MS);
    expect(updates()).toBe(writes);
    expect(lobbyRow(code)).toMatchObject({ region: 0, legends: 1 });

    // Neue Einstellungen gehen – und ein älterer Client mit region auch
    expect(await act(room, host, { type: 'settings', settings: { gens: [1, 2] } })).toBeNull();
    await room.advance(LOBBY_SYNC_MS);
    expect(lobbyRow(code)).toMatchObject({ region: LOBBY_REGION_MANY, legends: 1 });
    // Ein Tab mit altem Bundle liest region/legends: mehrere Generationen → 0 (Obermenge), nie undefined
    expect(host.state!.settings).toMatchObject({ gens: [1, 2], region: 0, legends: true });
    expect(await act(room, host, { type: 'settings', settings: { region: 3 } })).toBeNull();
    expect(host.state!.settings.gens).toEqual([3]);
    // … und seine Sperre löst sich: Der Spiegel zeigt genau die gesendete region
    expect(host.state!.settings).toMatchObject({ region: 3, legends: true });
    expect(await act(room, host, { type: 'settings', settings: { legends: false } }, 2100)).toBeNull();
    expect(host.state!.settings).toMatchObject({ legendary: false, mythical: false, region: 3, legends: false });
    await room.advance(LOBBY_SYNC_MS);
    expect(lobbyRow(code)).toMatchObject({ region: 3, legends: 0 });
  });

  it('lobbyFields / lobbyPoolFields verstehen auch ältere Einstellungen', () => {
    expect(lobbyPoolFields({ ...DEFAULT_DRAFT_SETTINGS, gens: [...DRAFT_ALL_GENS] })).toEqual({ region: 0, legends: false });
    expect(lobbyPoolFields({ ...DEFAULT_DRAFT_SETTINGS, gens: [6] })).toEqual({ region: 6, legends: false });
    expect(lobbyPoolFields({ ...DEFAULT_DRAFT_SETTINGS, gens: [1, 9], mythical: true })).toEqual({ region: 10, legends: true });
    const legacy = legacySettings(DEFAULT_DRAFT_SETTINGS, 4, true) as never;
    expect(lobbyPoolFields(legacy)).toEqual({ region: 4, legends: true });
    expect(lobbyFields({ settings: legacy, teams: [], hostTeamId: null, phase: 'lobby' })).toMatchObject({ region: 4, legends: true });
  });
});

// ---------------------------------------------------------------- Einstellungen prüfen

describe('Einstellungen: neue Schlüssel streng geprüft, ältere angenommen', () => {
  it('ungültige Patches per WebSocket → bad_settings bzw. pool_too_small, nichts geändert', async () => {
    const { room, host } = await lobbyWithGuest();
    const tiny: DraftSettingsPatch = { gens: [7], types: ['ice'] };
    expect(maxTeamsForPool({ ...DEFAULT_DRAFT_SETTINGS, ...tiny } as DraftSettings, ALL)).toBeLessThan(DEFAULT_DRAFT_SETTINGS.maxTeams);
    const bad: [unknown, string, string][] = [
      [{ gens: [] }, 'bad_settings', 'Mindestens eine Generation'],
      [{ gens: [0] }, 'bad_settings', 'Ungültige Generationen'],
      [{ gens: [10] }, 'bad_settings', 'Ungültige Generationen'],
      [{ gens: [1.5] }, 'bad_settings', 'Ungültige Generationen'],
      [{ gens: ['1'] }, 'bad_settings', 'Ungültige Generationen'],
      [{ gens: 'alle' }, 'bad_settings', 'Ungültige Generationen'],
      [{ gens: { 0: 1 } }, 'bad_settings', 'Ungültige Generationen'],
      [{ gens: [1, 2, 3, 4, 5, 6, 7, 8, 9, 1] }, 'bad_settings', 'Ungültige Generationen'],
      [{ types: [] }, 'bad_settings', 'Mindestens ein Typ'],
      [{ types: ['fire', 'laser'] }, 'bad_settings', 'Ungültige Typen'],
      [{ types: 'fire' }, 'bad_settings', 'Ungültige Typen'],
      [{ types: [1] }, 'bad_settings', 'Ungültige Typen'],
      [{ types: [...TYPE_KEYS, 'fire'] }, 'bad_settings', 'Ungültige Typen'],
      [{ rerolls: { type: 4 } }, 'bad_settings', 'Ungültige Rerolls'],
      [{ rerolls: { region: -1 } }, 'bad_settings', 'Ungültige Rerolls'],
      [{ rerolls: { type: 1.5 } }, 'bad_settings', 'Ungültige Rerolls'],
      [{ rerolls: { type: '1' } }, 'bad_settings', 'Ungültige Rerolls'],
      [{ rerolls: 2 }, 'bad_settings', 'Ungültige Rerolls'],
      [{ rerolls: [1, 1] }, 'bad_settings', 'Ungültige Rerolls'],
      [{ rerolls: null }, 'bad_settings', 'Ungültige Rerolls'],
      [{ maxLegends: 0 }, 'bad_settings', 'Ungültiges Legendären-Limit'],
      [{ maxLegends: 4 }, 'bad_settings', 'Ungültiges Legendären-Limit'],
      [{ maxLegends: 1.5 }, 'bad_settings', 'Ungültiges Legendären-Limit'],
      [{ maxLegends: '2' }, 'bad_settings', 'Ungültiges Legendären-Limit'],
      [{ roll: 'always' }, 'bad_settings', 'Ungültiger Zufallsmodus'],
      [{ roll: 1 }, 'bad_settings', 'Ungültiger Zufallsmodus'],
      [{ snake: 'ja' }, 'bad_settings', 'Ungültige Einstellung'],
      [{ legendary: 1 }, 'bad_settings', 'Ungültige Einstellung'],
      [{ mythical: null }, 'bad_settings', 'Ungültige Einstellung'],
      [{ legends: 'ja' }, 'bad_settings', 'Ungültige Einstellung'],
      [{ region: 10 }, 'bad_settings', 'Ungültige Region'],
      [{ region: '1' }, 'bad_settings', 'Ungültige Region'],
      [tiny, 'pool_too_small', 'Der Pool reicht nur für 0 Teams à 11 Pokémon'],
    ];
    const before = room.stored;
    for (const [settings, code, message] of bad) {
      const err = await act(room, host, { type: 'settings', settings }, 2100);
      expect(err, JSON.stringify(settings)).toEqual({ type: 'error', code, message, for: 'settings' });
    }
    expect(room.stored!.state).toEqual(before!.state);
  });

  it('gültige Patches: neue Schlüssel, ältere region/legends (neue haben Vorrang), Unbekanntes fällt weg', async () => {
    const { room, host, guest } = await lobbyWithGuest();
    const steps: [DraftSettingsPatch | Record<string, unknown>, Partial<DraftSettings>][] = [
      [{ gens: [3, 1, 3] }, { gens: [1, 3] }],
      [{ region: 5 }, { gens: [5] }],
      [{ region: 0, gens: [2] }, { gens: [2] }],
      [{ region: 0 }, { gens: [...DRAFT_ALL_GENS] }],
      [{ legends: true, mythical: false }, { legendary: true, mythical: false }],
      [{ maxLegends: 2 }, { maxLegends: 2 }],
      [{ roll: 'round', snake: false }, { roll: 'round', snake: false }],
      [{ rerolls: { region: 3, junk: 9 } }, { rerolls: { type: 1, region: 3 } }],
      [{ rerolls: { type: 0 } }, { rerolls: { type: 0, region: 3 } }],
      [{ gens: [1, 2], types: ['water', 'fire'], roll: 'pick' }, { gens: [1, 2], types: TYPE_KEYS.filter((t) => t === 'fire' || t === 'water'), roll: 'pick' }],
      [{ maxLegends: null, legends: false, junk: 1 }, { maxLegends: null, legendary: false, mythical: false }],
    ];
    for (const [settings, want] of steps) {
      expect(await act(room, host, { type: 'settings', settings }, 2100), JSON.stringify(settings)).toBeNull();
      expect(host.state!.settings, JSON.stringify(settings)).toMatchObject(want);
    }
    const expected: DraftSettings = {
      ...DEFAULT_DRAFT_SETTINGS,
      gens: [1, 2],
      types: TYPE_KEYS.filter((t) => t === 'fire' || t === 'water'),
      maxLegends: null,
      roll: 'pick',
      snake: false,
      rerolls: { type: 0, region: 3 },
    };
    expect(room.stored!.state.settings).toEqual(expected);
    // Mehrere Generationen → region 0 (Obermenge für ältere Clients)
    expect(guest.state!.settings).toEqual({ ...expected, region: 0, legends: false });
    // Der Rest des Pools trägt noch die Liga
    expect(maxTeamsForPool(expected, ALL)).toBeGreaterThanOrEqual(expected.maxTeams);
  });

  it('POST /api/drafts prüft die neuen Schlüssel ebenso (400) und nimmt gültige an', async () => {
    const dev = newDevice();
    const bad: [unknown, RegExp][] = [
      [{ gens: [] }, /Mindestens eine Generation/],
      [{ gens: [1, 'x'] }, /Ungültige Generationen/],
      [{ types: ['laser'] }, /Ungültige Typen/],
      [{ types: [] }, /Mindestens ein Typ/],
      [{ rerolls: { type: 9 } }, /Ungültige Rerolls/],
      [{ maxLegends: 5 }, /Legendären-Limit/],
      [{ roll: 'sometimes' }, /Zufallsmodus/],
      [{ snake: 0 }, /Ungültige Einstellung/],
    ];
    for (const [settings, msg] of bad) {
      const res = await call<ApiErrorBody>('POST', '/api/drafts', createBody(dev, settings));
      expect(res.status, JSON.stringify(settings)).toBe(400);
      expect(res.body.message).toMatch(msg);
    }
    expect(db.query('SELECT * FROM draft_lobbies')).toHaveLength(0);

    const { room } = await createLeague(dev, {
      gens: [5, 4],
      types: ['dragon', 'steel', 'water', 'fire', 'grass', 'normal'],
      legendary: true,
      maxLegends: 1,
      roll: 'round',
      rerolls: { type: 3, region: 0 },
      snake: false,
    });
    expect(room.stored!.state.settings).toMatchObject({
      gens: [4, 5],
      types: TYPE_KEYS.filter((t) => ['dragon', 'steel', 'water', 'fire', 'grass', 'normal'].includes(t)),
      legendary: true,
      mythical: false,
      maxLegends: 1,
      roll: 'round',
      rerolls: { type: 3, region: 0 },
      snake: false,
    });
  });

  it('cleanSettingsPatch: nur bekannte Schlüssel, frische Kopien, rerolls nur mit type/region', () => {
    const gens = [2, 3];
    const raw = JSON.parse(
      JSON.stringify({ gens, types: ['fire'], rerolls: { type: 2, junk: 1 }, region: 1, legends: true, junk: 'x', owners: { a: 'b' } }),
    ) as Record<string, unknown>;
    const patch = cleanSettingsPatch(raw);
    expect(patch).toEqual({ gens: [2, 3], types: ['fire'], rerolls: { type: 2 }, region: 1, legends: true });
    expect(patch.gens).not.toBe(raw.gens);
    (raw.gens as number[]).push(4);
    expect(patch.gens).toEqual([2, 3]);
    // Prototyp-Tricks bleiben wirkungslos
    const sneaky = cleanSettingsPatch(JSON.parse('{"__proto__":{"roll":"pick"},"rerolls":{"__proto__":{"type":3}}}'));
    expect(sneaky).toEqual({ rerolls: {} });
    expect(Object.getPrototypeOf(sneaky.rerolls)).toBe(Object.prototype);
    expect(() => cleanSettingsPatch([])).toThrow('Ungültige Einstellungen');
    expect(() => cleanSettingsPatch(null)).toThrow('Ungültige Einstellungen');
  });
});

// ---------------------------------------------------------------- Lobby-Zeile

describe('Lobby-Zeile: region 0 / n / 10 ohne Schema-Änderung', () => {
  it('beim Anlegen, in der Liste und nach Änderungen in der Lobby', async () => {
    const cases: [DraftSettingsPatch, number, number][] = [
      [{ gens: [...DRAFT_ALL_GENS] }, 0, 0],
      [{ gens: [4] }, 4, 0],
      [{ gens: [1, 4] }, LOBBY_REGION_MANY, 0],
      [{ gens: [1, 2, 3, 4, 5, 6, 7, 8] }, LOBBY_REGION_MANY, 0],
      [{ region: 5 }, 5, 0],
      [{ region: 0, legends: true }, 0, 1],
      [{ gens: [2], mythical: true }, 2, 1],
      [{ gens: [2, 3], legendary: true }, LOBBY_REGION_MANY, 1],
    ];
    const codes: string[] = [];
    for (const [settings, region, legends] of cases) {
      const { code } = await createLeague(newDevice(), { ...settings, visibility: 'public' });
      expect(lobbyRow(code), JSON.stringify(settings)).toMatchObject({ region, legends });
      codes.push(code);
    }
    const list = (await call<PublicLobbiesResponse>('GET', '/api/drafts/public')).body.lobbies;
    cases.forEach(([settings, region, legends], i) => {
      expect(list.find((l) => l.code === codes[i]), JSON.stringify(settings)).toMatchObject({ region, legends: legends === 1 });
    });

    // Änderungen in der Lobby ziehen die Zeile nach (gebündelt)
    const hostDev = newDevice();
    const { code, room } = await createLeague(hostDev, { gens: [1], visibility: 'public' });
    const host = await hello(room, hostDev);
    room.now += 60_000;
    expect(await act(room, host, { type: 'settings', settings: { gens: [1, 2] } })).toBeNull();
    await room.advance(LOBBY_SYNC_MS);
    expect(lobbyRow(code)).toMatchObject({ region: LOBBY_REGION_MANY, legends: 0 });
    expect(await act(room, host, { type: 'settings', settings: { gens: [...DRAFT_ALL_GENS], mythical: true } })).toBeNull();
    await room.advance(LOBBY_SYNC_MS);
    expect(lobbyRow(code)).toMatchObject({ region: 0, legends: 1 });
    // Ungelistetes (Typen, Zufallsmodus, Snake) schreibt die Zeile nicht
    const writes = updates();
    expect(await act(room, host, { type: 'settings', settings: { types: ['fire', 'water', 'grass'], roll: 'pick', snake: false } })).toBeNull();
    await room.advance(LOBBY_SYNC_MS);
    expect(updates()).toBe(writes);
    // Die Liste zeigt den Stand der Zeile
    const mine = (await call<PublicLobbiesResponse>('GET', '/api/drafts/public')).body.lobbies.find((l) => l.code === code);
    expect(mine).toMatchObject({ region: 0, legends: true });
  });
});
