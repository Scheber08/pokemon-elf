/**
 * Übersetzung des Drafts: lokaler Hot-Seat-Draft (/draft – Aufbau, Draft, Liga), Liga-Einstellungen,
 * Draft-Board, Ergebnis der Online-Liga, Saison-Ticker und die Texte aus leagueTimeline
 * (Titelentscheidung, Teilen-Text). Mit Englisch darf kein Deutsch mehr erscheinen – weder als Text
 * noch in aria-label/title/alt/placeholder. Deutsch bleibt unverändert.
 * Gerendert wird mit react-dom/client auf dem Mini-DOM (tests/miniDom.ts).
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftSnapshot } from '../src/lib/api/draftContract';
import type { DraftState } from '../src/lib/draftEngine';
import type { DraftRoom } from '../src/state/useDraftRoom';
import { ALL } from './helpers';
import { installMiniDom, MiniElement, type MiniNode } from './miniDom';

const doc = installMiniDom();
// <select> (Formation im Aufbau): React wählt die Option über select.options – das Mini-DOM kennt
// das nicht, daher hier nachgerüstet (Wert = value-Attribut bzw. Text der Option).
Object.defineProperty(MiniElement.prototype, 'options', {
  configurable: true,
  get(this: MiniElement) {
    if (this.localName !== 'select') return undefined;
    return this.querySelectorAll('option').map((o) => {
      if (o.value == null) o.value = o.getAttribute('value') ?? o.textContent;
      return o;
    });
  },
});
// React-DOM und alles mit UI erst nach dem Mini-DOM laden
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { Draft } = await import('../src/pages/Draft');
const { DraftSeasonStage } = await import('../src/components/DraftSeasonStage');
const { LeagueTicker } = await import('../src/components/LeagueTicker');
const { DraftBoard, DraftPickFeed, DraftTeamTags } = await import('../src/components/DraftBoard');
const { DraftSettingsForm, DraftSettingsSummary, DraftTeamFields } = await import('../src/components/DraftSettingsForm');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { setCurrentLang } = await import('../src/i18n/lang');
const { messages } = await import('../src/i18n');
const { CLUB_NAMES } = await import('../src/config/season');
const { FORMATION_IDS } = await import('../src/config/formations');
const { emptySlots } = await import('../src/lib/formation');
const { buildScale } = await import('../src/lib/fit');
const engine = await import('../src/lib/draftEngine');
const timeline = await import('../src/lib/leagueTimeline');

const { act, createElement: h } = React;
const SCALE = buildScale(ALL, 'all');
const byId = new Map(ALL.map((p) => [p.id, p]));

/** Deutsche Wörter und Umlaute, die in der englischen Oberfläche nicht vorkommen dürfen */
const GERMAN =
  /[äöüÄÖÜß]|\b(und|der|die|das|den|dem|nicht|mit|ohne|für|bei|gegen|bis|pro|dein|Dein|Du|Spieltag|Spieltage|Tabelle|Meister|Tor|Tore|Pkt|Platz|Spielfrei|Anpfiff|Abpfiff|Sieg|Remis|Niederlage|Liga|Mannschaft|Wähle|wählen|Teamname|Liganame|Legendäre|Standardschütze|Standard|Zufällig|Aus|An|Privat|Kader|Aufstellung|Aufstellungen|Runde|Mensch|Torjäger|Ergebnis|Ergebnisse|Saison|Gemeinsame|Endstand|Paarungen|Bilanz|Punkte|Reihenfolge|Spielmodus|Gerät|Alle|Sp|Diff|Mein|Online-Draft|Online-Liga|Team-Score|Draft-Board|Draft-Liga|Fantasy-Draft|Draft-Reihenfolge|Pick-Timer|Hot-Seat|Einall|Glurak)\b/;

/** Gespeicherte Einstellungen vorgeben, so wie src/state/Settings.tsx sie liest */
function storeLang(lang: 'de' | 'en') {
  localStorage.setItem('pokemon-elf:settings', JSON.stringify({ lang }));
}

const mounted: (() => Promise<void>)[] = [];

