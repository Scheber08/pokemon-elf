/** Manager-Saison des Online-Drafts: Bank im Draft, Spieltage im Takt, Aufstellungen, Tagesform. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DeviceAuth } from '../src/lib/api/contract';
import { DRAFT_BENCH_SLOT, DRAFT_LIMITS, type CreateDraftResponse, type DraftSnapshot } from '../src/lib/api/draftContract';
import {
  addCpuTeam,
  applyPick,
  autoPickChoice,
  createDraft,
  currentTeam,
  draftedIds,
  normalizeSettings,
  rosterOf,
  rounds,
  snapshotOf,
  startDraft,
  totalPicks,
  upgradeSettings,
  type DraftState,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import {
  bestLineup,
  kickoffAt,
  lineupError,
  managerSchedule,
  nextKickoff,
  playDueMatchdays,
  playMatchday,
  pokemonForm,
  setLineup,
  startManagerSeason,
} from '../src/lib/manager';
import { expiresAt } from '../server/draftCore';
import { handleApi, type Env } from '../server/handler';
import { D1Shim } from './d1shim';
import { FakeNamespace, FakeRoom, type FakeSocket } from './fakeSocket';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');
const BY_ID = new Map(ALL.map((p) => [p.id, p]));
const HOUR = 3_600_000;

/** Manager-Liga (Host + CPU) bis zum Ende des Drafts */
function drafted(settings: Record<string, unknown> = {}, seed: number | string = 7): DraftState {
  let s = createDraft({
    code: 'MGR234',
    seed,
    settings: { pickSeconds: 0, format: 'manager', ...settings },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Host-Elf', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  s = addCpuTeam(s, 'dev-h', 'c1');
  s = startDraft(s, 'dev-h', 0, ALL);
  while (s.phase === 'drafting') {
    const cur = currentTeam(s)!;
    const c = autoPickChoice(s, cur.id, ALL, SCALE, cur.cpu);
    s = applyPick(s, cur.id, c.pokemonId, c.slot, true, 1000, ALL);
  }
  return s;
}

describe('Einstellungen', () => {
  it('Bank und Takt: Standard 3 Plätze, alle 12 Stunden; nur erlaubte Werte', () => {
    expect(upgradeSettings({}).bench).toBe(3);
    expect(upgradeSettings({}).matchdayMinutes).toBe(720);
    expect(upgradeSettings({ bench: 4 }).bench).toBe(3);
    expect(upgradeSettings({ format: 'manager', bench: 5, matchdayMinutes: 10 })).toMatchObject({ format: 'manager', bench: 5, matchdayMinutes: 10 });
    const base = upgradeSettings({});
    expect(() => normalizeSettings({ bench: 4 as never }, base, ALL)).toThrow(/Bank/);
    expect(() => normalizeSettings({ matchdayMinutes: 5 as never }, base, ALL)).toThrow(/Takt/);
  });

  it('Picks pro Team: Bank nur in der Manager-Saison', () => {
    expect(rounds({ setPiece: false, format: 'league', bench: 5 })).toBe(11);
    expect(rounds({ setPiece: true, format: 'manager', bench: 5 })).toBe(17);
    expect(rounds({ setPiece: false, format: 'manager', bench: 3 })).toBe(14);
  });
});

describe('Draft mit Bank', () => {
  it('jedes Team draftet Elf + Bank, danach beginnt die Saison im eingestellten Takt', () => {
    const s = drafted({ matchdayMinutes: 60 });
    expect(totalPicks(s)).toBe(2 * 14);
    expect(s.picks).toHaveLength(28);
    for (const t of s.teams) {
      expect(t.bench).toHaveLength(3);
      expect(t.bench!.every((id) => id != null)).toBe(true);
      expect(rosterOf(t)).toHaveLength(14);
    }
    expect(draftedIds(s).size).toBe(28);
    // Bank wird erst nach der Elf besetzt (Auto-Pick)
    const benchPicks = s.picks.filter((p) => p.slot >= DRAFT_BENCH_SLOT);
    expect(Math.min(...benchPicks.map((p) => p.pick))).toBeGreaterThanOrEqual(22);
    expect(s.phase).toBe('season');
    expect(s.season).toMatchObject({ stepMs: 60 * 60_000, startsAt: 1000 + HOUR });
    // Kürzerer Takt: erster Spieltag nach einem Abstand; längerer: nach höchstens einer Stunde
    expect(drafted({ matchdayMinutes: 10 }).season!.startsAt).toBe(1000 + 10 * 60_000);
    expect(drafted({ matchdayMinutes: 1440 }).season!.startsAt).toBe(1000 + HOUR);
  });

  it('Liga und KO-Turnier bleiben ohne Bank', () => {
    let s = createDraft({ code: 'LGA234', seed: 1, settings: { pickSeconds: 0, bench: 5 }, host: { teamId: 'h', deviceId: 'd', name: 'H', formation: '4-3-3' }, now: 0, list: ALL });
    s = startDraft(addCpuTeam(s, 'd', 'c'), 'd', 0, ALL);
    expect(s.teams.every((t) => t.bench === undefined)).toBe(true);
    expect(totalPicks(s)).toBe(22);
  });
});

describe('Saison', () => {
  it('Start: 18 Teams, 17 Spieltage, Aufstellungen wie gedraftet bzw. automatisch', () => {
    const s = startManagerSeason(drafted(), ALL, SCALE);
    const m = s.manager!;
    expect(s.league!.teams).toHaveLength(DRAFT_LIMITS.leagueSize);
    expect(m.total).toBe(17);
    expect(m.played).toBe(0);
    expect(m.fill).toHaveLength(16);
    expect(Object.keys(m.lineups).sort()).toEqual(['c1', 'h']);
    for (const t of s.teams) expect(lineupError(t, m.lineups[t.id], false)).toBeNull();
    expect(s.league!.matches).toEqual([]);
    expect(nextKickoff(s)).toBe(s.season!.startsAt);
    // Schnappschuss: Manager-Teil ohne Auffüllkader
    const snap = snapshotOf(s, 'h', 0);
    expect(snap.manager).toMatchObject({ played: 0, total: 17, nextAt: s.season!.startsAt });
    expect(JSON.stringify(snap)).not.toContain('"fill"');
  });

  it('Hinrunde: jeder spielt jeden genau einmal', () => {
    const rounds = managerSchedule(18);
    expect(rounds).toHaveLength(17);
    const pairs = new Set(rounds.flat().map(([a, b]) => [a, b].sort((x, y) => x - y).join('-')));
    expect(pairs.size).toBe((18 * 17) / 2);
  });

  it('Spieltage zum Anpfiff, deterministisch; am Ende Phase „done"', () => {
    const start = startManagerSeason(drafted(), ALL, SCALE);
    const before = playDueMatchdays(start, start.season!.startsAt - 1, ALL, SCALE);
    expect(before.manager!.played).toBe(0);
    const one = playDueMatchdays(start, start.season!.startsAt, ALL, SCALE);
    expect(one.manager!.played).toBe(1);
    expect(one.league!.matches).toHaveLength(9);
    expect(one.league!.matches.every((m) => m.round === 1)).toBe(true);
    expect(playMatchday(start, ALL, SCALE)).toEqual(one);
    // Drei Abstände später: alle fälligen auf einmal
    const three = playDueMatchdays(start, kickoffAt(start.season!, 3), ALL, SCALE);
    expect(three.manager!.played).toBe(3);
    const end = playDueMatchdays(start, Infinity, ALL, SCALE);
    expect(end.phase).toBe('done');
    expect(end.manager!.played).toBe(17);
    expect(end.league!.matches).toHaveLength(153);
    expect(end.league!.table.every((r) => r.played === 17)).toBe(true);
    expect(nextKickoff(end)).toBeNull();
  });

  it('Aufstellung: nur eigene Kader-Pokémon, jedes einmal; Bankspieler einwechseln', () => {
    const s = startManagerSeason(drafted(), ALL, SCALE);
    const host = s.teams.find((t) => t.id === 'h')!;
    const cur = s.manager!.lineups.h;
    const foreign = s.teams.find((t) => t.id === 'c1')!.slots[0]!;
    const bad = (slots: number[]) => () => setLineup(s, 'dev-h', { formation: '4-3-3', slots, ss: null, auto: false }, ALL, SCALE);
    expect(bad([foreign, ...cur.slots.slice(1)])).toThrow(/Kader/);
    expect(bad([cur.slots[1], ...cur.slots.slice(1)])).toThrow(/einmal/);
    expect(bad(cur.slots.slice(1))).toThrow(/11 Spieler/);
    expect(() => setLineup(s, 'fremd', { ...cur }, ALL, SCALE)).toThrow(/nicht dabei/);
    const sub = rosterOf(host).find((id) => !cur.slots.includes(id))!;
    const next = setLineup(s, 'dev-h', { formation: '4-3-3', slots: [sub, ...cur.slots.slice(1)], ss: null, auto: false }, ALL, SCALE);
    expect(next.manager!.lineups.h).toEqual({ formation: '4-3-3', slots: [sub, ...cur.slots.slice(1)], ss: null, auto: false });
    // Manuelle Aufstellung bleibt über den Spieltag hinweg, die CPU stellt neu auf
    const after = playMatchday(next, ALL, SCALE);
    expect(after.manager!.lineups.h.slots[0]).toBe(sub);
    expect(after.manager!.lineups.h.auto).toBe(false);
    // Andere Formation automatisch
    const auto = setLineup(s, 'dev-h', { formation: '3-5-2' as never, slots: [], ss: null, auto: true }, ALL, SCALE);
    expect(auto.manager!.lineups.h.formation).toBe('3-5-2');
    expect(lineupError(host, auto.manager!.lineups.h, false)).toBeNull();
  });

  it('Aufstellung zählt: eine schwache Elf spielt schlechter als die beste', () => {
    const s = startManagerSeason(drafted(), ALL, SCALE);
    const host = s.teams.find((t) => t.id === 'h')!;
    // Alle auf falschen Positionen: Elf rückwärts
    const best = bestLineup(host, '4-3-3', BY_ID, SCALE, s.manager!.form, false);
    const worst = { ...best, slots: [...best.slots].reverse(), auto: false };
    const a = playMatchday(s, ALL, SCALE);
    const b = playMatchday({ ...s, manager: { ...s.manager!, lineups: { ...s.manager!.lineups, h: worst } } }, ALL, SCALE);
    const idx = s.teams.findIndex((t) => t.id === 'h');
    expect(b.league!.teams[idx].rating).toBeLessThan(a.league!.teams[idx].rating);
  });

  it('Tagesform: −2 … +2, meist 0, fest je Liga, Spieltag und Pokémon', () => {
    const counts = new Map<number, number>();
    for (let id = 1; id <= 1000; id++) {
      const f = pokemonForm('geheim', 1, id);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([-1, -2, 0, 1, 2]);
    expect(counts.get(0)!).toBeGreaterThan(300);
    expect(pokemonForm('geheim', 1, 25)).toBe(pokemonForm('geheim', 1, 25));
    const changes = Array.from({ length: 50 }, (_, i) => pokemonForm('geheim', 1, i + 1) !== pokemonForm('geheim', 2, i + 1)).filter(Boolean);
    expect(changes.length).toBeGreaterThan(20);
  });

  it('Löschfrist: erst 14 Tage nach dem letzten Spieltag', () => {
    const s = startManagerSeason(drafted({ matchdayMinutes: 1440 }), ALL, SCALE);
    const end = kickoffAt(s.season!, 17);
    expect(expiresAt(s)).toBe(end + DRAFT_LIMITS.retentionDays * 86_400_000);
    expect(expiresAt({ createdAt: 0 })).toBe(DRAFT_LIMITS.retentionDays * 86_400_000);
  });
});

describe('Draft-Raum: Manager-Saison', () => {
  let db: D1Shim;
  let drafts: FakeNamespace;
  let env: Env;
  beforeEach(() => {
    db = new D1Shim();
    drafts = new FakeNamespace(() => new FakeRoom({ DB: db }, ALL, SCALE));
    env = { DB: db, DRAFTS: drafts };
  });
  const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

  it('Draft → Saison; Spieltage per Alarm; eigene Aufstellung per Nachricht', async () => {
    const dev = newDevice();
    const res = await handleApi(
      new Request('http://localhost/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dev, settings: { pickSeconds: 0, format: 'manager', matchdayMinutes: 10, bench: 5 }, teamName: 'Host-Elf', formation: '4-3-3' }),
      }),
      env,
    );
    const { code } = (await res.json()) as CreateDraftResponse;
    const room = drafts.room(code);
    const host: FakeSocket = room.connect(null);
    await room.send(host, { type: 'hello', ...dev });
    await room.send(host, { type: 'add-cpu' });
    await room.send(host, { type: 'start' });
    for (let i = 0; i < 100 && room.stored!.state.phase === 'drafting'; i++) {
      const cur = currentTeam(room.stored!.state)!;
      if (cur.cpu) await room.fireAlarm();
      else await room.send(host, { type: 'auto-pick' });
    }
    const st = room.stored!.state;
    expect(st.phase).toBe('season');
    expect(st.manager!.total).toBe(17);
    expect(st.teams.every((t) => t.bench?.length === 5)).toBe(true);
    const snap = host.state as DraftSnapshot;
    expect(snap.manager!.nextAt).toBe(st.season!.startsAt);
    // Alarm steht auf dem Anpfiff
    expect(room.alarmAt).toBe(st.season!.startsAt);

    // Eigene Aufstellung: Bankspieler rein
    const me = st.teams.find((t) => !t.cpu)!;
    const lineup = st.manager!.lineups[me.id];
    // Ein Kader-Pokémon, das gerade nicht spielt (die automatische Elf nimmt auch Bankspieler)
    const spare = rosterOf(me).find((id) => !lineup.slots.includes(id))!;
    const slots = [spare, ...lineup.slots.slice(1)];
    await room.send(host, { type: 'lineup', formation: '4-3-3', slots, ss: null, auto: false });
    expect(host.lastError).toBeNull();
    expect(room.stored!.state.manager!.lineups[me.id]).toMatchObject({ slots, auto: false });
    // Fremdes Pokémon → Fehler, nichts geändert
    const foreign = st.teams.find((t) => t.cpu)!.slots[0];
    await room.send(host, { type: 'lineup', formation: '4-3-3', slots: [foreign, ...slots.slice(1)], ss: null, auto: false });
    expect(host.lastError?.code).toBe('bad_lineup');

    // Spieltag 1 zum Anpfiff, danach steht der Alarm auf Spieltag 2
    await room.advanceTo(st.season!.startsAt);
    const s1 = room.stored!.state;
    expect(s1.manager!.played).toBe(1);
    expect(s1.league!.matches).toHaveLength(9);
    expect(room.alarmAt).toBe(kickoffAt(st.season!, 2));
    expect((host.state as DraftSnapshot).league!.matches).toHaveLength(9);
    // Bis zum Ende: Phase done, Ergebnis gespeichert
    await room.advanceTo(kickoffAt(st.season!, 17));
    const end = room.stored!.state;
    expect(end.phase).toBe('done');
    expect(end.league!.matches).toHaveLength(153);
    expect(room.alarmAt).toBe(expiresAt(end));
  });
});
