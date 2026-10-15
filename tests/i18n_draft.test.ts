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
    const rows = container.querySelectorAll('.league-table tbody tr');
    expect(rows).toHaveLength(6);
    expect(rows[0].className).toContain('is-zone-top');
    expect(rows.some((r) => r.className.includes('is-zone-bottom'))).toBe(false);
    expect(container.querySelector('.table-legend')!.textContent).toBe('Champions');
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
    expect(container.querySelector('.draft__you')!.textContent).toMatch(new RegExp(`^Your team: place ${ownAt + 1} · \\d+ pts$`));
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
      // Nächster Gegner (Liga): nach Spieltag 2 der Gegner von Spieltag 3 mit seinem Platz, am Saisonende nicht mehr
      const next = container.querySelector('.league-ticker__next');
      if (c.expect.includes('Next opponent')) {
        const m = league.matches.find((x) => x.round === 3 && (x.home === 0 || x.away === 0))!;
        const opp = m.home === 0 ? m.away : m.home;
        expect(next!.textContent).toContain(names[opp] ?? clubEn(league.teams[opp].name));
        expect(next!.textContent).toMatch(/ · \d+(st|nd|rd|th)/);
      }
      if (c.expect.includes('Full time!')) expect(next).toBeNull();
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