async function render(el: ReactElement) {
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(el));
  const unmount = async () => {
    await act(async () => root.unmount());
    container.parentNode?.removeChild(container);
  };
  mounted.push(unmount);
  return { container, root };
}

/** Promises (fetch der Pokémon-Daten, Server-Check) und React-Updates abarbeiten */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Sichtbarer Text und Text-Attribute aller Elemente */
function texts(root: MiniNode): string[] {
  const out: string[] = [];
  const walk = (n: MiniNode) => {
    if (n.nodeType === 3) {
      const t = n.textContent.trim();
      if (t) out.push(t);
    }
    if (n.nodeType === 1) {
      const el = n as MiniElement;
      for (const a of ['aria-label', 'aria-valuetext', 'title', 'alt', 'placeholder']) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
      // Eingabefelder: Wert (z. B. Teamnamen im Aufbau) – React setzt ihn als Eigenschaft
      const value = el.value ?? el.getAttribute('value');
      if (el.localName === 'input' && typeof value === 'string' && value) out.push(value);
    }
    n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

/** Deutsche Vereinsnamen (CPU-Teams), die auf Englisch anders heißen */
const GERMAN_CLUBS = CLUB_NAMES.filter((c) => messages('en').game.club(c) !== c);

/** Deutsche Pokémon-Namen, die auf Englisch anders lauten */
const GERMAN_POKEMON = new Set(ALL.filter((p) => p.de !== p.en).map((p) => p.de));

const germanLeft = (root: MiniNode) =>
  texts(root).filter(
    (t) =>
      GERMAN.test(t) ||
      GERMAN_CLUBS.some((c) => t.includes(c)) ||
      t.split(/: | – | · | → |, /).some((part) => GERMAN_POKEMON.has(part.trim())),
  );

const app = (child: ReactElement) =>
  h(MemoryRouter, null, h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, child))));

/** Englischer Vereinsname zu einem (intern deutschen) CLUB_NAMES-Eintrag */
const clubEn = (name: string) => messages('en').game.club(name);

// ---------------------------------------------------------------- Online-Liga (Engine)

