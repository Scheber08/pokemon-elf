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
  setTeamJerseys,
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
  freeAgents,
  setClaim,
  processClaims,
  makeOffer,
  answerOffer,
  tradeError,
  OFFERS_PER_TEAM,
  cpuOffers,
  squadStrength,
} from '../src/lib/manager';
import { expiresAt, parseClientMessage } from '../server/draftCore';
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
    // Gespielte Aufstellung des Spieltags bleibt gespeichert (2D-Ansicht)
    expect(after.manager!.playedLineups!['1'].h.slots[0]).toBe(sub);
    expect(snapshotOf(after, 'h', 0).manager!.playedLineups!['1'].h.formation).toBe('4-3-3');
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

describe('Transfermarkt', () => {
  const season = () => startManagerSeason(drafted(), ALL, SCALE);

  it('freie Pokémon: Pool ohne Gedraftete; Wunsch prüfen, setzen, zurückziehen – privat im Schnappschuss', () => {
    const s = season();
    const free = freeAgents(s, ALL);
    const taken = draftedIds(s);
    expect(free.length).toBeGreaterThan(0);
    expect(free.some((p) => taken.has(p.id))).toBe(false);
    const host = s.teams.find((t) => t.id === 'h')!;
    const cpu = s.teams.find((t) => t.id === 'c1')!;
    const out = rosterOf(host)[0];
    expect(() => setClaim(s, 'dev-h', { in: free[0].id, out: rosterOf(cpu)[0] }, ALL)).toThrow(/Kader/);
    expect(() => setClaim(s, 'dev-h', { in: rosterOf(cpu)[0], out }, ALL)).toThrow(/frei/);
    expect(() => setClaim(s, 'dev-h', { in: free[0].id, out: null }, ALL)).toThrow(/abgibst/);
    const c = setClaim(s, 'dev-h', { in: free[0].id, out }, ALL);
    expect(c.manager!.claims).toEqual({ h: { in: free[0].id, out } });
    expect(snapshotOf(c, 'h', 0).manager!.claim).toEqual({ in: free[0].id, out });
    expect(snapshotOf(c, 'c1', 0).manager!.claim).toBeNull();
    expect(snapshotOf(c, null, 0).manager).not.toHaveProperty('claim');
    expect(setClaim(c, 'dev-h', { in: null, out: null }, ALL).manager!.claims).toEqual({});
  });

  it('zum Anpfiff: Tausch im Kader und in der Aufstellung, Protokoll, Wünsche danach leer', () => {
    const s = season();
    const host = s.teams.find((t) => t.id === 'h')!;
    const lineup = s.manager!.lineups.h;
    const out = lineup.slots[0];
    const inn = freeAgents(s, ALL)[0].id;
    // Eigene Aufstellung (nicht automatisch) – der Neue übernimmt den Platz
    let st = setLineup(s, 'dev-h', { ...lineup, auto: false }, ALL, SCALE);
    st = setClaim(st, 'dev-h', { in: inn, out }, ALL);
    const after = playMatchday(st, ALL, SCALE);
    const team = after.teams.find((t) => t.id === 'h')!;
    expect(rosterOf(team)).toContain(inn);
    expect(rosterOf(team)).not.toContain(out);
    expect(rosterOf(team)).toHaveLength(rosterOf(host).length);
    expect(after.manager!.lineups.h.slots[0]).toBe(inn);
    expect(after.manager!.transfers).toContainEqual({ matchday: 1, teamId: 'h', in: inn, out });
    expect(after.manager!.claims).toBeUndefined();
    expect(freeAgents(after, ALL).some((p) => p.id === out)).toBe(true);
  });

  it('gleicher Wunsch zweier Teams: der Tabellenschlechtere bekommt ihn, der andere verfällt', () => {
    const s = season();
    const inn = freeAgents(s, ALL)[0].id;
    const outH = rosterOf(s.teams.find((t) => t.id === 'h')!)[0];
    const outC = rosterOf(s.teams.find((t) => t.id === 'c1')!)[0];
    const st = { ...s, manager: { ...s.manager!, claims: { h: { in: inn, out: outH }, c1: { in: inn, out: outC } } } };
    const after = processClaims(st, ALL, SCALE);
    const place = (id: string) => s.league!.table.findIndex((r) => r.team === s.teams.findIndex((t) => t.id === id));
    const worse = place('h') > place('c1') ? 'h' : 'c1';
    expect(after.manager!.transfers!.filter((x) => x.in === inn)).toEqual([expect.objectContaining({ teamId: worse })]);
  });
});

