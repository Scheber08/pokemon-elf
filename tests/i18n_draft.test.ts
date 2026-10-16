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
/** Zeilen der Haupttabelle der lokalen Liga (die Zeitreise hat eine eigene Tabelle) */
const mainRows = (root: MiniElement) =>
  (root.querySelectorAll('section').find((x) => x.getAttribute('aria-labelledby') === 'draft-table') as MiniElement).querySelectorAll('tbody tr');

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

/** Drei Teams: Host + zwei CPU-Teams mit deutschen Vereinsnamen – die Saison füllt mit Vereinen auf 18 auf */
function finishedDraft(format: 'league' | 'cup' = 'league', cupGroups = false): DraftState {
  let s = engine.createDraft({
    code: 'K7MPQ2',
    seed: 42,
    settings: { region: 0, maxTeams: 4, order: 'host', pickSeconds: 0, legends: false, setPiece: false, format, cupGroups },
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
    // CPU-Stärke: Standard „Normal“, „Hard“ wird gemerkt
    expect(all).toContain('CPU strength');
    const hard = container.querySelectorAll('[role="radio"]').find((b) => b.textContent === 'Hard') as MiniElement;
    expect(container.querySelectorAll('[role="radio"]').find((b) => b.textContent === 'Normal')!.getAttribute('aria-checked')).toBe('true');
    await act(async () => hard.click());
    expect(hard.getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).cpuLevel).toBe('hard');
  });

  it('Aufbau: 🎲 setzt einen freien Vereinsnamen (gespeichert deutsch)', async () => {
    storeLang('en');
    localStorage.removeItem('pokemon-elf:draft');
    const { container } = await render(app(h(Draft)));
    await settle();
    const dice = container.querySelectorAll('.draft__teamrow .random-name');
    expect(dice.length).toBeGreaterThanOrEqual(2);
    await act(async () => (dice[0] as MiniElement).click());
    const teams = JSON.parse(localStorage.getItem('pokemon-elf:draft')!).teams as { name: string }[];
    expect(CLUB_NAMES).toContain(teams[0].name);
    expect(new Set(teams.map((t) => t.name)).size).toBe(teams.length);
  });

  it('Aufbau: neue CPU-Teams und 🎲 nehmen Namen aus den Online-Ranglisten', async () => {
    const pool = ['Team Rocket', 'Ashs Elf', 'Misty United', 'Rocko 1899', 'Gary Galaxy', 'Elite Vier', 'Lucia Stars', 'Kanto Kicker'];
    localStorage.setItem('pokemon-elf:ranking-names', JSON.stringify({ at: Date.now(), names: pool }));
    localStorage.removeItem('pokemon-elf:draft');
    const { container } = await render(app(h(Draft)));
    await settle();
    const group = container.querySelector('section[aria-labelledby="draft-teams"]')!.querySelector('[role="radiogroup"]')!;
    await act(async () => (group.querySelectorAll('[role="radio"]').find((r) => r.textContent === '6') as MiniElement).click());
    let teams = JSON.parse(localStorage.getItem('pokemon-elf:draft')!).teams as { name: string; cpu: boolean }[];
    expect(teams).toHaveLength(6);
    // Alle neuen CPU-Teams (ab Platz 5) heißen wie Ranglisten-Teams, keiner doppelt
    expect(teams.slice(4).every((tm) => pool.includes(tm.name))).toBe(true);
    expect(new Set(teams.map((tm) => tm.name)).size).toBe(6);
    const dice = container.querySelectorAll('.draft__teamrow .random-name');
    await act(async () => (dice[1] as MiniElement).click());
    teams = JSON.parse(localStorage.getItem('pokemon-elf:draft')!).teams;
    expect(pool).toContain(teams[1].name);
    expect(new Set(teams.map((tm) => tm.name)).size).toBe(6);
    localStorage.removeItem('pokemon-elf:ranking-names');
  });

  it('Aufbau: „Shuffle order“ mischt die Teamliste (= Draft-Reihenfolge)', async () => {
    storeLang('en');
    const { container } = await render(app(h(Draft)));
    await settle();
    const names = () => container.querySelectorAll('.draft__teamrow input').map((i) => (i as MiniElement).value as string);
    const before = names();
    expect(before.length).toBeGreaterThanOrEqual(2);
    const btn = container.querySelectorAll('button').find((b) => b.textContent === '🎲 Shuffle order') as MiniElement;
    // Math.random = 0: jeder Schritt tauscht mit dem ersten Element → Rotation nach links
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    await act(async () => btn.click());
    rnd.mockRestore();
    expect(names()).toEqual([...before.slice(1), before[0]]);
    // Gespeichert: das bisher erste Team (eigenes) steht jetzt hinten
    const stored = JSON.parse(localStorage.getItem('pokemon-elf:draft')!).teams;
    expect(stored[stored.length - 1].name).toBe('Mein Team');
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
    // Noch offene Positionen (noch kein Pick: alle elf)
    expect(container.querySelectorAll('.hint').map((e) => e.textContent).find((x) => x?.includes('you’re up'))).toMatch(/Still open: .+\.$/);
    expect(all).toContain(clubEn(CLUB_NAMES[0]));
    // Vorschau der nächsten Picks (Snake mit 2 Teams: CPU, CPU, ich)
    expect(container.querySelector('.draft__next')!.textContent).toBe(`Then: ${clubEn(CLUB_NAMES[0])} → ${clubEn(CLUB_NAMES[0])} → My Team`);
    // Board: das nächste Team ist gestrichelt markiert
    expect(container.querySelectorAll('.draft__board .draft__col').map((c) => c.className.includes('is-next'))).toEqual([false, true]);
    // Bedarf des nächsten Teams (CPU, noch kein Pick: alle Positionen seiner Formation)
    expect(container.querySelector('.draft__needs')!.textContent).toMatch(new RegExp(`^${clubEn(CLUB_NAMES[0])} still needs: .+$`));
    // Beste Freie: ein Chip je verschiedener Position der Formation, Klick wählt das Pokémon aus
    const { FORMATIONS } = await import('../src/config/formations');
    const chips = container.querySelectorAll('.draft__bestfree button');
    expect(chips).toHaveLength(new Set(FORMATIONS[FORMATION_IDS[0]].slots.map((d) => d.pos)).size);
    expect(container.querySelector('.draft__bestfree')!.textContent).toContain('Best available:');
    await act(async () => (chips[0] as MiniElement).click());
    const sel = JSON.parse(localStorage.getItem('pokemon-elf:draft')!).selected;
    expect(typeof sel).toBe('number');
    expect(container.querySelectorAll('.draft__bestfree button')[0].className).toContain('is-active');
    expect(all).toContain('Cancel draft');
    // „Suggest“ wählt ein Pokémon aus (Hinweis zeigt es fett)
    const btn = container.querySelectorAll('.draft-pooltools button').find((b) => b.textContent === 'Suggest') as MiniElement;
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('V');
    // Taste V wirkt wie der Knopf
    const { MiniEvent } = await import('./miniDom');
    const ev = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key: 'v', ctrlKey: false, metaKey: false, altKey: false });
    await act(async () => void window.dispatchEvent(ev as unknown as Event));
    expect(container.querySelectorAll('.hint strong')).toHaveLength(1);
    // Nochmal per Knopf (wählt dasselbe – bleibt ausgewählt)
    await act(async () => btn.click());
    const chosen = container.querySelectorAll('.hint strong').map((e) => e.textContent);
    expect(chosen.length).toBe(1);
    expect(ALL.some((p) => p.en === chosen[0] && p.gen === 1)).toBe(true);
    // Erster Pick von zwei Teams: kein Doppelpick (danach ist das andere Team dran)
    expect(container.querySelector('.draft-double')).toBeNull();
    // „🎲 Random“: erstes bzw. letztes freies Pokémon des Pools (Kanto, nach Nummer)
    const rnd = container.querySelectorAll('.draft-pooltools button').find((b) => b.textContent === '🎲 Random') as MiniElement;
    const kantoFree = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    for (const [r, want] of [[0, kantoFree[0]], [0.9999, kantoFree.at(-1)!]] as const) {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      await act(async () => rnd.click());
      vi.restoreAllMocks();
      expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).selected).toBe(want.id);
    }
    // Taste R wirkt wie „🎲 Random“
    expect(rnd.getAttribute('aria-keyshortcuts')).toBe('R');
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const evR = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key: 'R', ctrlKey: false, metaKey: false, altKey: false });
    await act(async () => void window.dispatchEvent(evR as unknown as Event));
    vi.restoreAllMocks();
    expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).selected).toBe(kantoFree[Math.floor(0.5 * kantoFree.length)].id);
    // Noch keine Picks: kein Ø Fit auf dem Board
    expect(container.querySelector('.draft__board .draft-board__fit')).toBeNull();
    expect(germanLeft(container)).toEqual([]);
    // „Pick automatically …“: sofortiger Pick für das eigene Team
    const auto = container.querySelectorAll('.draft-pooltools button').find((b) => b.textContent === 'Pick automatically for My Team') as MiniElement;
    await act(async () => auto.click());
    const saved = JSON.parse(localStorage.getItem('pokemon-elf:draft')!);
    expect(saved.pick).toBe(1);
    expect(saved.teams[0].slots.filter((x: number | null) => x != null)).toHaveLength(1);
  });

  it('Kapitänswahl lokal: Favorit nach Team-Score und Rang der menschlichen Teams', async () => {
    const total = (p: (typeof ALL)[number]) => p.hp + p.atk + p.def + p.spa + p.spd + p.spe;
    const pool = ALL.filter((p) => !p.leg && !p.myth && !p.form).sort((a, b) => total(b) - total(a));
    const f = FORMATION_IDS[0];
    const team = (name: string, cpu: boolean, mons: typeof pool) => ({ name, cpu, formation: f, slots: emptySlots(f).map((_, j) => mons[j].id) });
    const teams = [
      team('Mein Team', false, pool.slice(0, 11)),
      team(CLUB_NAMES[1], true, pool.slice(200, 211)),
      team('Zweites Team', false, pool.slice(-11)),
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'captains', teams, region: 0, legends: false, pick: 33, selected: null, seed: 5 }));
    const { container } = await render(app(h(Draft)));
    await settle();
    expect(container.querySelector('.draft__odds')!.textContent).toMatch(
      /^Favorit: Mein Team \(Team-Score \d+\) · Team-Score-Platz – Mein Team: 1\., Zweites Team: 3\.$/,
    );
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('Lokale Liga: Konfetti nur, wenn ein menschliches Team Meister wird', async () => {
    const total = (p: (typeof ALL)[number]) => p.hp + p.atk + p.def + p.spa + p.spd + p.spe;
    const pool = ALL.filter((p) => !p.leg && !p.myth && !p.form).sort((a, b) => total(b) - total(a));
    const strong = pool.slice(0, 11);
    const weak = pool.slice(-33);
    const mk = (humanStrong: boolean) =>
      [0, 1, 2, 3].map((i) => {
        const formation = FORMATION_IDS[0];
        const mons = i === 0 ? (humanStrong ? strong : weak.slice(0, 11)) : i === 1 && !humanStrong ? strong : weak.slice((i % 3) * 11, (i % 3) * 11 + 11);
        return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => mons[j].id) };
      });
    for (const humanStrong of [true, false]) {
      localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams: mk(humanStrong), region: 0, legends: false, pick: 44, selected: null, seed: 7 }));
      const { container, root } = await render(app(h(Draft)));
      await settle();
      const champ = container.querySelector('.draft__champion strong')!.textContent;
      expect(champ).toBe(humanStrong ? 'Mein Team' : CLUB_NAMES[1]);
      expect(doc.body.querySelectorAll('canvas').filter((c) => c.className === 'confetti')).toHaveLength(humanStrong ? 1 : 0);
      // „Ergebnis teilen“: ohne Teilen-Menü in die Zwischenablage (Hinweis als Toast)
      if (humanStrong) {
        const writes: string[] = [];
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (s: string) => void writes.push(s) }, configurable: true });
        const shareBtn = container.querySelector('.draft__share') as MiniElement;
        await act(async () => shareBtn.click());
        await settle();
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatch(/^Pokémon Elf – Fantasy-Draft an einem Gerät: Meister Mein Team \(\d+ Pkt\)\. Mein Team: Platz 1\.\n.+\/draft$/);
        expect(container.querySelector('.toast')?.textContent ?? doc.body.querySelector('.toast')?.textContent).toBe('Ergebnis kopiert');
      }
      await act(async () => root.unmount());
    }
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('Liga mit 6 Teams: Meister grün markiert, unten keine rote Zone, Legende nur „Champions“', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2, 3, 4, 5].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 66, selected: null, seed: 7 }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const rows = mainRows(container);
    expect(rows).toHaveLength(6);
    expect(rows[0].className).toContain('is-zone-top');
    expect(rows.some((r) => r.className.includes('is-zone-bottom'))).toBe(false);
    expect(container.querySelector('.table-legend')!.textContent).toBe('Champions');
  });

  it('Liga: Saisonrekorde mit bestem Angriff, bester Abwehr und höchstem Sieg', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2, 3, 4, 5].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 66, selected: null, seed: 7 }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const section = container.querySelectorAll('section').find((s) => s.getAttribute('aria-labelledby') === 'draft-local-records') as MiniElement;
    expect(section).toBeTruthy();
    const rows = section.querySelectorAll('dt').map((dt, k) => [dt.textContent, section.querySelectorAll('dd')[k].textContent]);
    const labels = rows.map((r) => r[0]);
    expect(labels.slice(0, 2)).toEqual(['Best attack', 'Best defence']);
    expect(labels).toContain('Biggest win');
    // Doppelte Runde mit 6 Teams (10 Spieltage): Herbstmeister nach Spieltag 5 und Rückrunden-Bester
    expect(labels).toContain('Half-season champions');
    expect(labels).toContain('Best team of the second half');
    expect(rows.find((r) => r[0] === 'Half-season champions')![1]).toMatch(/after the first half \(matchday 5\)$/);
    // Hattricks: Anzahl und Spieltag des ersten (in dieser Liga gibt es welche)
    const hat = rows.find((r) => r[0] === 'Hat-tricks');
    expect(hat).toBeTruthy();
    expect(hat![1]).toMatch(/^\d+ – (first )?.+ \(.+\) on matchday \d+$/);
    // Weiße Weste (ab 3 Spielen ohne Gegentor)
    const clean = rows.find((r) => r[0] === 'Clean-sheet kings')!;
    expect(clean[1]).toMatch(/ – \d+ clean sheets$/);
    expect(Number(clean[1]!.match(/(\d+) clean sheets$/)![1])).toBeGreaterThanOrEqual(3);
    // Größtes Comeback (nur wenn es eins gab – der positive Fall steht im Online-Test)
    const back = rows.find((r) => r[0] === 'Biggest comeback');
    if (back) expect(back[1]).toMatch(/^.+ – from \d+:\d+ down to a \d+:\d+ win against .+ \(matchday \d+\)$/);
    const goals = Math.max(...mainRows(container).map((r) => Number(r.querySelectorAll('td')[8].textContent!.split(':')[0])));
    expect(rows[0][1]).toContain(`${goals} goals`);
    expect(section.textContent).not.toContain('Mein Team');
  });

  it('Liga: Zeitreise zeigt die Tabelle nach jedem Spieltag', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2, 3].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 44, selected: null, seed: 7 }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const section = container.querySelectorAll('section').find((s) => s.getAttribute('aria-labelledby') === 'draft-local-timetravel') as MiniElement;
    expect(section).toBeTruthy();
    expect(section.querySelector('label')!.textContent).toBe('Table after matchday 6 (of 6)');
    const played = () => section.querySelectorAll('tbody tr').map((r) => r.querySelectorAll('td')[2].textContent);
    expect(played()).toEqual(['6', '6', '6', '6']);
    expect(section.querySelectorAll('tbody tr').filter((r) => r.className.includes('is-user'))).toHaveLength(1);
    const range = section.querySelector('input') as MiniElement;
    await act(async () => {
      // Schieberegler-Ereignisse erreichen React im Mini-DOM nicht – onChange direkt aufrufen
      range.value = '1';
      const k = Object.keys(range).find((x) => x.startsWith('__reactProps'))!;
      (range as unknown as Record<string, { onChange: (e: unknown) => void }>)[k].onChange({ target: range });
    });
    expect(section.querySelector('label')!.textContent).toBe('Table after matchday 1 (of 6)');
    expect(played()).toEqual(['1', '1', '1', '1']);
  });

  it('Liga: Revanche – gleiche Teams und Einstellungen, leere Kader, zurück zum Aufbau', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id), captain: i === 0 ? pool[0].id : undefined };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: true, pick: 33, selected: null, seed: 7 }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const btn = container.querySelectorAll('button').find((b) => b.textContent === 'Rematch') as MiniElement;
    await act(async () => btn.click());
    await settle();
    const saved = JSON.parse(localStorage.getItem('pokemon-elf:draft')!);
    expect(saved.phase).toBe('setup');
    expect(saved.legends).toBe(true);
    expect(saved.teams.map((t: { name: string; cpu: boolean; formation: string }) => [t.name, t.cpu, t.formation])).toEqual(teams.map((t) => [t.name, t.cpu, t.formation]));
    expect(saved.teams.every((t: { slots: (number | null)[]; captain: unknown }) => t.slots.every((x) => x == null) && t.captain == null)).toBe(true);
    // Aufbau zeigt die Teams wieder
    expect(container.querySelectorAll('.draft__teamrow')).toHaveLength(3);
  });

  it('Liga: Titelsammlung zählt Meister je Seed einmal, ab zwei Ligen sichtbar', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.removeItem('pokemon-elf:draft-champions');
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 33, selected: null, seed: 7 }));
    let r = await render(app(h(Draft)));
    await settle();
    const first = JSON.parse(localStorage.getItem('pokemon-elf:draft-champions')!);
    expect(first).toHaveLength(1);
    // Eine Liga allein: noch keine Karte
    expect(r.container.querySelectorAll('section').some((x) => x.getAttribute('aria-labelledby') === 'draft-local-titles')).toBe(false);
    // Gleicher Seed erneut: kein zweiter Eintrag
    r = await render(app(h(Draft)));
    await settle();
    expect(JSON.parse(localStorage.getItem('pokemon-elf:draft-champions')!)).toHaveLength(1);
    // Zweite Liga (anderer Seed) → Karte mit zwei Titeln insgesamt
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 33, selected: null, seed: 8 }));
    r = await render(app(h(Draft)));
    await settle();
    const all = JSON.parse(localStorage.getItem('pokemon-elf:draft-champions')!) as { name: string }[];
    expect(all).toHaveLength(2);
    const card = r.container.querySelectorAll('section').find((x) => x.getAttribute('aria-labelledby') === 'draft-local-titles') as MiniElement;
    expect(card.textContent).toContain('Trophy cabinet');
    expect(card.textContent).toContain('Champions of 2 local leagues');
    const total = card.querySelectorAll('li strong').reduce((sum, x) => sum + Number(x.textContent!.match(/\d+/)![0]), 0);
    expect(total).toBe(2);
    localStorage.removeItem('pokemon-elf:draft-champions');
  });

  it('Liga: Saisonstatistik (Vorlagen, Scorer, Teams) im Draft-Spielmodell', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2, 3].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 44, selected: null, seed: 7, model: 'draft' }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const card = container.querySelectorAll('section').find((x) => x.getAttribute('aria-labelledby') === 'season-stats-title') as MiniElement;
    expect(card).toBeTruthy();
    const tabs = card.querySelectorAll('[role="radio"], [role="tab"], button').map((b) => b.textContent);
    expect(tabs.some((x) => /Assists/i.test(x ?? ''))).toBe(true);
    expect(tabs.some((x) => /Goals/.test(x ?? '') && !/Assists/.test(x ?? ''))).toBe(false);
  });

  it('Lokaler Draft: „Recent picks“ mit Position, Fit und ★', async () => {
    storeLang('en');
    const empty = Array(11).fill(null);
    // Team 0 (4-3-3): Mewtu im Tor, Bisasam auf Platz 2; Team 1 (4-4-2): Glumanda im Tor
    const teams = [
      { name: 'Mein Team', cpu: false, formation: '4-3-3', slots: [150, 1, ...empty.slice(2)] },
      { name: 'Zweites Team', cpu: false, formation: '4-4-2', slots: [4, ...empty.slice(1)] },
    ];
    const log = [
      { team: 0, slot: 0, id: 150 },
      { team: 1, slot: 0, id: 4 },
      { team: 0, slot: 1, id: 1 },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: true, pick: 3, selected: null, seed: null, log }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const items = container.querySelectorAll('.draft-feed li');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/^#3Bulbasaur → My Team/);
    expect(items[2].textContent).toMatch(/^#1Mewtwo ★Legendary\/mythical → My Team GK \d+/);
    expect(items[2].querySelector('.draft-feed__kind')).toBeTruthy();
    expect(items.filter((li) => li.querySelector('.draft-feed__kind'))).toHaveLength(1);
    // 🏅 genau einmal (bester Fit bisher)
    expect(container.querySelectorAll('.draft-feed__top')).toHaveLength(1);
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('Pick-Verlauf: Start legt ihn an, jeder Pick wird angehängt; Liga zeigt das Schnäppchen des Drafts', async () => {
    storeLang('en');
    localStorage.removeItem('pokemon-elf:draft');
    let r = await render(app(h(Draft)));
    await settle();
    // Setup: „Stars in the pool“ mit fünf Pokémon
    expect(r.container.querySelector('.pool-stars h2')!.textContent).toBe('⭐ Stars in the pool');
    expect(r.container.querySelectorAll('.pool-stars li')).toHaveLength(5);
    // Schnellstart-Vorlagen: setzen Region, Legendäre, Formen, Megas und Shiny-Party auf einmal
    {
      const chip = (label: string) => r.container.querySelectorAll('.draft-presets .chip').find((b) => b.textContent === label) as MiniElement;
      const saved = () => JSON.parse(localStorage.getItem('pokemon-elf:draft')!);
      await act(async () => chip('Mega chaos').click());
      expect(saved()).toMatchObject({ region: 0, legends: true, forms: true, megas: 2 });
      expect(saved().shinyParty).toBeUndefined();
      await act(async () => chip('Shiny party').click());
      expect(saved()).toMatchObject({ region: 0, legends: false, forms: false, megas: 0, shinyParty: true });
      await act(async () => chip('Classic').click());
      expect(saved()).toMatchObject({ region: 1, legends: false, forms: false, megas: 0 });
      expect(saved().shinyParty).toBeUndefined();
      expect(chip('Classic').getAttribute('title')).toBe('Kanto without legendaries, forms and Megas');
    }
    // Pick-Nummern der menschlichen Teams (Snake, Reihenfolge der Liste)
    {
      const n = r.container.querySelectorAll('.draft__teamrow').length;
      const rows = r.container.querySelectorAll('.draft__teampicks li');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].textContent).toBe(`My Team: picks 1, ${2 * n}, ${2 * n + 1}, ${4 * n} …`);
    }
    const start = r.container.querySelectorAll('button').find((b) => b.textContent === 'Start draft') as MiniElement;
    await act(async () => start.click());
    await settle();
    expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).log).toEqual([]);
    const auto = r.container.querySelectorAll('.draft-pooltools button').find((b) => /^Pick automatically for /.test(b.textContent ?? '')) as MiniElement;
    await act(async () => auto.click());
    const saved = JSON.parse(localStorage.getItem('pokemon-elf:draft')!);
    expect(saved.log).toHaveLength(saved.pick);
    expect(saved.log[0].team).toBe(0);
    expect(saved.teams[0].slots[saved.log[0].slot]).toBe(saved.log[0].id);

    // Fertige Liga mit vollständigem Verlauf (Snake, 3 Teams × 11 Runden)
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    // Ein Legendäres (Mewtu) für ★ in „Alle Picks“
    teams[1].slots[0] = 150;
    // Der stärkste Star des Pools geht an Team 2 (Runde 2) – für „Where did the stars go?“
    const { poolStars } = await import('../src/components/PoolStars');
    const stars = poolStars(ALL.filter((p) => !p.leg && !p.myth && !p.form), SCALE);
    teams[2].slots[1] = stars[0].pokemon.id;
    const log: { team: number; slot: number; id: number }[] = [];
    for (let k = 0; k < 33; k++) {
      const round = Math.floor(k / 3);
      const team = round % 2 === 0 ? k % 3 : 2 - (k % 3);
      log.push({ team, slot: round, id: teams[team].slots[round]! });
    }
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 33, selected: null, seed: 7, log }));
    r = await render(app(h(Draft)));
    await settle();
    const byIdAll = new Map(ALL.map((p) => [p.id, p]));
    const steal = timeline.draftSteal(
      log.map((x, i) => ({ pick: i, teamId: String(x.team), pokemonId: x.id, slot: x.slot })),
      teams.map((tm, i) => ({ id: String(i), formation: tm.formation })),
      byIdAll,
      SCALE,
    )!;
    expect(steal).toBeTruthy();
    const line = r.container.querySelector('.draft-results__steal')!.textContent!;
    expect(line).toMatch(new RegExp(`^Steal of the draft: .+ \\(pick ${steal.pick + 1}\\) for `));
    // Alle Picks: 33 Einträge in Draft-Reihenfolge, eigene markiert
    const list = r.container.querySelectorAll('.draft-results__picklist li');
    expect(r.container.querySelector('.draft-results__picks summary')!.textContent).toBe('All 33 picks');
    expect(list).toHaveLength(33);
    expect(list[0].textContent).toMatch(/^#1 · R1 .+ → My Team$/);
    expect(list[0].className).toContain('is-you');
    expect(list[1].className).not.toContain('is-you');
    // Stars: der erste mit Team 2 und Pick 4 (Snake: Runde 2 beginnt mit Team 2), die übrigen nicht gedraftet
    const starRows = r.container.querySelectorAll('.draft-results__stars li');
    expect(starRows).toHaveLength(5);
    expect(starRows[0].textContent).toBe(`${stars[0].pokemon.en}${clubEn(CLUB_NAMES[2])} · pick 4`);
    expect(starRows[0].className).not.toContain('is-you');
    for (const row of starRows.slice(1)) expect(row.textContent).toMatch(/not drafted$/);
    // 🏅 bester Pick jeder Runde: 11 Runden, je genau einer
    const bests = list.filter((li) => li.querySelector('.draft-results__roundbest'));
    expect(bests).toHaveLength(11);
    for (let rd = 1; rd <= 11; rd++) expect(bests.filter((li) => li.textContent!.includes(` · R${rd} `))).toHaveLength(1);
    expect(bests[0].querySelector('.draft-results__roundbest')!.textContent).toBe(' 🏅Best pick of the round (positional fit)');
    // 🃏 Joker of the draft (English, like draftJoker)
    {
      const joker = timeline.draftJoker(log.map((x, i) => ({ pick: i, team: x.team, pokemonId: x.id })), JSON.parse(localStorage.getItem('pokemon-elf:draft')!).league?.matches ?? []);
      const el = r.container.querySelector('.draft-results__joker');
      if (el) expect(el.textContent).toMatch(/^🃏 Joker of the draft: .+ \(only pick \d+\) scored \d+ for .+$/);
      if (joker) expect(el).not.toBeNull();
    }
    // Expectation vs. result under the human team's place (English)
    {
      const line = r.container.querySelector('.draft__you .draft__expect')!.textContent!;
      expect(line).toMatch(/^(📈 |📉 )Team score rank [\d–]+, finished in place \d+ – \d+ places? (better|worse)$|^🎯 As the team score suggested: place \d+/);
    }
    // Top-scoring types below the scorers (English)
    expect(r.container.querySelector('.type-goals')!.textContent).toMatch(/^Top-scoring types:/);
    expect(r.container.querySelectorAll('.type-goals__item').length).toBeGreaterThan(0);
    // 😬 Verpasste Chance (nur das menschliche Team; ein Mensch → ohne Teamnamen)
    {
      const missed = timeline.missedChance(
        log.map((x, i) => ({ pick: i, teamId: String(x.team), pokemonId: x.id, slot: x.slot })),
        teams.map((tm, i) => ({ id: String(i), formation: tm.formation })),
        '0',
        ALL.filter((p) => !p.leg && !p.myth && !p.form),
        SCALE,
      )!;
      expect(missed).toBeTruthy();
      const rows = r.container.querySelectorAll('.draft__missed .draft-results__missed');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toMatch(new RegExp(`^😬 Missed chance: pick ${missed.pick + 1} .+ \\(fit ${missed.fit}\\) – .+ \\(fit ${missed.altFit}\\) was still free at \\S+ – `));
    }
    // ★ hinter Mewtu (und nur dort)
    const marked = list.filter((li) => li.querySelector('.draft-feed__kind'));
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toMatch(/^#\d+ · R1 Mewtwo ★Legendary\/mythical → /);
  });

  it('CPU am Zug: „Faster until the next turn“ verkürzt die Bedenkzeit bis zum eigenen Zug', async () => {
    storeLang('en');
    const f0 = FORMATION_IDS[0];
    const f1 = FORMATION_IDS[1];
    // Snake mit 3 Teams: Pick 1 und 2 CPU, Pick 3 ich
    const teams = [
      { name: CLUB_NAMES[0], cpu: true, formation: f1, slots: emptySlots(f1) },
      { name: CLUB_NAMES[1], cpu: true, formation: f1, slots: emptySlots(f1) },
      { name: 'Mein Team', cpu: false, formation: f0, slots: emptySlots(f0) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 0, selected: null, seed: null, log: [] }));
    vi.useFakeTimers();
    try {
      const { container } = await render(app(h(Draft)));
      const btn = container.querySelectorAll('.cpu-thinking button').find((b) => b.textContent === '⏩ Faster until the next turn') as MiniElement;
      expect(btn).toBeTruthy();
      // Offene Positionen der CPU (Formation in Reihenfolge, gruppiert)
      const { FORMATIONS } = await import('../src/config/formations');
      const { messages } = await import('../src/i18n');
      const counts = new Map<string, number>();
      for (const d of FORMATIONS[f1].slots) counts.set(messages().game.posShort[d.pos], (counts.get(messages().game.posShort[d.pos]) ?? 0) + 1);
      expect(container.querySelector('.draft__cpuneeds')!.textContent).toBe(` (still looking for: ${[...counts].map(([p, k]) => (k > 1 ? `${k}× ${p}` : p)).join(', ')})`);
      await act(async () => btn.click());
      // Zwei CPU-Picks à 40 ms – weit unter der normalen Bedenkzeit (2 × 550 ms)
      for (let i = 0; i < 4; i++) await act(async () => void vi.advanceTimersByTime(60));
      const saved = JSON.parse(localStorage.getItem('pokemon-elf:draft')!);
      expect(saved.pick).toBe(2);
      // Jetzt ist der Mensch dran – kein CPU-Hinweis mehr
      expect(container.querySelector('.cpu-thinking')).toBeNull();
      // Zwei eigene Picks (Snake: Pick 3 und 4), danach wieder CPU – jetzt mit normaler Bedenkzeit
      for (let k = 0; k < 2; k++) {
        const auto = container.querySelectorAll('.draft-pooltools button').find((b) => /^Pick automatically for /.test(b.textContent ?? '')) as MiniElement;
        await act(async () => auto.click());
      }
      expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).pick).toBe(4);
      await act(async () => void vi.advanceTimersByTime(200));
      expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).pick).toBe(4);
      await act(async () => void vi.advanceTimersByTime(400));
      expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).pick).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Rückgängig: nimmt den letzten eigenen Pick und die CPU-Picks danach zurück', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const f0 = FORMATION_IDS[0];
    const f1 = FORMATION_IDS[1];
    // Snake mit 2 Teams: Pick 0 ich, 1 und 2 CPU, Pick 3 wieder ich (am Zug)
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f0, slots: emptySlots(f0).map((_, j) => (j === 0 ? pool[0].id : null)) },
      { name: CLUB_NAMES[0], cpu: true, formation: f1, slots: emptySlots(f1).map((_, j) => (j === 0 ? pool[1].id : j === 1 ? pool[2].id : null)) },
    ];
    const log = [
      { team: 0, slot: 0, id: pool[0].id },
      { team: 1, slot: 0, id: pool[1].id },
      { team: 1, slot: 1, id: pool[2].id },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 0, legends: false, pick: 3, selected: null, seed: null, log }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const btn = container.querySelectorAll('.draft-pooltools button').find((b) => b.textContent === '↶ Undo') as MiniElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('Z');
    // Letzter Pick aus dem Verlauf in der Kopfzeile
    expect(container.querySelector('.draft__last')!.textContent).toBe(`Last pick: ${pool[2].en} → ${clubEn(CLUB_NAMES[0])}`);
    // Taste Z wirkt wie der Knopf
    const { MiniEvent } = await import('./miniDom');
    const ev = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key: 'z', ctrlKey: false, metaKey: false, altKey: false });
    await act(async () => void window.dispatchEvent(ev as unknown as Event));
    const saved = JSON.parse(localStorage.getItem('pokemon-elf:draft')!);
    expect(saved.pick).toBe(0);
    expect(saved.log).toEqual([]);
    expect(saved.teams.every((t: { slots: (number | null)[] }) => t.slots.every((x) => x == null))).toBe(true);
    // Ohne Verlauf (ältere Drafts) kein Knopf
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 0, legends: false, pick: 3, selected: null, seed: null }));
    const r2 = await render(app(h(Draft)));
    await settle();
    expect(r2.container.querySelectorAll('.draft-pooltools button').some((b) => b.textContent === '↶ Undo')).toBe(false);
  });

  it('Liga: Kreuztabelle mit allen Ergebnissen (Heim-Zeile gegen Gast-Spalte)', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2, 3].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 44, selected: null, seed: 7 }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const grid = container.querySelector('.draft__cross-table')!;
    expect(container.querySelector('.draft__cross summary')!.textContent).toBe('Results grid');
    const rows = grid.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(4);
    // Jede Zeile: 4 Zellen (eine leere Diagonale), alle anderen ein Ergebnis
    const cells = rows.map((r) => r.querySelectorAll('td').map((c) => c.textContent));
    for (const row of cells) {
      expect(row).toHaveLength(4);
      expect(row.filter((x) => /^\d+:\d+$/.test(x ?? ''))).toHaveLength(3);
    }
    // Erste Zeile = Tabellenerster
    const first = mainRows(container)[0].querySelectorAll('td')[1].textContent!.trim();
    expect(rows[0].querySelector('th')!.textContent).toContain(first.replace(/\s*CPU$/, '').trim());
  });

  it('Liga: Meisterchancen aus 50 Neuausspielungen (stabil, Summe ≤ 100 %)', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2, 3].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 44, selected: null, seed: 7, model: 'draft' }));
    const read = async () => {
      const { container } = await render(app(h(Draft)));
      await settle();
      const card = container.querySelectorAll('section').find((x) => x.getAttribute('aria-labelledby') === 'draft-local-odds') as MiniElement;
      return card.querySelectorAll('li').map((li) => li.textContent);
    };
    const first = await read();
    expect(first.length).toBeGreaterThan(0);
    const pcts = first.map((x) => Number(x!.match(/(\d+) %$/)![1]));
    expect(pcts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(101);
    expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
    // Gleicher Seed → gleiche Chancen
    expect(await read()).toEqual(first);
  });

  it('Liga: Deine Duelle – Bilanz gegen jeden Gegner, passend zu den Spielen', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2, 3].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 44, selected: null, seed: 7 }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const section = container.querySelectorAll('section').find((s) => s.getAttribute('aria-labelledby') === 'draft-local-duels') as MiniElement;
    expect(section).toBeTruthy();
    const rows = section.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(section.textContent).not.toContain('Mein Team');
    let w = 0;
    let d = 0;
    let l = 0;
    for (const row of rows) {
      const scores = row.querySelectorAll('.draft-results__duel').map((x) => x.textContent!.split(':').map(Number));
      expect(scores).toHaveLength(2);
      for (const [gf, ga] of scores) gf > ga ? w++ : gf === ga ? d++ : l++;
    }
    // Summe der Duelle = eigene Bilanz in der Haupttabelle
    const own = mainRows(container).find((r) => r.className.includes('is-user'))!;
    expect([w, d, l].map(String)).toEqual([5, 6, 7].map((k) => own.querySelectorAll('td')[k].textContent));
  });

  it('Liga: Umschalter Heim/Auswärts zeigt nur die halbe Saison, ohne Zonen und Legende', async () => {
    storeLang('en');
    const pool = ALL.filter((p) => !p.leg && !p.myth);
    const teams = [0, 1, 2, 3, 4, 5].map((i) => {
      const formation = FORMATION_IDS[i % FORMATION_IDS.length];
      return { name: i === 0 ? 'Mein Team' : CLUB_NAMES[i], cpu: i !== 0, formation, slots: emptySlots(formation).map((_, j) => pool[i * 11 + j].id) };
    });
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'league', teams, region: 0, legends: false, pick: 66, selected: null, seed: 7 }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const played = () => mainRows(container).map((r) => r.querySelectorAll('td')[4].textContent);
    expect(played()).toEqual(Array(6).fill('10'));
    // Form-Spalte: letzte fünf Spiele je Team, passend zu recentForm
    for (const row of mainRows(container)) expect(row.querySelectorAll('.league-form__dot')).toHaveLength(5);
    for (const label of ['Home', 'Away']) {
      const radio = container.querySelectorAll('[role="radio"]').find((b) => b.textContent === label) as MiniElement;
      await act(async () => radio.click());
      expect(played()).toEqual(Array(6).fill('5'));
      // Form in der Teilansicht: nur Heim- bzw. Auswärtsspiele (5 je Team)
      for (const row of mainRows(container)) expect(row.querySelectorAll('.league-form__dot')).toHaveLength(5);
      expect(mainRows(container).some((r) => r.className.includes('is-zone'))).toBe(false);
      expect(container.querySelector('.table-legend')).toBeNull();
    }
  });

  it('Draft läuft: Board zeigt den Ø Fit der gesetzten Picks', async () => {
    storeLang('en');
    const { positionFit } = await import('../src/lib/fit');
    const { FORMATIONS } = await import('../src/config/formations');
    const f = FORMATION_IDS[0];
    const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    const slots = emptySlots(f).map((x, j) => (j < 2 ? kanto[j].id : x));
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots },
      { name: CLUB_NAMES[0], cpu: true, formation: FORMATION_IDS[1], slots: emptySlots(FORMATION_IDS[1]) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 2, selected: null, seed: null }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const fits = [0, 1].map((j) => positionFit(kanto[j], FORMATIONS[f].slots[j].pos, SCALE));
    const avg = Math.round((fits[0] + fits[1]) / 2);
    const el = container.querySelectorAll('.draft__board .draft-board__fit');
    expect(el).toHaveLength(1);
    expect(el[0].textContent).toBe(`Ø ${avg}Average positional fit of the picks so far: ${avg}`);
    // Nur ein Team mit Picks: keine Krone
    expect(container.querySelector('.draft-board__top')).toBeNull();
  });

  it('Draft läuft: Typ-Elf ab vier Pokémon eines Typs auf dem Board', async () => {
    const f = FORMATION_IDS[0];
    const fire = ALL.filter((p) => p.types.includes('fire') && !p.types.includes('water') && !p.leg && !p.myth).slice(0, 4);
    const water = ALL.filter((p) => p.types.includes('water') && !p.types.includes('fire') && !p.leg && !p.myth).slice(0, 3);
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f).map((x, j) => (j < 4 ? fire[j].id : x)) },
      { name: CLUB_NAMES[0], cpu: true, formation: f, slots: emptySlots(f).map((x, j) => (j < 3 ? water[j].id : x)) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 0, legends: false, pick: 7, selected: null, seed: null }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const cols = container.querySelectorAll('.draft__board .draft__col');
    expect(cols[0].querySelector('.draft-board__type')!.textContent).toBe('Feuer ×4Typ-Elf: 4 Pokémon vom Typ Feuer');
    expect(cols[1].querySelector('.draft-board__type')).toBeNull();
  });

  it('Draft läuft: 🌈 Typen-Regenbogen ab zehn verschiedenen Typen', async () => {
    const f = FORMATION_IDS[0];
    // Gierig bunte Pokémon sammeln: jedes bringt mindestens einen neuen Typ
    const seen = new Set<string>();
    const colorful: typeof ALL = [];
    for (const p of ALL) {
      if (p.leg || p.myth || colorful.length >= 11 || seen.size >= 10) continue;
      if (p.types.some((ty) => !seen.has(ty))) {
        colorful.push(p);
        p.types.forEach((ty) => seen.add(ty));
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
    const fire = ALL.filter((p) => p.types.length === 1 && p.types[0] === 'fire' && !p.leg && !p.myth).slice(0, 3);
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f).map((x, j) => colorful[j]?.id ?? x) },
      { name: CLUB_NAMES[0], cpu: true, formation: f, slots: emptySlots(f).map((x, j) => (j < 3 ? fire[j].id : x)) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 0, legends: false, pick: colorful.length + 3, selected: null, seed: null }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const cols = container.querySelectorAll('.draft__board .draft__col');
    expect(cols[0].querySelector('.draft-board__rainbow')!.textContent).toBe(`🌈 ${seen.size}Typen-Regenbogen: ${seen.size} verschiedene Typen`);
    expect(cols[1].querySelector('.draft-board__rainbow')).toBeNull();
  });

  it('Lokale Pick-Uhr: zählt herunter und wählt beim Ablauf automatisch', async () => {
    const f = FORMATION_IDS[0];
    const humans = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f) },
      { name: 'Zweites Team', cpu: false, formation: f, slots: emptySlots(f) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams: humans, region: 1, legends: false, pick: 0, selected: null, seed: null, log: [], pickSeconds: 30 }));
    vi.useFakeTimers();
    try {
      const { container } = await render(app(h(Draft)));
      await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
      expect(container.querySelector('.draft__clock')!.textContent).toBe('⏱ 30 s');
      await act(async () => void (await vi.advanceTimersByTimeAsync(25_000)));
      expect(container.querySelector('.draft__clock')!.textContent).toBe('⏱ 5 s');
      expect(container.querySelector('.draft__clock')!.className).toContain('is-urgent');
      await act(async () => void (await vi.advanceTimersByTimeAsync(6_000)));
      const saved = JSON.parse(localStorage.getItem('pokemon-elf:draft')!);
      expect(saved.pick).toBe(1);
      expect(saved.teams[0].slots.filter((x: number | null) => x != null)).toHaveLength(1);
      // Jetzt ist Team 2 dran – die Uhr startet neu
      expect(container.querySelector('.draft__clock')!.textContent).toBe('⏱ 30 s');
    } finally {
      vi.useRealTimers();
      localStorage.removeItem('pokemon-elf:draft');
    }
  });

  it('Rundenende: „🔔 Runde n vorbei“ mit dem Top-Pick der Runde (nicht schon beim Laden)', async () => {
    const f = FORMATION_IDS[0];
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f) },
      { name: CLUB_NAMES[0], cpu: true, formation: f, slots: emptySlots(f) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 0, selected: null, seed: null, log: [], pickSeconds: 30 }));
    vi.useFakeTimers();
    try {
      const { container } = await render(app(h(Draft)));
      const toasts = () => container.querySelectorAll('.toast').map((e) => e.textContent!);
      await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
      expect(toasts().filter((x) => x.startsWith('🔔'))).toEqual([]);
      // Uhr läuft ab → Auto-Pick, danach die CPU: Runde 1 (2 Picks) ist vorbei
      await act(async () => void (await vi.advanceTimersByTimeAsync(31_000)));
      await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
      const saved = JSON.parse(localStorage.getItem('pokemon-elf:draft')!);
      expect(saved.pick).toBeGreaterThanOrEqual(2);
      const round = toasts().filter((x) => x.startsWith('🔔'));
      expect(round).toHaveLength(1);
      expect(round[0]).toMatch(/^🔔 Runde 1 vorbei – Top-Pick: .+ \((Mein Team|.+), Fit \d+\)$/);
      const ids = saved.log.slice(0, 2).map((x: { id: number }) => x.id);
      expect(ids.some((id: number) => round[0].includes(ALL.find((p) => p.id === id)!.de))).toBe(true);
    } finally {
      vi.useRealTimers();
      localStorage.removeItem('pokemon-elf:draft');
    }
    // Geladener Stand am Rundenende: kein Hinweis
    const done = teams.map((tm, i) => ({ ...tm, slots: tm.slots.map((x, j) => (j === 0 ? ALL[i].id : x)) }));
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams: done, region: 0, legends: true, pick: 2, selected: null, seed: null, log: [{ team: 0, slot: 0, id: ALL[0].id }, { team: 1, slot: 0, id: ALL[1].id }] }));
    const r = await render(app(h(Draft)));
    await settle();
    expect(r.container.querySelectorAll('.toast').filter((e) => e.textContent!.startsWith('🔔'))).toHaveLength(0);
  });

  it('✅ Elf eines menschlichen Teams vollständig: Toast mit Ø Fit', async () => {
    const f = FORMATION_IDS[0];
    const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    // Zwei Menschen, je zehn Spieler; letzte Runde (Snake: Pick 20 → Team 0), ein Platz frei
    const teams = [0, 1].map((i) => ({ name: i ? 'Zweites Team' : 'Mein Team', cpu: false, formation: f, slots: emptySlots(f).map((_, j) => (j < 10 ? kanto[i * 10 + j].id : null)) }));
    const log: { team: number; slot: number; id: number }[] = [];
    for (let k = 0; k < 20; k++) {
      const round = Math.floor(k / 2);
      const team = round % 2 === 0 ? k % 2 : 1 - (k % 2);
      log.push({ team, slot: round, id: teams[team].slots[round]! });
    }
    const pickMon = kanto[30];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 20, selected: pickMon.id, seed: null, log }));
    const { container } = await render(app(h(Draft)));
    await settle();
    await act(async () => (container.querySelector('.pitch .slot--target') as MiniElement).click());
    const { FORMATIONS } = await import('../src/config/formations');
    const { positionFit } = await import('../src/lib/fit');
    const ids = [...teams[0].slots.slice(0, 10), pickMon.id];
    const fits = FORMATIONS[f].slots.map((d, j) => positionFit(ALL.find((p) => p.id === ids[j])!, d.pos, SCALE));
    const avg = Math.round(fits.reduce((a, b) => a + b, 0) / fits.length);
    expect(container.querySelectorAll('.toast').map((e) => e.textContent)).toContain(`✅ Deine Elf steht – Ø Fit ${avg}`);
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('★ das letzte freie legendäre Pokémon wird angesagt', async () => {
    const { isLegend } = await import('../src/lib/draftEngine');
    const f = FORMATION_IDS[0];
    const legends = ALL.filter((p) => p.gen === 1 && !p.form && isLegend(p));
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f) },
      { name: 'Zweites Team', cpu: false, formation: f, slots: emptySlots(f) },
    ];
    // Alle Legendären bis auf eins schon gewählt (Snake: 0, 1, 1, 0, 0, 1 …)
    const log: { team: number; slot: number; id: number }[] = [];
    legends.slice(0, -1).forEach((p, k) => {
      const team = Math.floor(k / 2) % 2 === 0 ? k % 2 : 1 - (k % 2);
      const slot = teams[team].slots.findIndex((x) => x == null);
      teams[team].slots[slot] = p.id;
      log.push({ team, slot, id: p.id });
    });
    const last = legends.at(-1)!;
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: true, pick: log.length, selected: last.id, seed: null, log }));
    const { container } = await render(app(h(Draft)));
    await settle();
    expect(container.querySelectorAll('.toast').filter((e) => e.textContent!.startsWith('★'))).toHaveLength(0);
    await act(async () => (container.querySelector('.pitch .slot--target') as MiniElement).click());
    const k = log.length;
    const who = (Math.floor(k / 2) % 2 === 0 ? k % 2 : 1 - (k % 2)) === 0 ? 'Mein Team' : 'Zweites Team';
    expect(container.querySelectorAll('.toast').map((e) => e.textContent)).toContain(`★ Das letzte legendäre Pokémon ist vergeben: ${last.de} (${who})`);
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('Auswahl: bester freier Platz und Ø Fit vorher → nachher (wie online)', async () => {
    const f = FORMATION_IDS[0];
    const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f).map((x, j) => (j === 0 ? kanto[0].id : x)) },
      { name: 'Zweites Team', cpu: false, formation: f, slots: emptySlots(f).map((x, j) => (j === 0 ? kanto[1].id : x)) },
    ];
    // Pick 2 (Snake): das zweite Team ist noch einmal dran, Pokémon ausgewählt
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 2, selected: kanto[5].id, seed: null }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const { fitImpact } = await import('../src/lib/fit');
    const { FORMATIONS } = await import('../src/config/formations');
    const x = fitImpact(kanto[5], FORMATIONS[f].slots, teams[1].slots, new Map(ALL.map((p) => [p.id, p])), SCALE)!;
    expect(container.querySelector('.draft-hint__impact')!.textContent).toBe(`${x.pos} Fit ${x.fit} · Ø Fit ${x.before} → ${x.after}`);
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('👀 Feld eines anderen Teams ansehen (nur Ansicht)', async () => {
    const f = FORMATION_IDS[0];
    const g = FORMATION_IDS[1];
    const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f) },
      { name: 'Zweites Team', cpu: false, formation: g, slots: emptySlots(g).map((x, j) => (j === 0 ? kanto[0].id : x)) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 0, selected: kanto[3].id, seed: null }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const title = () => container.querySelector('.challenge__pitch h2')!.textContent;
    expect(title()).toBe(`Mein Team · ${f}`);
    expect(container.querySelectorAll('.challenge__pitch .slot--target').length).toBeGreaterThan(0);
    const select = container.querySelector('.draft-peek select') as MiniElement;
    const { MiniEvent } = await import('./miniDom');
    (select as unknown as { value: string }).value = '1';
    await act(async () => void select.dispatchEvent(new MiniEvent('change', { bubbles: true })));
    expect(title()).toBe(`Zweites Team · ${g}`);
    // Fremdes Feld: keine Ziele, keine Plaketten
    expect(container.querySelectorAll('.challenge__pitch .slot--target')).toHaveLength(0);
    expect(container.querySelector('.challenge__pitch .slot__best')).toBeNull();
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('⏳ „bald weg“: die stärksten Freien vor dem nächsten Pick des Teams am Zug', async () => {
    const f = FORMATION_IDS[0];
    const teams = [0, 1, 2].map((i) => ({ name: i ? CLUB_NAMES[i] : 'Mein Team', cpu: false, formation: f, slots: emptySlots(f) }));
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 0, selected: null, seed: null, log: [] }));
    const { container } = await render(app(h(Draft)));
    await settle();
    // 3 Teams, Snake: Team 0 wählt Pick 0 und 5 → 4 fremde Picks dazwischen
    const { POSITIONS } = await import('../src/config/positions');
    const { positionFit } = await import('../src/lib/fit');
    const field = (Object.keys(POSITIONS) as (keyof typeof POSITIONS)[]).filter((p) => p !== 'SS');
    const expected = new Set(
      ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth && !p.form)
        .map((p) => ({ p, fit: Math.max(...field.map((pos) => positionFit(p, pos, SCALE))) }))
        .sort((a, b) => b.fit - a.fit || a.p.id - b.p.id)
        .slice(0, 4)
        .map((x) => x.p.de),
    );
    const cards = container.querySelectorAll('.pcard').filter((c) => c.querySelector('.pcard__name'));
    const marked = cards.filter((c) => (c.querySelector('.pcard__note')?.textContent ?? '') === '⏳ bald weg').map((c) => c.querySelector('.pcard__name')!.textContent);
    expect(marked).toEqual(cards.map((c) => c.querySelector('.pcard__name')!.textContent).filter((n) => expected.has(n!)));
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('☆ Merken: Merkliste des Teams am Zug, „★ gemerkt“ auf der Karte', async () => {
    const f = FORMATION_IDS[0];
    const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    const teams = [0, 1].map((i) => ({ name: i ? 'Zweites Team' : 'Mein Team', cpu: false, formation: f, slots: emptySlots(f) }));
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 0, selected: kanto[0].id, seed: null, log: [] }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const btn = () => container.querySelector('.draft__mark') as MiniElement;
    expect(btn().textContent).toBe('☆ Merken');
    await act(async () => btn().click());
    expect(btn().textContent).toBe('★ gemerkt');
    expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).marks).toEqual({ 0: [kanto[0].id] });
    // Karte (Bisasam ist im Raster ganz vorn) zeigt die Markierung
    const card = container.querySelectorAll('.pcard').find((c) => c.querySelector('.pcard__name')?.textContent === kanto[0].de)!;
    expect(card.querySelector('.pcard__note')!.textContent).toContain('★ gemerkt');
    // Noch einmal: wieder aus
    await act(async () => btn().click());
    expect(JSON.parse(localStorage.getItem('pokemon-elf:draft')!).marks).toEqual({ 0: [] });
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('Fortschrittsbalken: Picks des Teams am Zug als Striche', async () => {
    const f = FORMATION_IDS[0];
    const teams = [0, 1, 2].map((i) => ({ name: i ? CLUB_NAMES[i] : 'Mein Team', cpu: i > 0, formation: f, slots: emptySlots(f) }));
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 0, selected: null, seed: null, log: [] }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const bar = container.querySelector('.draft-progress')!;
    expect(bar.getAttribute('aria-valuemax')).toBe(String(3 * 11));
    expect(bar.querySelectorAll('.draft-progress__mark')).toHaveLength(11);
    // Leere Slots des menschlichen Teams am Zug: bester freier Fit (eine Plakette je Platz)
    const badges = container.querySelectorAll('.slot__best');
    expect(badges).toHaveLength(11);
    for (const b of badges) expect(Number(b.textContent)).toBeGreaterThan(0);
    localStorage.removeItem('pokemon-elf:draft');
  });

  it('Hot-Seat: „📱 Gerät an … weitergeben“ nur nach dem Pick eines anderen menschlichen Teams', async () => {
    const f = FORMATION_IDS[0];
    const empty = emptySlots(f);
    const humans = [
      { name: 'Mein Team', cpu: false, formation: f, slots: [1, ...empty.slice(1)] },
      { name: 'Zweites Team', cpu: false, formation: f, slots: [4, ...empty.slice(1)] },
    ];
    // Pick 3 (Snake): Team 1 hat eben gewählt, jetzt ist Team 1 noch einmal dran → kein Hinweis
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams: humans, region: 1, legends: false, pick: 2, selected: null, seed: null }));
    let r = await render(app(h(Draft)));
    await settle();
    expect(r.container.querySelector('.draft__handover')).toBeNull();
    // Pick 2: Team 0 hat gewählt, Team 1 ist dran → Hinweis mit seinem Namen
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams: humans, region: 1, legends: false, pick: 1, selected: null, seed: null }));
    r = await render(app(h(Draft)));
    await settle();
    expect(r.container.querySelector('.draft__handover')!.textContent).toBe('📱 Gerät an Zweites Team weitergeben!');
    // Vorher eine CPU: kein Hinweis
    const withCpu = [{ ...humans[0], cpu: true, name: CLUB_NAMES[0] }, humans[1]];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams: withCpu, region: 1, legends: false, pick: 1, selected: null, seed: null }));
    r = await render(app(h(Draft)));
    await settle();
    expect(r.container.querySelector('.draft__handover')).toBeNull();
  });

  it('Draft läuft: „🐍 Double pick“ an der Snake-Wende', async () => {
    storeLang('en');
    const [f, g] = [FORMATION_IDS[0], FORMATION_IDS[1]];
    const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    // Zwei Menschen, Pick 2 (Index 1): Team 2 ist dran und gleich noch einmal (Snake)
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f).map((x, j) => (j === 0 ? kanto[0].id : x)) },
      { name: 'Zweites Team', cpu: false, formation: g, slots: emptySlots(g) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 1, selected: null, seed: null }));
    const { container } = await render(app(h(Draft)));
    await settle();
    expect(container.querySelector('.draft-double')!.textContent).toBe('🐍 Double pick – you’re up again right after this one.');
    // Erst Runde 1: noch keine Zielflagge
    expect(container.querySelector('.draft-turnbar__final')).toBeNull();
  });

  it('Draft läuft: ★ freie Legendäre nur mit Legendären im Pool', async () => {
    storeLang('en');
    const f = FORMATION_IDS[0];
    const legends = ALL.filter((p) => p.gen === 1 && (p.leg || p.myth));
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f).map((x, j) => (j === 0 ? legends[0].id : x)) },
      { name: 'Zweites Team', cpu: false, formation: f, slots: emptySlots(f) },
    ];
    for (const withLegends of [false, true]) {
      localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: withLegends, pick: 1, selected: null, seed: null }));
      const { container } = await render(app(h(Draft)));
      await settle();
      const el = container.querySelector('.draft-pool__legends');
      if (!withLegends) expect(el).toBeNull();
      else expect(el!.textContent).toBe(`★ ${legends.length - 1} legendaries/mythicals still available`);
    }
  });

  it('Draft läuft: 🏁 in der letzten Runde', async () => {
    storeLang('en');
    const f = FORMATION_IDS[0];
    const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    // Zwei Teams, je 10 Picks gesetzt → Pick 21 (Runde 11)
    const teams = [0, 1].map((i) => ({ name: i ? 'Zweites Team' : 'Mein Team', cpu: false, formation: f, slots: emptySlots(f).map((x, j) => (j < 10 ? kanto[i * 10 + j].id : x)) }));
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 20, selected: null, seed: null }));
    const { container } = await render(app(h(Draft)));
    await settle();
    expect(container.querySelector('.draft-turnbar__final')!.textContent).toBe('Round 11/11 🏁Final round');
  });

  it('Draft läuft: 👑 am Team mit dem alleinigen besten Ø Fit', async () => {
    const { positionFit } = await import('../src/lib/fit');
    const { FORMATIONS } = await import('../src/config/formations');
    const [f, g] = [FORMATION_IDS[0], FORMATION_IDS[1]];
    const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    const fitOf = (form: typeof f, p: (typeof kanto)[number]) => positionFit(p, FORMATIONS[form].slots[0].pos, SCALE);
    // Team 1 bekommt das Pokémon mit dem besseren Fit auf Slot 0
    const [a, b] = kanto.slice(0, 40).reduce<[typeof kanto[number], typeof kanto[number]]>(
      (acc, p) => [fitOf(f, p) > fitOf(f, acc[0]) ? p : acc[0], fitOf(g, p) < fitOf(g, acc[1]) ? p : acc[1]],
      [kanto[0], kanto[1]],
    );
    expect(Math.round(fitOf(f, a))).toBeGreaterThan(Math.round(fitOf(g, b)));
    const teams = [
      { name: 'Mein Team', cpu: false, formation: f, slots: emptySlots(f).map((x, j) => (j === 0 ? a.id : x)) },
      { name: CLUB_NAMES[0], cpu: true, formation: g, slots: emptySlots(g).map((x, j) => (j === 0 ? b.id : x)) },
    ];
    localStorage.setItem('pokemon-elf:draft', JSON.stringify({ phase: 'drafting', teams, region: 1, legends: false, pick: 2, selected: null, seed: null }));
    const { container } = await render(app(h(Draft)));
    await settle();
    const cols = container.querySelectorAll('.draft__board .draft__col');
    expect(cols[0].querySelector('.draft-board__top')!.textContent).toBe('👑Bester Ø Fit bisher');
    expect(cols[1].querySelector('.draft-board__top')).toBeNull();
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
    // Meister-Zeile und Draft-Note
    expect(all).toMatch(/Champions: \| [^|]+ \| · \| \d+ pts/);
    expect(all).toContain('Grade');
    // Platz des eigenen (menschlichen) Teams im Kopf
    const ownAt = container.querySelectorAll('.league-table tbody tr').findIndex((r) => r.textContent?.includes('My Team'));
    expect(container.querySelector('.draft__you')!.textContent).toMatch(new RegExp(`^Your team: place ${ownAt + 1} · \\d+ pts`));
    expect(container.querySelector('.draft__you .draft__expect')).not.toBeNull();
    // Saisonverlauf des eigenen Teams (Platzkurve)
    const chart = container.querySelectorAll('section').find((sec) => sec.querySelector('h2')?.textContent === 'Your season');
    expect(chart).toBeTruthy();
    expect(chart!.querySelector('svg')).toBeTruthy();
    // Elf der Saison (englisch): Feld und elf Namen
    expect(texts(container).join(' | ')).toContain('Team of the season');
    expect(container.querySelectorAll('.draft-results__eleven-list li')).toHaveLength(11);
    expect(container.querySelector('.draft-results__eleven button')!.getAttribute('aria-label')).toBe('Save the team of the season as an image');
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
          h(DraftSettingsForm, { value: { ...s.settings, gens: [5] }, onChange: () => {}, list: ALL, teamsJoined: 3 }),
          h(DraftSettingsSummary, { settings: { ...s.settings, gens: [5], pickSeconds: 60, visibility: 'public' } }),
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
    // Kapitän auf dem Board (© neben dem Namen)
    st = engine.setTeamCaptain(st, 'dev-h', st.teams[0].slots.find((id) => id != null)!);
    st = { ...st, shinies: [st.teams[0].slots.find((id) => id != null)!] };
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
    expect(container.querySelectorAll('.draft-board__captain')).toHaveLength(1);
    expect(container.querySelectorAll('.draft-board__shinies')).toHaveLength(1);
    // Ø Fit je Team mit Picks
    expect(container.querySelectorAll('.draft-board__fit').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('.draft-board__fit')!.textContent).toMatch(/^Ø \d+Average positional fit of the picks so far: \d+$/);
    // 👑 erst, wenn mindestens zwei Teams einen Ø Fit haben – dann am alleinigen Bestwert
    expect(container.querySelector('.draft-board__top')).toBeNull();
    const s2 = snap(autoPick(st));
    const { container: c2 } = await render(app(h(DraftBoard, { state: s2, byId, currentId: s2.teams[0].id })));
    await settle();
    const avgs = [...c2.querySelectorAll('.draft__col')].map((col) => Number(col.querySelector('.draft-board__fit [aria-hidden]')!.textContent!.slice(2)));
    expect(avgs[0]).not.toBe(avgs[1]);
    const top = avgs.indexOf(Math.max(...avgs));
    expect(c2.querySelectorAll('.draft-board__top')).toHaveLength(1);
    expect(c2.querySelectorAll('.draft__col')[top].querySelector('.draft-board__top')!.textContent).toBe('👑Best average fit so far');
    expect(all).toContain(clubEn(cpu.name));
    expect(germanLeft(container)).toEqual([]);
  });

  it('Ergebnis (Saison vorbei): Meister, Tabelle, Torjäger, Spieltage', async () => {
    storeLang('en');
    const s = runnerUpView(finishedDraft());
    s.season = { ...s.season!, startsAt: Date.now() - 10 * 24 * 3600 * 1000 };
    // Saisonziel „Meister“ – als Zweiter verfehlt
    s.teams = s.teams.map((tm) => (tm.id === s.you ? { ...tm, goal: 'title' as const } : tm));
    const { container } = await render(app(h(DraftSeasonStage, { room: fakeRoom(s) })));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Online draft K7MPQ2');
    expect(all).toContain('Season goal missed: Win the title');
    expect(container.querySelector('.draft-results__roster-goal')!.textContent).toBe('🎯 Win the title ✗');
    // ⭐ Wo landeten die Stars? Die fünf stärksten des Pools mit Team und Pick (oder „not drafted“)
    {
      const { poolStars } = await import('../src/components/PoolStars');
      const { poolOf } = await import('../src/lib/draftEngine');
      const stars = poolStars(poolOf(s.settings, ALL), buildScale(ALL, 'all'));
      const rows = container.querySelectorAll('.draft-results__stars li');
      expect(rows).toHaveLength(5);
      stars.forEach((x, i) => {
        expect(rows[i].textContent).toContain(x.pokemon.en);
        const pk = s.picks.find((p) => p.pokemonId === x.pokemon.id);
        const tm = pk ? s.teams.find((t) => t.id === pk.teamId)! : null;
        expect(rows[i].textContent).toMatch(pk ? new RegExp(` · pick ${pk.pick + 1}$`) : /not drafted$/);
        if (tm && !tm.cpu) expect(rows[i].textContent).toContain(tm.name);
      });
      // CPU-Teams picken nach Fit – mindestens ein Star ist vergeben
      expect(stars.some((x) => s.picks.some((p) => p.pokemonId === x.pokemon.id))).toBe(true);
    }
    expect(all).toContain('Champions: ');
    expect(all).toContain('Final table');
    expect(all).toContain('Top scorers');
    expect(all).toContain('Line-ups');
    expect(all).toContain('All matchdays');
    expect(all).toContain('Matchday 1');
    // Auf 18 Teams aufgefüllt (ohne Ranglisten-Teams: Vereine, übersetzt)
    expect(container.querySelectorAll('.draft-results__table tbody tr')).toHaveLength(18);
    expect(all).toContain('Share result');
    expect(all).toMatch(/⚽ Top scorer: [^|]+ \(\d+ goals?\)/);
    // Kapitäne gibt es nach dem Draft immer (automatisch) – der torgefährlichste steht oben
    expect(all).toMatch(/Top captain: [^|]+ \([^|]+\) with \d+ goals?/);
    expect(container.querySelectorAll('.draft-results .captain-badge').length).toBeGreaterThan(0);
    expect(all).toMatch(/All \d+ picks/);
    // 🏅 je Runde genau ein bester Pick
    {
      const rows = container.querySelectorAll('.draft-results__picklist li');
      const rounds = rows.length / s.teams.length;
      expect(rows.filter((li) => li.querySelector('.draft-results__roundbest'))).toHaveLength(rounds);
    }
    // Nur eigene Picks: Liste schrumpft auf die eigenen
    const allPicks = container.querySelectorAll('.draft-results__picklist li').length;
    expect(container.querySelector('.draft-results__picklist li')!.textContent).toMatch(/^#1 · R1 /);
    const mine = container.querySelector('.draft-results__mine input') as unknown as { click(): void; checked: boolean };
    await act(async () => {
      mine.checked = true;
      mine.click();
    });
    const own = container.querySelectorAll('.draft-results__picklist li');
    expect(own.length).toBeGreaterThan(0);
    expect(own.length).toBeLessThan(allPicks);
    expect(own.every((li) => li.className.includes('is-you'))).toBe(true);
    expect(all).toContain('Season records');
    expect(all).toContain('Your season');
    expect(all).toContain('Time travel');
    expect(all).toContain('Table after matchday 34 (of 34)');
    expect(all).toMatch(/League position over 34 matchdays – best \d+, final \d+/);
    expect(all).toMatch(/Best attack \| [^|]+ – \d+ goals/);
    expect(all).toMatch(/Biggest win \| [^|]+ \d+:\d+ [^|]+ \(matchday \d+\)/);
    expect(all).toMatch(/Longest winning run \| [^|]+, \d+ wins in a row \(matchdays \d+–\d+\)/);
    // Formkurve in der Abschlusstabelle (je Team fünf Punkte)
    expect(container.querySelectorAll('.draft-results__table .league-form')).toHaveLength(18);
    // Duelle des eigenen Teams
    expect(all).toContain('Your head-to-heads');
    expect(all).toContain('New league');
    expect(all).toContain(clubEn(s.teams[1].name));
    // Platz der Aufstellungen als englische Ordnungszahl
    // (Plätze der gedrafteten Teams in der aufgefüllten Tabelle)
    const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
    const places = s.league!.table.flatMap((r, i) => (r.team < s.teams.length ? [i + 1] : []));
    expect(container.querySelectorAll('.draft-results__place').map((e) => e.textContent)).toEqual(places.map(ordinal));
    expect(germanLeft(container)).toEqual([]);
  });

  it('Ticker: Serie des eigenen Teams (ab 3 Spielen), nicht am Saisonende', async () => {
    storeLang('en');
    const s = snap(finishedDraft());
    const league = s.league!;
    const names = s.teams.map((t) => (t.cpu ? clubEn(t.name) : t.name));
    const total = timeline.matchdayCount(league);
    const step = 60_000;
    const runAt = (md: number) => timeline.currentRun(league.matches.filter((m) => m.round <= md), 0);
    // Ersten Spieltag mit Serie suchen – der positive Fall muss vorkommen
    let md = 3;
    while (md < total && !runAt(md)) md++;
    expect(md).toBeLessThan(total);
    const renderAt = async (k: number) => {
      const { container } = await render(
        app(h(LeagueTicker, { league, teamNames: names, highlight: 0, startsAt: Date.now() - (k - 0.5) * step, stepMs: step, clockOffset: 0, onDone: () => {} })),
      );
      await settle();
      return container;
    };
    const run = runAt(md)!;
    const el = (await renderAt(md)).querySelector('.league-ticker__series');
    expect(el!.textContent).toBe(run.kind === 'unbeaten' ? `🔥 Unbeaten in ${run.length} games` : `🥶 Winless in ${run.length} games`);
    // Spieltag 2: zu früh für eine Serie
    expect((await renderAt(2)).querySelector('.league-ticker__series')).toBeNull();
  });

  it('Ticker: 🎩 Hattrick auf der Ergebnistafel des Spieltags', async () => {
    storeLang('en');
    const s = snap(finishedDraft());
    const league = s.league!;
    const names = s.teams.map((t) => (t.cpu ? clubEn(t.name) : t.name));
    const total = timeline.matchdayCount(league);
    const hats = timeline.hatTricks(league.matches);
    // Ein Spieltag (vor dem Ende) mit Hattrick – der positive Fall muss vorkommen
    const hat = hats.find((h) => h.round < total);
    expect(hat).toBeTruthy();
    const step = 60_000;
    const renderAt = async (md: number) => {
      const { container } = await render(
        app(h(LeagueTicker, { league, teamNames: names, highlight: 0, startsAt: Date.now() - (md - 0.5) * step, stepMs: step, clockOffset: 0, onDone: () => {} })),
      );
      await settle();
      return container;
    };
    const c = await renderAt(hat!.round);
    const nameOf = (i: number) => names[i] ?? clubEn(league.teams[i].name);
    const mon = ALL.find((p) => p.id === hat!.pokemonId)!.en;
    const lines = c.querySelectorAll('.league-board__hat').map((e) => e.textContent);
    expect(lines).toContain(`🎩 Hat-trick: ${mon} (${nameOf(hat!.team)}) scores ${hat!.goals}`);
    expect(lines).toHaveLength(hats.filter((x) => x.round === hat!.round).length);
    // Ein Spieltag ohne Hattrick: keine Zeile
    const quiet = Array.from({ length: total - 1 }, (_, i) => i + 1).find((r) => !hats.some((x) => x.round === r));
    if (quiet) expect((await renderAt(quiet)).querySelector('.league-board__hat')).toBeNull();
  });

  it('Ticker: 💥 Kantersieg auf der Ergebnistafel des Spieltags', async () => {
    storeLang('en');
    const s = snap(finishedDraft());
    const league = s.league!;
    const names = s.teams.map((t) => (t.cpu ? clubEn(t.name) : t.name));
    const total = timeline.matchdayCount(league);
    const rounds = Array.from({ length: total - 1 }, (_, i) => i + 1);
    const routs = rounds.map((r) => timeline.routOf(league.matches.filter((m) => m.round === r)));
    // Ein Spieltag (vor dem Ende) mit Kantersieg – der positive Fall muss vorkommen
    const k = routs.findIndex(Boolean);
    expect(k).toBeGreaterThanOrEqual(0);
    const step = 60_000;
    const renderAt = async (md: number) => {
      const { container } = await render(
        app(h(LeagueTicker, { league, teamNames: names, highlight: 0, startsAt: Date.now() - (md - 0.5) * step, stepMs: step, clockOffset: 0, onDone: () => {} })),
      );
      await settle();
      return container;
    };
    const r = routs[k]!;
    const nameOf = (i: number) => names[i] ?? clubEn(league.teams[i].name);
    const score = r.match.home === r.winner ? `${r.match.hg}:${r.match.ag}` : `${r.match.ag}:${r.match.hg}`;
    expect((await renderAt(k + 1)).querySelector('.league-board__rout')!.textContent).toBe(
      `💥 Thrashing: ${nameOf(r.winner)} beat ${nameOf(r.loser)} ${score}`,
    );
    // Ein Spieltag ohne Kantersieg: keine Zeile
    const quiet = routs.findIndex((x) => !x);
    if (quiet >= 0) expect((await renderAt(quiet + 1)).querySelector('.league-board__rout')).toBeNull();
  });

  it('Ticker: 🔄 Comeback auf der Ergebnistafel des Spieltags', async () => {
    storeLang('en');
    const s = snap(finishedDraft());
    const raw = s.league!;
    const names = s.teams.map((t) => (t.cpu ? clubEn(t.name) : t.name));
    // Erstes Spiel des 2. Spieltags: Gast liegt 0:2 zurück und gewinnt 3:2
    const k = raw.matches.findIndex((m) => m.round === 2);
    const g = (minute: number) => ({ pokemonId: ALL[0].id, pos: 'ST' as const, minute });
    const league = {
      ...raw,
      matches: raw.matches.map((m, i) => (i === k ? { ...m, hg: 2, ag: 3, homeScorers: [g(5), g(20)], awayScorers: [g(50), g(60), g(70)] } : m)),
    };
    const cb = timeline.comebackOf(league.matches.filter((m) => m.round === 2));
    expect(cb).toBeTruthy();
    const step = 60_000;
    const renderAt = async (md: number) => {
      const { container } = await render(
        app(h(LeagueTicker, { league, teamNames: names, highlight: 0, startsAt: Date.now() - (md - 0.5) * step, stepMs: step, clockOffset: 0, onDone: () => {} })),
      );
      await settle();
      return container;
    };
    const nameOf = (i: number) => names[i] ?? clubEn(league.teams[i].name);
    const score = cb!.match.home === cb!.winner ? `${cb!.match.hg}:${cb!.match.ag}` : `${cb!.match.ag}:${cb!.match.hg}`;
    expect((await renderAt(2)).querySelector('.league-board__comeback')!.textContent).toBe(
      `🔄 Comeback: ${nameOf(cb!.winner)} – from ${cb!.behind[0]}:${cb!.behind[1]} down to a ${score} win against ${nameOf(cb!.loser)}`,
    );
    // Ein Spieltag ohne Comeback: keine Zeile
    const total = timeline.matchdayCount(league);
    const quiet = Array.from({ length: total - 1 }, (_, i) => i + 1).find((r) => !timeline.comebackOf(league.matches.filter((m) => m.round === r)));
    if (quiet) expect((await renderAt(quiet)).querySelector('.league-board__comeback')).toBeNull();
  });

  it('Ticker: Wechsel an der Tabellenspitze wird gemeldet', async () => {
    storeLang('en');
    const s = snap(finishedDraft());
    const league = s.league!;
    const names = s.teams.map((t) => (t.cpu ? clubEn(t.name) : t.name));
    const total = timeline.matchdayCount(league);
    const days = timeline.leagueTimeline(league);
    // Ersten Spieltag (ab 2, vor dem Ende) mit neuem Tabellenführer suchen
    const k = days.findIndex((d, i) => i >= 1 && i < total - 1 && d.leader.team !== days[i - 1].leader.team);
    expect(k).toBeGreaterThan(0);
    const md = k + 1;
    const step = 60_000;
    const { container } = await render(
      app(h(LeagueTicker, { league, teamNames: names, highlight: 0, startsAt: Date.now() - (md - 0.5) * step, stepMs: step, clockOffset: 0, onDone: () => {} })),
    );
    await settle();
    const el = container.querySelector('.league-ticker__leader.is-new');
    const nameOf = (i: number) => names[i] ?? clubEn(league.teams[i].name);
    expect(el!.textContent).toBe(`👑 New leaders: ${nameOf(days[k].leader.team)} take over from ${nameOf(days[k - 1].leader.team)}`);
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
      { startsAt: Date.now() - 1.5 * step, expect: ['Matchday 2', 'Results', 'Table after matchday 2', 'Position', 'Next opponent'] },
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
      // Abstand zur Spitze bzw. Vorsprung neben den Punkten (nach Spieltag 2)
      if (c.expect.includes('Next opponent')) {
        const tbl = timeline.leagueTimeline(league)[1].table;
        const own = tbl.findIndex((r) => r.team === 0);
        const gap = container.querySelector('.league-ticker__gap')!.textContent;
        if (own === 0) expect(gap).toMatch(/^(\d+ pts clear|level on points with 2nd)$/);
        else expect(gap).toBe(`${tbl[0].pts - tbl[own].pts === 0 ? 'level on points with the top' : `${tbl[0].pts - tbl[own].pts} pts behind 1st`}`);
      }
      // Nächster Gegner (Liga): nach Spieltag 2 der Gegner von Spieltag 3 mit seinem Platz, am Saisonende nicht mehr
      const next = container.querySelector('.league-ticker__next');
      if (c.expect.includes('Next opponent')) {
        const m = league.matches.find((x) => x.round === 3 && (x.home === 0 || x.away === 0))!;
        const opp = m.home === 0 ? m.away : m.home;
        expect(next!.textContent).toContain(names[opp] ?? clubEn(league.teams[opp].name));
        expect(next!.textContent).toMatch(/ · \d+(st|nd|rd|th)/);
      }
      if (c.expect.includes('Full time!')) expect(next).toBeNull();
      // 🧤 eigene Spiele ohne Gegentor bis zum gezeigten Spieltag (bei den Toren)
      {
        const upTo = c.expect.includes('Full time!') ? total : c.expect.includes('Next opponent') ? 2 : 0;
        const clean = league.matches.filter((m) => m.round <= upTo && ((m.home === 0 && m.ag === 0) || (m.away === 0 && m.hg === 0))).length;
        const el = container.querySelector('.league-ticker__clean');
        if (upTo === total) expect(clean).toBeGreaterThan(0);
        if (clean > 0) expect(el!.textContent).toBe(` 🧤 ${clean} – ${clean === 1 ? 'one clean sheet' : `${clean} clean sheets`}`);
        else expect(el).toBeNull();
      }
      // Spieler des Spieltags auf der Ergebnistafel (sobald es Torbeteiligungen gab)
      if (c.expect.includes('Results')) {
        const star = timeline.playerOfRound(league.matches.filter((m) => m.round === 2));
        if (star) expect(container.querySelector('.league-board__star')!.textContent).toMatch(/Player of the matchday/);
        // Topspiel des 2. Spieltags nach der Tabelle nach Spieltag 1
        const tdays = timeline.leagueTimeline(league);
        const pl = tdays[0].places;
        const top = [...tdays[1].matches].sort((a, b) => pl[a.home] + pl[a.away] - (pl[b.home] + pl[b.away]))[0];
        expect(container.querySelector('.league-board__top')!.textContent).toContain(`Top game: ${pl[top.home]}. `);
        expect(container.querySelector('.league-board__top')!.textContent).toContain(` ${top.hg}:${top.ag} ${pl[top.away]}. `);
        const late = timeline.lateWinner(league.matches.filter((m) => m.round === 2));
        if (late) expect(container.querySelector('.league-board__late')!.textContent).toMatch(/Late winner: .+ – winning goal in the \d/);
        else expect(container.querySelector('.league-board__late')).toBeNull();
      }
      // Serie des Tabellenführers: sichtbar ab 3 Spieltagen in Folge, nicht am Saisonende
      const streak = container.querySelector('.league-ticker__leader');
      if (c.expect.includes('Full time!')) expect(streak).toBeNull();
      else if (streak) expect(streak.textContent).toMatch(/have led the table for \d+ matchdays$/);
      expect(germanLeft(container)).toEqual([]);
    }
    // Spieltag mit einer Führungsserie ≥ 3: Zeile sichtbar mit der richtigen Zahl
    const days = timeline.leagueTimeline(league);
    const k = days.findIndex((d, i) => i < days.length - 1 && timeline.leaderSince(days, d.round) >= 3);
    expect(k).toBeGreaterThanOrEqual(0);
    const { container } = await render(
      app(h(LeagueTicker, { league, teamNames: names, highlight: 0, startsAt: Date.now() - (k + 0.5) * step, stepMs: step, clockOffset: 0, onDone: () => {} })),
    );
    await settle();
    expect(container.querySelector('.league-ticker__leader')!.textContent).toContain(`have led the table for ${timeline.leaderSince(days, k + 1)} matchdays`);
    // Spieltag mit Last-Minute-Sieg: Zeile auf der Ergebnistafel
    const lateDay = days.findIndex((d, i) => i < days.length - 1 && timeline.lateWinner(d.matches));
    expect(lateDay).toBeGreaterThanOrEqual(0);
    const late = timeline.lateWinner(days[lateDay].matches)!;
    const v2 = await render(
      app(h(LeagueTicker, { league, teamNames: names, highlight: 0, startsAt: Date.now() - (lateDay + 0.5) * step, stepMs: step, clockOffset: 0, onDone: () => {} })),
    );
    await settle();
    expect(v2.container.querySelector('.league-board__late')!.textContent).toContain(`winning goal in the ${late.minute > 90 ? `90+${late.minute - 90}` : late.minute}'`);
  });
});