/** Drei Teams (ungerade → Spielfrei): Host + zwei CPU-Teams mit deutschen Vereinsnamen */
function finishedDraft(): DraftState {
  let s = engine.createDraft({
    code: 'K7MPQ2',
    seed: 42,
    settings: { region: 0, maxTeams: 4, order: 'host', pickSeconds: 0, legends: false, setPiece: false },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Rocket FC', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  s = engine.addCpuTeam(s, 'dev-h', 'cpu1');
  s = engine.addCpuTeam(s, 'dev-h', 'cpu2');
  s = engine.startDraft(s, 'dev-h', 0, ALL);
  while (s.phase === 'drafting') s = autoPick(s);
  return engine.withLeague(s, ALL, SCALE);
}

function autoPick(s: DraftState): DraftState {
  const team = engine.currentTeam(s)!;
  const c = engine.autoPickChoice(s, team.id, ALL, SCALE, false);
  return engine.applyPick(s, team.id, c.pokemonId, c.slot, true, 1000, ALL);
}

const snap = (s: DraftState, you: string | null = 'h'): DraftSnapshot => engine.snapshotOf(s, you, Date.now());

/** Schnappschuss aus Sicht eines Teams, das nicht Meister ist (kein Konfetti-Canvas im Mini-DOM) */
function runnerUpView(s: DraftState): DraftSnapshot {
  const champion = s.league!.table[0].team;
  const you = s.teams.find((_, i) => i !== champion)!.id;
  return snap(s, you);
}

/** Raum-Attrappe für DraftSeasonStage (nur, was die Komponente liest) */
function fakeRoom(s: DraftSnapshot): DraftRoom {
  return { state: s, me: s.teams.find((t) => t.id === s.you) ?? null, clockOffset: 0 } as unknown as DraftRoom;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('data/pokemon.json')
        ? new Response(JSON.stringify(ALL), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
  setCurrentLang('de');
});

// ---------------------------------------------------------------- Texte ohne React

describe('leagueTimeline-Texte auf Englisch', () => {
  const row = (team: number, pts: number, gd: number, gf: number, name = `T${team}`, rating = 70) => ({
    team,
    name,
    rating,
    isUser: false,
    played: 4,
    w: 0,
    d: 0,
    l: 0,
    gf,
    ga: gf - gd,
    gd,
    pts,
  });
  const nameOf = (t: number) => `T${t}`;

  it('Titelentscheidung und Teilen-Text folgen der aktiven Sprache', () => {
    setCurrentLang('en');
    const gd = timeline.titleTieNote(timeline.titleRace([row(0, 9, 5, 10), row(1, 9, 3, 10)]), nameOf);
    expect(gd).toBe('Level on points with T1 – decided on goal difference (+5 to +3)');
    const gf = timeline.titleTieNote(timeline.titleRace([row(0, 9, 3, 9), row(1, 9, 3, 7)]), nameOf);
    expect(gf).toBe('Level on points with T1 and the same goal difference – decided on goals scored (9 to 7)');
    const three = timeline.titleTieNote(
      timeline.titleRace([row(0, 9, 3, 9, 'A', 80), row(1, 9, 3, 9, 'B', 70), row(2, 9, 3, 9, 'C', 60)]),
      nameOf,
    );
    expect(three).toBe(
      'Level on points with T1 and T2, same goal difference and goals scored – decided on team score (80 to 70)',
    );
    const tiebreak = timeline.titleTieNote(timeline.titleRace([row(0, 3, 3, 3, 'Abra FC'), row(1, 3, 3, 3, 'Zapdos United')]), nameOf);
    expect(tiebreak).toBe(
      'Level on points with T1, same goal difference and goals scored – decided on team name (alphabetical)',
    );
    const text = timeline.draftShareText({
      code: 'K7MPQ2',
      championName: 'Abra FC',
      championPts: 3,
      tieNote: tiebreak,
      own: { name: 'Zapdos United', place: 2 },
      url: 'https://elf.example/draft/K7MPQ2',
    });
    expect(text).toBe(
      'Pokémon Elf – Online draft K7MPQ2: Abra FC won the league (3 pts) – level on points with T1, same goal difference and goals scored – decided on team name (alphabetical). My team Zapdos United finished 2nd.\nhttps://elf.example/draft/K7MPQ2',
    );
    for (const t of [gd, gf, three, tiebreak, text]) expect(t).not.toMatch(GERMAN);
    // Deutsch unverändert (TIEBREAK_LABEL bleibt die deutsche Fassung)
    setCurrentLang('de');
    expect(timeline.titleTieNote(timeline.titleRace([row(0, 9, 5, 10), row(1, 9, 3, 10)]), nameOf)).toBe(
      'Punktgleich mit T1 – entschieden nach Tordifferenz (+5 zu +3)',
    );
    expect(timeline.TIEBREAK_LABEL).toBe('dem Teamnamen (alphabetisch)');
  });

  it('englische Ordnungszahlen und Einzahl im Katalog', () => {
    const tx = messages('en').draft;
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map((n) => tx.placeNo(n))).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st',
    ]);
    expect(tx.pts(1)).toBe('1 pt');
    expect(tx.results.goalsAria(1)).toBe('1 goal');
    expect(tx.ticker.trend(2, false)).toBe('(down 2 places)');
  });
});

// ---------------------------------------------------------------- Lokaler Draft (/draft)