describe('Tausch zwischen Teams', () => {
  /** Saison, in der c1 ein Mensch ist (Gerät dev-c) */
  const humans = (): DraftState => {
    const s = startManagerSeason(drafted(), ALL, SCALE);
    return { ...s, teams: s.teams.map((t) => (t.id === 'c1' ? { ...t, cpu: false } : t)), owners: { ...s.owners, c1: 'dev-c' } };
  };
  const rosters = (s: DraftState) => ({ h: rosterOf(s.teams.find((t) => t.id === 'h')!), c: rosterOf(s.teams.find((t) => t.id === 'c1')!) });

  it('Angebot prüfen, nur für Beteiligte sichtbar, annehmen tauscht Kader, Aufstellung und Protokoll', () => {
    const s = humans();
    const { h, c } = rosters(s);
    const give = s.manager!.lineups.h.slots[0];
    const get = s.manager!.lineups.c1.slots[0];
    expect(() => makeOffer(s, 'dev-h', { to: 'c1', give: c[0], get }, ALL, SCALE)).toThrow(/Kader/);
    expect(() => makeOffer(s, 'dev-h', { to: 'c1', give, get: h[1] }, ALL, SCALE)).toThrow(/nicht \(mehr\)/);
    expect(() => makeOffer(s, 'dev-h', { to: 'h', give, get: h[1] }, ALL, SCALE)).toThrow();
    const o = makeOffer(s, 'dev-h', { to: 'c1', give, get }, ALL, SCALE);
    expect(o.manager!.offers).toEqual([{ id: 1, from: 'h', to: 'c1', give, get }]);
    // gleiches Angebot nochmal: nichts passiert
    expect(makeOffer(o, 'dev-h', { to: 'c1', give, get }, ALL, SCALE)).toBe(o);
    expect(snapshotOf(o, 'h', 0).manager!.offers).toHaveLength(1);
    expect(snapshotOf(o, 'c1', 0).manager!.offers).toHaveLength(1);
    expect(snapshotOf(o, null, 0).manager).not.toHaveProperty('offers');
    // Der Anbieter kann nicht selbst annehmen (nur zurückziehen)
    expect(answerOffer(o, 'dev-h', { id: 1, accept: true }, ALL).manager!.offers).toEqual([]);
    const done = answerOffer(o, 'dev-c', { id: 1, accept: true }, ALL);
    const after = rosters(done);
    expect(after.h).toContain(get);
    expect(after.h).not.toContain(give);
    expect(after.c).toContain(give);
    expect(done.manager!.lineups.h.slots[0]).toBe(get);
    expect(done.manager!.lineups.c1.slots[0]).toBe(give);
    expect(done.manager!.transfers).toEqual([
      { matchday: 1, teamId: 'h', in: get, out: give, with: 'c1' },
      { matchday: 1, teamId: 'c1', in: give, out: get, with: 'h' },
    ]);
    expect(done.manager!.offers).toEqual([]);
    expect(() => answerOffer(done, 'dev-c', { id: 1, accept: true }, ALL)).toThrow(/nicht mehr/);
  });

  it('ablehnen, Höchstzahl offener Angebote, hinfällige Angebote verfallen zum Anpfiff', () => {
    const s = humans();
    const { h, c } = rosters(s);
    let st: DraftState = s;
    for (let i = 0; i < OFFERS_PER_TEAM; i++) st = makeOffer(st, 'dev-h', { to: 'c1', give: h[i], get: c[i] }, ALL, SCALE);
    expect(() => makeOffer(st, 'dev-h', { to: 'c1', give: h[5], get: c[5] }, ALL, SCALE)).toThrow(/Höchstens/);
    st = answerOffer(st, 'dev-c', { id: 1, accept: false }, ALL);
    expect(st.manager!.offers!.map((o) => o.id)).toEqual([2, 3]);
    // Angebot 2 wird hinfällig, wenn h sein Pokémon über den Transfermarkt abgibt
    st = setClaim(st, 'dev-h', { in: freeAgents(st, ALL)[0].id, out: h[1] }, ALL);
    const played = playMatchday(st, ALL, SCALE);
    expect(played.manager!.offers!.map((o) => o.id)).toEqual([3]);
    expect(tradeError(played, played.manager!.offers![0], ALL)).toBeNull();
  });

  it('CPU-Teams bieten von sich aus an (beide Elfen werden stärker), annehmen tauscht, alte CPU-Angebote verfallen', () => {
    let s = startManagerSeason(drafted(), ALL, SCALE);
    const team = (st: DraftState, id: string) => st.teams.find((t) => t.id === id)!;
    const gain = (st: DraftState, id: string, out: number, inn: number) => {
      const t = team(st, id);
      const swapped = { ...t, slots: t.slots.map((x) => (x === out ? inn : x)), bench: t.bench?.map((x) => (x === out ? inn : x)) };
      return squadStrength(swapped, BY_ID, SCALE) - squadStrength(t, BY_ID, SCALE);
    };
    let seen = 0;
    let firstOffer: DraftState | null = null;
    for (let k = 0; k < 10; k++) {
      s = playMatchday(s, ALL, SCALE);
      const offers = s.manager!.offers ?? [];
      // höchstens ein CPU-Angebot je Mensch und Spieltag, nur an Menschen
      expect(offers.length).toBeLessThanOrEqual(1);
      for (const o of offers) {
        seen++;
        firstOffer ??= s;
        expect(o).toMatchObject({ from: 'c1', to: 'h' });
        expect(gain(s, 'c1', o.give, o.get)).toBeGreaterThanOrEqual(0.5);
        expect(gain(s, 'h', o.get, o.give)).toBeGreaterThan(0);
        expect(tradeError(s, o, ALL)).toBeNull();
      }
    }
    expect(seen).toBeGreaterThan(0);
    // Deterministisch
    expect(cpuOffers(s, ALL, SCALE)).toEqual(cpuOffers(s, ALL, SCALE));
    // Annehmen eines CPU-Angebots
    const withOffer = firstOffer!;
    const o = withOffer.manager!.offers![0];
    const done = answerOffer(withOffer, 'dev-h', { id: o.id, accept: true }, ALL);
    expect(rosterOf(team(done, 'h'))).toContain(o.give);
    expect(done.manager!.transfers!.at(-2)).toMatchObject({ teamId: 'c1', in: o.get, out: o.give, with: 'h' });
  });

  it('Nachrichten offer / offer-reply: nur gültige Form', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'offer', to: 'c1', give: 6, get: 25 }))).toMatchObject({ ok: true });
    expect(parseClientMessage(JSON.stringify({ type: 'offer', to: 'c1', give: '6', get: 25 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'offer-reply', id: 2, accept: true }))).toMatchObject({ ok: true });
    expect(parseClientMessage(JSON.stringify({ type: 'offer-reply', id: 2, accept: 'ja' })).ok).toBe(false);
  });

  it('CPU-Team antwortet sofort: wird seine beste Elf klar stärker → Tausch, sonst Absage', () => {
    const s = startManagerSeason(drafted(), ALL, SCALE);
    const { h, c } = rosters(s);
    const cpu = s.teams.find((t) => t.id === 'c1')!;
    const base = squadStrength(cpu, BY_ID, SCALE);
    const gain = (give: number, get: number) =>
      squadStrength({ ...cpu, slots: cpu.slots.map((x) => (x === get ? give : x)), bench: cpu.bench?.map((x) => (x === get ? give : x)) }, BY_ID, SCALE) - base;
    let accepted = 0;
    let declined = 0;
    for (const give of h.slice(0, 6)) {
      for (const get of c.slice(0, 6)) {
        const expectYes = gain(give, get) >= 0.5;
        if (expectYes) {
          const r = makeOffer(s, 'dev-h', { to: 'c1', give, get }, ALL, SCALE);
          expect(rosters(r).c).toContain(give);
          expect(rosters(r).h).toContain(get);
          accepted++;
        } else {
          expect(() => makeOffer(s, 'dev-h', { to: 'c1', give, get }, ALL, SCALE)).toThrow(/lehnt/);
          declined++;
        }
      }
    }
    expect(declined).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThan(0);
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
    // Transfer-Wunsch per Nachricht; ungültig → bad_transfer
    const free = freeAgents(room.stored!.state, ALL)[0].id;
    await room.send(host, { type: 'transfer', in: free, out: rosterOf(me)[0] });
    expect(room.stored!.state.manager!.claims![me.id]).toEqual({ in: free, out: rosterOf(me)[0] });
    await room.send(host, { type: 'transfer', in: free, out: foreign });
    expect(host.lastError?.code).toBe('bad_transfer');

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
    // Abschluss des menschlichen Teams für die Erfolge gespeichert
    const rows = db.query<{ device_id: string; format: string; rank: number; teams: number }>('SELECT * FROM draft_results');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ device_id: dev.deviceId, format: 'manager', teams: 18 });
    expect(end.league!.table.findIndex((r) => r.team === end.teams.findIndex((t) => !t.cpu)) + 1).toBe(rows[0].rank);
  });
});