describe('KO-Turnier auf Englisch', () => {
  it('Ergebnis: Turniersieger, Baum, Endklassement – ohne Deutsch', async () => {
    storeLang('en');
    const s = runnerUpView(finishedDraft('cup'));
    s.season = { ...s.season!, startsAt: Date.now() - 10 * 24 * 3600 * 1000 };
    const { container } = await render(app(h(DraftSeasonStage, { room: fakeRoom(s) })));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Cup winners: ');
    expect(all).toContain('Bracket');
    expect(all).toContain('Round of 16');
    expect(all).toContain('Quarter-final');
    expect(all).toContain('Final standings');
    expect(all).toMatch(/Your team [^|]+: (Out in the|Lost the final|Cup winners)/);
    expect(container.querySelectorAll('.draft-results__table tbody tr')).toHaveLength(16);
    expect(germanLeft(container)).toEqual([]);
  });

  it('mit Gruppenphase: Gruppentabellen im Ticker und im Ergebnis', async () => {
    storeLang('en');
    const s = runnerUpView(finishedDraft('cup', true));
    s.season = { ...s.season!, startsAt: Date.now() - s.season!.stepMs * 2.5 };
    const ticker = await render(app(h(DraftSeasonStage, { room: fakeRoom(s) })));
    await settle();
    let all = texts(ticker.container).join(' | ');
    expect(all).toContain('Group stage · Matchday 3');
    expect(all).toContain('Groups');
    expect(all).toContain('Group D');
    expect(germanLeft(ticker.container)).toEqual([]);
    const done = runnerUpView(finishedDraft('cup', true));
    done.season = { ...done.season!, startsAt: Date.now() - 10 * 24 * 3600 * 1000 };
    const result = await render(app(h(DraftSeasonStage, { room: fakeRoom(done) })));
    await settle();
    all = texts(result.container).join(' | ');
    expect(all).toContain('Group A');
    expect(all).toContain('Quarter-final');
    expect(all).not.toContain('Round of 16');
    expect(result.container.querySelectorAll('.cup-group__table')).toHaveLength(4);
    expect(germanLeft(result.container)).toEqual([]);
  });

  it('Ticker mitten im Turnier: Runde, Status, Baum', async () => {
    storeLang('en');
    const s = runnerUpView(finishedDraft('cup'));
    s.season = { ...s.season!, startsAt: Date.now() - s.season!.stepMs * 1.5 };
    const { container } = await render(app(h(DraftSeasonStage, { room: fakeRoom(s) })));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Round');
    expect(all).toContain('Quarter-final');
    expect(all).toContain('Bracket');
    expect(all).toMatch(/Still in|Out in the (round of 16|quarter-final)/);
    if (all.includes('Still in')) expect(all).toMatch(/Next opponent \| [^|]+ \| · Semi-final/);
    // Torjäger bis zum aktuellen Spieltag
    expect(all).toContain('Top scorers');
    expect(germanLeft(container)).toEqual([]);
  });
});