describe('/draft an einem Gerät auf Englisch', () => {
  it('Aufbau: Teams, Pool, Modus-Umschalter', async () => {
    storeLang('en');
    const { container } = await render(app(h(Draft)));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Fantasy Draft');
    expect(all).toContain('One device');
    expect(all).toContain('Number of teams');
    expect(all).toContain('My Team');
    expect(all).toContain('Draft from all 1,025 Pokémon, without legendaries.');
    expect(all).toContain('Start draft');
    expect(all).toContain('Unova');
    expect(germanLeft(container)).toEqual([]);
  });

  it('Draft läuft: Statuszeile, Board, Hinweis', async () => {
    storeLang('en');
    const teams = [
      { name: 'Mein Team', cpu: false, formation: FORMATION_IDS[0], slots: emptySlots(FORMATION_IDS[0]) },
      { name: CLUB_NAMES[0], cpu: true, formation: FORMATION_IDS[1], slots: emptySlots(FORMATION_IDS[1]) },
    ];
    localStorage.setItem(
      'pokemon-elf:draft',
      JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 0, selected: null, seed: null }),
    );
    const { container } = await render(app(h(Draft)));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Round');
    expect(all).toContain('On the clock:');
    expect(all).toContain('Pick a Pokémon');
    expect(all).toContain('My Team, you’re up.');
    expect(all).toContain(clubEn(CLUB_NAMES[0]));
    expect(all).toContain('Cancel draft');
    expect(germanLeft(container)).toEqual([]);
  });

  it('Liga: Tabelle, Torjäger, Spiele, Kader', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2].map((i) => {
      const formation = FORMATION_IDS[i];
      return {
        name: i === 0 ? 'Mein Team' : CLUB_NAMES[i],
        cpu: i !== 0,
        formation,
        slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id),
      };
    });
    localStorage.setItem(
      'pokemon-elf:draft',
      JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 33, selected: null, seed: 7 }),
    );
    const { container } = await render(app(h(Draft)));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Draft league');
    expect(all).toContain('Everyone plays everyone, home and away – 6 matches.');
    expect(all).toContain('Top scorers');
    expect(all).toContain('My Team');
    expect(all).toContain(clubEn(CLUB_NAMES[1]));
    expect(all).toContain('Replay league');
    expect(all).toContain('Pts');
    expect(germanLeft(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------- Online-Liga: Einstellungen, Board, Ergebnis, Ticker

describe('Online-Draft-Bausteine auf Englisch', () => {
  it('Einstellungen, Kurzfassung und Teamfelder', async () => {
    storeLang('en');
    const s = snap(finishedDraft());
    const { container } = await render(
      app(
        h(
          'div',
          null,
          h(DraftSettingsForm, { value: { ...s.settings, region: 5 }, onChange: () => {}, list: ALL, teamsJoined: 3 }),
          h(DraftSettingsSummary, { settings: { ...s.settings, region: 5, pickSeconds: 60, visibility: 'public' } }),
          h(DraftTeamFields, { name: '', formation: '4-3-3', onName: () => {}, onFormation: () => {} }),
        ),
      ),
    );
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('League name');
    expect(all).toContain('e.g. Monday League');
    expect(all).toContain('Set-piece taker');
    expect(all).toContain('Pick timer');
    expect(all).toContain('Pool: Unova');
    expect(all).toContain('60 s per pick');
    expect(all).toContain('Team name');
    expect(germanLeft(container)).toEqual([]);
  });

  it('Draft-Board, Marker und Verlauf', async () => {
    storeLang('en');
    let st = engine.createDraft({
      code: 'ABC234',
      seed: 1,
      settings: { region: 0, maxTeams: 4, order: 'host', pickSeconds: 0 },
      host: { teamId: 'h', deviceId: 'dev-h', name: 'Rocket FC', formation: '4-3-3' },
      now: 0,
      list: ALL,
    });
    st = engine.addCpuTeam(st, 'dev-h', 'cpu1');
    st = autoPick(engine.startDraft(st, 'dev-h', 0, ALL));
    const s = snap(st);
    const cpu = s.teams.find((t) => t.cpu)!;
    const { container } = await render(
      app(
        h(
          'div',
          null,
          h(DraftBoard, { state: s, byId, currentId: s.teams[1].id }),
          h(DraftTeamTags, { team: s.teams[0], host: true, you: true }),
          h(DraftPickFeed, {
            items: [{ key: 'k', no: 1, pokemon: 'Snorlax', team: 'Rocket FC', teamId: 'h', auto: true }],
            you: 'h',
          }),
        ),
      ),
    );
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Draft board');
    expect(all).toContain('You');
    expect(all).toContain('Recent picks');
    expect(all).toContain(clubEn(cpu.name));
    expect(germanLeft(container)).toEqual([]);
  });

  it('Ergebnis (Saison vorbei): Meister, Tabelle, Torjäger, Spieltage', async () => {
    storeLang('en');
    const s = runnerUpView(finishedDraft());
    s.season = { ...s.season!, startsAt: Date.now() - 10 * 24 * 3600 * 1000 };
    const { container } = await render(app(h(DraftSeasonStage, { room: fakeRoom(s) })));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Online draft K7MPQ2');
    expect(all).toContain('Champions: ');
    expect(all).toContain('Final table');
    expect(all).toContain('Top scorers');
    expect(all).toContain('Line-ups');
    expect(all).toContain('All matchdays');
    expect(all).toContain('Matchday 1');
    expect(all).toMatch(/Bye: /);
    expect(all).toContain('Share result');
    expect(all).toContain('New league');
    expect(all).toContain(clubEn(s.teams[1].name));
    // Platz der Aufstellungen als englische Ordnungszahl
    expect(container.querySelectorAll('.draft-results__place').map((e) => e.textContent).slice(0, 3)).toEqual([
      '1st',
      '2nd',
      '3rd',
    ]);
    expect(germanLeft(container)).toEqual([]);
  });

  it('Ticker: Countdown, laufender Spieltag und Abpfiff', async () => {
    storeLang('en');
    const s = snap(finishedDraft());
    const league = s.league!;
    const names = s.teams.map((t) => (t.cpu ? clubEn(t.name) : t.name));
    const total = timeline.matchdayCount(league);
    const step = 60_000;
    const cases = [
      { startsAt: Date.now() + 5_000, expect: ['Kick-off in', 'Fixtures', 'Matchday 1', 'Skip'] },
      { startsAt: Date.now() - 1.5 * step, expect: ['Matchday 2', 'Results', 'Table after matchday 2', 'Position'] },
      { startsAt: Date.now() - (total - 1) * step - 100, expect: ['Full time!', 'Final scores', 'See result', 'Champions: '] },
    ];
    for (const c of cases) {
      const { container } = await render(
        app(
          h(LeagueTicker, {
            league,
            teamNames: names,
            highlight: 0,
            startsAt: c.startsAt,
            stepMs: step,
            clockOffset: 0,
            onDone: () => {},
          }),
        ),
      );
      await settle();
      const all = texts(container).join(' | ');
      for (const e of c.expect) expect(all).toContain(e);
      expect(germanLeft(container)).toEqual([]);
    }
  });
});

describe('Deutsch bleibt unverändert', () => {
  it('Ergebnis und Ticker auf Deutsch', async () => {
    storeLang('de');
    const s = runnerUpView(finishedDraft());
    s.season = { ...s.season!, startsAt: Date.now() - 10 * 24 * 3600 * 1000 };
    const { container } = await render(app(h(DraftSeasonStage, { room: fakeRoom(s) })));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Online-Draft K7MPQ2');
    expect(all).toContain('Abschlusstabelle');
    expect(all).toContain('Alle Spieltage');
    expect(all).toContain('1. Spieltag');
    expect(all).toMatch(/Spielfrei: /);
    expect(all).toContain(s.teams[1].name);
    expect(container.querySelectorAll('.draft-results__place').map((e) => e.textContent).slice(0, 2)).toEqual(['1.', '2.']);
    // Gegenprobe: Die Deutsch-Erkennung schlägt hier an (Wörter, Vereins- und Pokémon-Namen)
    const flagged = germanLeft(container);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.some((t) => CLUB_NAMES.some((c) => t.includes(c)))).toBe(true);
    expect(flagged.some((t) => GERMAN_POKEMON.has(t))).toBe(true);

    const league = s.league!;
    const { container: ticker } = await render(
      app(
        h(LeagueTicker, {
          league,
          teamNames: s.teams.map((t) => t.name),
          highlight: 0,
          startsAt: Date.now() - 90_000,
          stepMs: 60_000,
          clockOffset: 0,
          onDone: () => {},
        }),
      ),
    );
    await settle();
    const tick = texts(ticker).join(' | ');
    expect(tick).toContain('Tabelle nach dem 2. Spieltag');
    expect(tick).toContain('Gemeinsame Saison');
    expect(tick).toContain('Alle sehen dieselbe Saison gleichzeitig. Überspringen gilt nur für dich.');
  });
});