describe('Trikotnummern im Online-Draft', () => {
  it('eigene Nummern setzen: bereinigt, nur eigener Kader, für alle im Schnappschuss; leer = Vorgabe', () => {
    const s = startManagerSeason(drafted(), ALL, SCALE);
    const own = rosterOf(s.teams.find((t) => t.id === 'h')!);
    const other = rosterOf(s.teams.find((t) => t.id === 'c1')!);
    const next = setTeamJerseys(s, 'dev-h', { [own[0]]: 7, [own[1]]: 7, [own[2]]: 150, [other[0]]: 9 });
    // Doppelte 7: genau eine bleibt (kleinere ID – Schlüssel laufen numerisch aufsteigend); 150 und fremde fallen weg
    const keep = String(Math.min(own[0], own[1]));
    expect(next.teams.find((t) => t.id === 'h')!.jerseys).toEqual({ [keep]: 7 });
    expect(snapshotOf(next, 'c1', 0).teams.find((t) => t.id === 'h')!.jerseys).toEqual({ [keep]: 7 });
    expect(setTeamJerseys(next, 'dev-h', {}).teams.find((t) => t.id === 'h')).not.toHaveProperty('jerseys');
    expect(() => setTeamJerseys(s, 'fremd', { [own[0]]: 7 })).toThrow(/nicht dabei/);
  });

  it('Nachricht jerseys: nur ein Objekt mit Zahlen', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'jerseys', jerseys: { '6': 9 } }))).toMatchObject({ ok: true });
    expect(parseClientMessage(JSON.stringify({ type: 'jerseys', jerseys: { '6': '9' } })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'jerseys', jerseys: [9] })).ok).toBe(false);
  });
});