describe('Benachrichtigung am Saisonende', () => {
  it('Tab im Hintergrund, Hinweise an: nach dem Abpfiff kommt der eigene Platz', async () => {
    localStorage.setItem('pokemon-elf:settings', JSON.stringify({ lang: 'de', notify: true }));
    const shown: { title: string; body?: string; tag?: string }[] = [];
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, opts: { body?: string; tag?: string }) {
        shown.push({ title, ...opts });
      }
      close() {}
    }
    vi.stubGlobal('Notification', FakeNotification);
    doc.visibilityState = 'hidden';
    try {
      const s = runnerUpView(finishedDraft());
      const total = Math.max(...s.league!.matches.map((m) => m.round));
      // Abpfiff (letzter Spieltag + FINALE_MS) in gut einer halben Sekunde
      s.season = { ...s.season!, startsAt: Date.now() - (total - 1) * s.season!.stepMs - timeline.FINALE_MS + 500 };
      await render(app(h(DraftSeasonStage, { room: fakeRoom(s) })));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 900));
      });
      await settle();
      const you = s.teams.findIndex((t) => t.id === s.you);
      const place = s.league!.table.findIndex((r) => r.team === you) + 1;
      expect(shown).toEqual([
        expect.objectContaining({ title: 'Saison vorbei – Liga K7MPQ2', body: `Dein Team wird ${place}.`, tag: 'draft-season-K7MPQ2' }),
      ]);
    } finally {
      doc.visibilityState = 'visible';
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
    expect(container.querySelectorAll('.draft-results__table tbody tr')).toHaveLength(18);
    expect(all).toContain(s.teams[1].name);
    const places = s.league!.table.flatMap((r, i) => (r.team < s.teams.length ? [`${i + 1}.`] : []));
    expect(container.querySelectorAll('.draft-results__place').map((e) => e.textContent)).toEqual(places);
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

describe('Saison-Statistik: Teamwerte', () => {
  it('Spalte 🧤 zählt die Spiele ohne Gegentor', async () => {
    storeLang('de');
    const { SeasonStats } = await import('../src/components/SeasonStats');
    const stats = { shots: [10, 6] as [number, number], onTarget: [5, 2] as [number, number], possession: 55, xg: [1.5, 0.6] as [number, number] };
    const m = (home: number, away: number, hg: number, ag: number) => ({
      round: 1, home, away, hg, ag, stats,
      homeScorers: Array.from({ length: hg }, () => ({ pokemonId: 25, pos: 'ST' as const })),
      awayScorers: Array.from({ length: ag }, () => ({ pokemonId: 4, pos: 'ST' as const })),
    });
    // Team 0: 2:0 und 0:0 (zweimal zu null), Team 1: 0:2 und 0:0 (einmal)
    const league = { matches: [m(0, 1, 2, 0), m(1, 0, 0, 0)] } as unknown as Parameters<typeof SeasonStats>[0]['league'];
    const { container } = await render(app(h(SeasonStats, { league, you: 0, nameOf: (i: number) => `Team ${i}`, tabs: ['teams'] })));
    await settle();
    const head = container.querySelectorAll('.season-stats__teams thead th').map((th) => th.textContent);
    const col = head.indexOf('🧤Spiele ohne Gegentor');
    expect(col).toBeGreaterThan(0);
    const rows = container.querySelectorAll('.season-stats__teams tbody tr').map((tr) => tr.querySelectorAll('td').map((td) => td.textContent));
    expect(Object.fromEntries(rows.map((r) => [r[0], r[col]]))).toEqual({ 'Team 0': '2', 'Team 1': '1' });
  });
});
