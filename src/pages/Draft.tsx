import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isMega } from '../config/categories';
import { DEFAULT_FORMATION, FORMATION_IDS, FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { REGIONS } from '../config/regions';
import { CLUB_NAMES } from '../config/season';
import { PosBadge } from '../components/Badges';
import { DraftPickFeed, DraftTypeChip, KindMarks, RoundBest } from '../components/DraftBoard';
import type { FeedItem } from '../state/useDraftRoom';
import { PoolStars, poolStars, StarsLanded } from '../components/PoolStars';
import { Confetti } from '../components/Confetti';
import { FilterBar, typingElsewhere, useFilteredPokemon, type PokemonFilters } from '../components/FilterBar';
import { CaptainPicker } from '../components/CaptainPicker';
import { JerseyEditor } from '../components/JerseyEditor';
import { KitPicker } from '../components/KitPicker';
import { cleanKit, type Kit } from '../lib/kits';
import { cleanJerseys, type Jerseys } from '../lib/jerseys';
import { Pitch, type SlotState } from '../components/Pitch';
import { PokemonGrid } from '../components/PokemonGrid';
import { Segmented } from '../components/Segmented';
import { Sprite } from '../components/Sprite';
import { useT } from '../i18n';
import { draftsSupported } from '../lib/api/draftClient';
import { positionFit, roundBestPicks, soleTopIndex } from '../lib/fit';
import { rankingNames } from '../lib/rankingNames';
import { emptySlots } from '../lib/formation';
import { biggestWin, comebackOf, draftGrades, hatTricks, localShareText, mostCleanSheets, draftSteal, goalFest, headToHead, leagueTimeline, recentForm, longestWinStreak, seasonEleven, seasonSwings, tableRowClass } from '../lib/leagueTimeline';
import { createRng, randomSeed, shuffle } from '../lib/rng';
import { cpuLevelOf, cpuPickChoice } from '../lib/localCpu';
import { buildTable, CLASSIC_MODEL, DRAFT_MODEL, formatRecord, sideTable, simulateLeague, type LeagueTeam } from '../lib/season';
import { scorerSummary } from '../lib/seasonTimeline';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { bestCaptain, evaluateTeam } from '../lib/teamScore';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import type { FormationId, Pokemon, RegionFilter, Slots } from '../types';
import { DraftOnline } from './DraftOnline';
import { FormDots, TableLegend } from '../components/LeagueTicker';
import { PlaceChart } from '../components/PlaceChart';
import { TableTimeTravel } from '../components/TableTimeTravel';
import { SeasonStats } from '../components/SeasonStats';
import { SaveImageButton } from '../components/SaveImageButton';
import { ReplayToggle, useMatchReport } from '../components/MatchReport';
import '../styles/draft.css';
import '../styles/league.css';
import { cleanCheer } from '../lib/cheer';
import { cleanCrest, type Crest as CrestData } from '../lib/crest';
import { Crest } from '../components/Crest';
import { CrestEditor } from '../components/CrestEditor';
import { cpuCaptain, limitKindsOf, pickNumbersLabel } from '../lib/draftEngine';
import { SHINY_CHANCE, SHINY_FIT_BONUS, SHINY_PARTY_CHANCE, shinyBonus, shinyRoll, shinyTeamBoost } from '../lib/shiny';
import { useToast } from '../state/Toast';
import { copyText, downloadBlob } from '../lib/exportImage';
import { lineupImage, slugify } from '../lib/lineupImage';

const ROUNDS = 11;

/** Vorgabe-Name des eigenen Teams – so gespeichert, angezeigt in der aktiven Sprache */
const OWN_TEAM = 'Mein Team';

interface DraftTeam {
  name: string;
  cpu: boolean;
  formation: FormationId;
  slots: Slots;
  /** Eigene Trikotnummern (nur Menschen; fehlt: Vorgabe nach Position) */
  jerseys?: Jerseys;
  /** Kapitän (Pokémon-ID aus der Elf, nur Menschen) – wird im Draft gewählt, zählt doppelt */
  captain?: number | null;
  /** Trikotfarben (nur Menschen; fehlt: Standard) */
  kit?: Kit | null;
  /** Torjubel (nur Menschen) */
  cheer?: string;
  /** Vereinswappen (nur Menschen) */
  crest?: CrestData | null;
}

interface DraftState {
  /** captains: nach dem letzten Pick wählen die Menschen ihren Kapitän, dann startet die Saison */
  phase: 'setup' | 'drafting' | 'captains' | 'league';
  teams: DraftTeam[];
  region: RegionFilter;
  legends: boolean;
  /** Regional- und Sonderformen im Pool */
  forms: boolean;
  /** Megas pro Team: 0 = keine, MEGAS_UNLIMITED = beliebig viele */
  megas: number;
  pick: number;
  selected: number | null;
  seed: number | null;
  /**
   * Spielmodell der Liga: 'draft' (wie der Online-Draft – Tagesform, realistischere Ergebnisse) für
   * neue Ligen; fehlt bei älteren gespeicherten Ligen → klassisch, damit sie gleich bleiben.
   */
  model?: 'draft';
  /** CPU-Teams mit Kapitän (Ligen ab dessen Einführung – ältere gespeicherte bleiben gleich) */
  cpuCaptains?: true;
  /** Zufallswert je Draft für die Shiny-Auslosung (fehlt bei älteren Drafts – dort keine Shinys) */
  shinySalt?: number;
  /** Shinys dieses Drafts (Pokémon-IDs) */
  shinies?: number[];
  /** Pick-Verlauf (Team-Index, Platz, Pokémon) – fehlt bei älteren gespeicherten Drafts */
  log?: { team: number; slot: number; id: number }[];
  /** Shinys ausgeschaltet (Einstellung vor dem Draft) */
  noShinies?: true;
  /** Shiny-Party: 10 % statt 2 % */
  shinyParty?: true;
  /** Stärke der CPU-Teams beim Picken (fehlt = normal) */
  cpuLevel?: 'easy' | 'hard';
  /** Pick-Uhr für menschliche Teams in Sekunden (fehlt = aus); läuft sie ab, wird automatisch gewählt */
  pickSeconds?: number;
}


/**
 * Namen für CPU-Teams: zuerst Teams aus den Online-Ranglisten (sofern geladen), dann Vereinsnamen –
 * ohne schon vergebene Namen (Groß/klein egal).
 */
function cpuNames(taken: readonly string[] = []): string[] {
  const used = new Set(taken.map((x) => x.trim().toLowerCase()));
  const out: string[] = [];
  for (const name of [...shuffle(Math.random, rankingNames()), ...shuffle(Math.random, CLUB_NAMES)]) {
    const key = name.trim().toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    out.push(name);
  }
  return out;
}

function defaultTeams(n: number): DraftTeam[] {
  const names = cpuNames([OWN_TEAM]);
  return Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? OWN_TEAM : names[i - 1],
    cpu: i !== 0,
    formation: i === 0 ? DEFAULT_FORMATION : FORMATION_IDS[i % FORMATION_IDS.length],
    slots: emptySlots(i === 0 ? DEFAULT_FORMATION : FORMATION_IDS[i % FORMATION_IDS.length]),
  }));
}

const INITIAL: DraftState = {
  phase: 'setup',
  teams: defaultTeams(4),
  region: 0,
  legends: false,
  forms: false,
  megas: 0,
  pick: 0,
  selected: null,
  seed: null,
};

/** Meisterchancen: so viele Neuausspielungen */
const TITLE_RUNS = 50;

/** Mega-Limit „unbegrenzt" (wie im Builder) */
const MEGAS_UNLIMITED = 99;
const MEGA_OPTIONS = [0, 1, 2, 3, MEGAS_UNLIMITED];

/** Schnellstart-Vorlagen des lokalen Drafts (wie online, nur die lokalen Einstellungen) */
type LocalPresetId = 'classic' | 'allRegions' | 'megaChaos' | 'shinyParty';
const LOCAL_PRESETS: Record<LocalPresetId, { region: RegionFilter; legends: boolean; forms: boolean; megas: number; shinyParty: boolean }> = {
  classic: { region: 1, legends: false, forms: false, megas: 0, shinyParty: false },
  allRegions: { region: 0, legends: true, forms: true, megas: 0, shinyParty: false },
  megaChaos: { region: 0, legends: true, forms: true, megas: 2, shinyParty: false },
  shinyParty: { region: 0, legends: false, forms: false, megas: 0, shinyParty: true },
};
const LOCAL_PRESET_IDS = Object.keys(LOCAL_PRESETS) as LocalPresetId[];

/** Pick-Uhr im lokalen Draft (0 = aus) */
const LOCAL_PICK_SECONDS = [0, 30, 60, 90];

/** Snake-Draft: Runde 1 vorwärts, Runde 2 rückwärts … */
function teamForPick(pick: number, n: number): number {
  const round = Math.floor(pick / n);
  const idx = pick % n;
  return round % 2 === 0 ? idx : n - 1 - idx;
}

/** Meister einer ausgespielten lokalen Liga (gespeicherter Teamname, deutsch) */
interface LocalChampion {
  seed: number;
  name: string;
}

/** Hot-Seat-Draft an einem Gerät (Modus „An einem Gerät"). */
function LocalDraft({ modeSwitch }: { modeSwitch?: ReactNode }) {
  const t = useT();
  const tx = t.draft.local;
  const { all, byId, scale } = usePokemonData();
  const toast = useToast();
  /** Kapitän: Menschen wählen ihn, CPU-Teams nehmen den am besten passenden Spieler */
  const captainOf = (tm: DraftTeam): number | null =>
    tm.cpu ? (state.cpuCaptains ? cpuCaptain(tm, byId, scale('all')) : null) : (tm.captain ?? null);
  const { sprite } = useSettings();
  const [state, setState] = useState<DraftState>(() => ({ ...INITIAL, ...load<Partial<DraftState>>(STORAGE_KEYS.draft, {}) }));
  const [filters, setFilters] = useState<PokemonFilters>({ query: '', type: null, region: 0 });
  /** Liga-Tabelle: gesamt oder nur Heim- bzw. Auswärtsspiele */
  const [tableView, setTableView] = useState<'all' | 'home' | 'away'>('all');
  const pitchRef = useRef<HTMLDivElement>(null);
  const elevenRef = useRef<HTMLElement>(null);

  useEffect(() => save(STORAGE_KEYS.draft, state), [state]);

  const n = state.teams.length;
  const totalPicks = n * ROUNDS;
  const currentTeam = state.phase === 'drafting' ? teamForPick(state.pick, n) : -1;
  // Team am Zug ins Bild: nur das Board seitlich scrollen (wie im Online-Draft)
  const boardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const board = boardRef.current;
    const col = board?.querySelector<HTMLElement>('.draft__col.is-current');
    if (!board || !col || board.scrollWidth <= board.clientWidth) return;
    board.scrollTo?.({ left: Math.max(0, col.offsetLeft - (board.clientWidth - col.offsetWidth) / 2), behavior: 'smooth' });
  }, [currentTeam]);
  // Ø Positions-Fit der gesetzten Elf je Team – grobe Live-Stärke wie im Online-Draft, 👑 am alleinigen Bestwert
  const boardFits =
    state.phase === 'drafting'
      ? state.teams.map((tm) => {
          const sc = scale('all');
          const fits = FORMATIONS[tm.formation].slots.flatMap((d, j) => {
            const p = tm.slots[j] != null ? byId.get(tm.slots[j]!) : undefined;
            return p ? [positionFit(p, d.pos, sc)] : [];
          });
          return fits.length ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : null;
        })
      : [];
  const boardTop = soleTopIndex(boardFits);
  const team = state.teams[currentTeam];

  const drafted = useMemo(
    () => new Set(state.teams.flatMap((tm) => tm.slots.filter((id): id is number => id != null))),
    [state.teams],
  );
  /** Teamname für die Anzeige: Vorgabe „Mein Team" und Vereinsnamen (CPU) in der aktiven Sprache */
  const teamName = (name: string) => (name === OWN_TEAM ? tx.myTeam : t.game.club(name));
  // 🔔 Ende einer Draft-Runde: kurzer Hinweis mit dem Top-Pick der Runde (Fit an seiner Position) – nur beim Vorwärtsdraften
  const lastPickRef = useRef(state.pick);
  useEffect(() => {
    const before = lastPickRef.current;
    lastPickRef.current = state.pick;
    const log = state.log;
    if (state.pick <= before || state.pick % n !== 0 || !log || log.length !== state.pick) return;
    const sc = scale('all');
    let top: { id: number; team: number; fit: number } | null = null;
    for (const x of log.slice(-n)) {
      const tm = state.teams[x.team];
      const pos = tm ? FORMATIONS[tm.formation].slots[x.slot]?.pos : undefined;
      const mon = byId.get(x.id);
      if (!tm || !pos || !mon) continue;
      const fit = positionFit(mon, pos, sc);
      if (!top || fit > top.fit) top = { id: x.id, team: x.team, fit };
    }
    const mon = top && byId.get(top.id);
    if (top && mon) toast(tx.roundDone(state.pick / n, t.game.pokemon(mon), teamName(state.teams[top.team].name), Math.round(top.fit)));
  }, [state.pick]);
  const megas = MEGA_OPTIONS.includes(state.megas) ? state.megas : 0;
  const inPool = (p: Pokemon) =>
    (state.region === 0 || p.gen === state.region) &&
    (state.legends || (!p.leg && !p.myth)) &&
    (!p.form || (isMega(p) ? megas > 0 : !!state.forms));
  // Mega-Limit: Hat das Team am Zug genug Megas, fallen sie für diesen Pick aus dem Pool
  const teamMegas = team ? team.slots.filter((id) => id != null && isMega(byId.get(id) ?? {})).length : 0;
  const megaRoom = megas >= MEGAS_UNLIMITED || teamMegas < megas;
  const pool = useMemo(
    () => all.filter((p) => inPool(p) && !drafted.has(p.id) && (megaRoom || !isMega(p))),
    [all, state.region, state.legends, state.forms, megas, megaRoom, drafted],
  );
  const filtered = useFilteredPokemon(pool, filters);
  /** Beste Freie: für jede noch offene Position des Teams am Zug das passendste Pokémon im Pool */
  const bestFree = useMemo(() => {
    if (!team || team.cpu || state.phase !== 'drafting') return [];
    const sc = scale('all');
    const seen = new Set<string>();
    const out: { pos: (typeof FORMATIONS)[FormationId]['slots'][number]['pos']; p: Pokemon; fit: number }[] = [];
    FORMATIONS[team.formation].slots.forEach((d, j) => {
      if (team.slots[j] != null || seen.has(d.pos)) return;
      seen.add(d.pos);
      let best: { p: Pokemon; fit: number } | null = null;
      for (const p of pool) {
        const fit = positionFit(p, d.pos, sc);
        if (!best || fit > best.fit) best = { p, fit };
      }
      if (best) out.push({ pos: d.pos, ...best });
    });
    return out;
  }, [team, pool, state.phase, scale]);
  // Megas zählen nur, soweit das Limit sie aufnimmt
  const poolSize = useMemo(() => {
    const base = all.filter(inPool);
    const megaCount = base.filter(isMega).length;
    const cap = megas >= MEGAS_UNLIMITED ? megaCount : Math.min(megaCount, megas * n);
    return base.length - megaCount + cap;
  }, [all, state.region, state.legends, state.forms, megas, n]);
  const poolTooSmall = poolSize < n * ROUNDS;

  const lock = (teamIdx: number, slot: number, pokemonId: number) =>
    setState((s) => {
      const teams = s.teams.map((tm, i) =>
        i === teamIdx ? { ...tm, slots: tm.slots.map((v, j) => (j === slot ? pokemonId : v)) } : tm,
      );
      const pick = s.pick + 1;
      const shiny = s.shinySalt != null && shinyRoll(s.shinySalt, pokemonId, s.shinyParty ? SHINY_PARTY_CHANCE : SHINY_CHANCE);
      return {
        ...s,
        teams,
        pick,
        // Verlauf nur, wenn er von Anfang an mitläuft (sonst stimmten die Pick-Nummern nicht)
        ...(s.log && s.log.length === s.pick ? { log: [...s.log, { team: teamIdx, slot, id: pokemonId }] } : {}),
        ...(shiny ? { shinies: [...(s.shinies ?? []), pokemonId] } : {}),
        selected: null,
        phase: pick >= s.teams.length * ROUNDS ? (s.teams.some((x) => !x.cpu) ? 'captains' : 'league') : 'drafting',
        seed: pick >= s.teams.length * ROUNDS ? randomSeed() : s.seed,
        ...(pick >= s.teams.length * ROUNDS ? { model: 'draft' as const, cpuCaptains: true as const } : {}),
      };
    });

  /** Rückgängig: nimmt Picks bis einschließlich des letzten menschlichen zurück (CPU-Picks danach ebenso) */
  const lastHumanPick = state.log ? state.log.map((x) => !state.teams[x.team]?.cpu).lastIndexOf(true) : -1;
  const canUndo = state.phase === 'drafting' && !!team && !team.cpu && lastHumanPick >= 0 && state.log!.length === state.pick;
  const undo = () =>
    setState((s) => {
      if (!s.log || s.log.length !== s.pick) return s;
      const from = s.log.map((x) => !s.teams[x.team]?.cpu).lastIndexOf(true);
      if (from < 0) return s;
      const removed = s.log.slice(from);
      const gone = new Set(removed.map((x) => x.id));
      const teams = s.teams.map((tm, i) => {
        const mine = removed.filter((x) => x.team === i);
        return mine.length ? { ...tm, slots: tm.slots.map((v, j) => (mine.some((x) => x.slot === j) ? null : v)) } : tm;
      });
      return {
        ...s,
        teams,
        pick: from,
        log: s.log.slice(0, from),
        shinies: (s.shinies ?? []).filter((id) => !gone.has(id)),
        selected: null,
      };
    });

  // Neuer Shiny: kurz melden (wie im Online-Draft)
  const shinyCount = state.shinies?.length ?? 0;
  const shinySeen = useRef(shinyCount);
  useEffect(() => {
    if (shinyCount <= shinySeen.current) {
      shinySeen.current = shinyCount;
      return;
    }
    shinySeen.current = shinyCount;
    const id = state.shinies![shinyCount - 1];
    const mon = byId.get(id);
    if (mon) toast(t.shiny.picked(t.game.pokemon(mon), shinyTeamBoost(mon)));
  }, [shinyCount]);

  const suggest = () => {
    // Vorschlag wie der CPU-Pick, nur ohne Zufall: bestes Pokémon für einen freien Platz
    if (!team || team.cpu) return;
    const sc = scale('all');
    let best: { score: number; id: number } | null = null;
    for (const [slot, d] of FORMATIONS[team.formation].slots.entries()) {
      if (team.slots[slot] != null) continue;
      for (const p of pool) {
        const score = positionFit(p, d.pos, sc) * (0.92 + 0.08 * POSITIONS[d.pos].teamWeight);
        if (!best || score > best.score) best = { score, id: p.id };
      }
    }
    if (best) setState((s) => ({ ...s, selected: best!.id }));
  };
  // 🎲 Zufall: ein zufälliges freies Pokémon vormerken (wie online; übernommen wird mit Tippen auf den Platz)
  const randomPick = () => {
    if (!team || team.cpu || !pool.length) return;
    const mon = pool[Math.floor(Math.random() * pool.length)];
    setState((s) => ({ ...s, selected: mon.id }));
  };
  // Taste „V“: Vorschlag, Taste „R“: 🎲 Zufall (wie online; nicht beim Tippen)
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const randomRef = useRef(randomPick);
  randomRef.current = randomPick;
  // Taste Z: Rückgängig (nur wenn der Knopf da ist)
  const undoRef = useRef<(() => void) | null>(null);
  undoRef.current = canUndo ? undo : null;
  useEffect(() => {
    if (state.phase !== 'drafting') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      if (key !== 'v' && key !== 'z' && key !== 'r') return;
      if (typingElsewhere(e.target)) return;
      if (key === 'z') {
        if (!undoRef.current) return;
        e.preventDefault();
        undoRef.current();
        return;
      }
      e.preventDefault();
      if (key === 'r') randomRef.current();
      else suggestRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.phase]);

  // Pick-Uhr (optional): je menschlichem Zug neu; bei 0 wählt der Draft automatisch (wie „Automatisch für … wählen“)
  const [clockLeft, setClockLeft] = useState<number | null>(null);
  const autoRef = useRef<() => void>(() => {});
  autoRef.current = () => {
    if (!team || team.cpu) return;
    const best = cpuPickChoice(team, pool, scale('all'), 'hard', () => 0.5);
    if (best) lock(currentTeam, best.slot, best.id);
  };
  useEffect(() => {
    const secs = state.pickSeconds;
    if (state.phase !== 'drafting' || !secs || !team || team.cpu) {
      setClockLeft(null);
      return;
    }
    const deadline = Date.now() + secs * 1000;
    setClockLeft(secs);
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setClockLeft(left);
      if (left === 0) {
        window.clearInterval(timer);
        autoRef.current();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [state.phase, state.pick, state.pickSeconds]);

  // „Schneller“: CPU-Picks bis zum nächsten menschlichen Zug ohne Bedenkzeit (gilt nur bis dahin)
  const [fastCpu, setFastCpu] = useState(false);
  useEffect(() => {
    if (fastCpu && (!team || !team.cpu || state.phase !== 'drafting')) setFastCpu(false);
  }, [fastCpu, team, state.phase]);

  // CPU-Picks: beste Kombination aus Pokémon und freiem Slot nach Fit – mit etwas Zufall (je nach CPU-Stärke).
  useEffect(() => {
    if (state.phase !== 'drafting' || !team?.cpu) return;
    const timer = window.setTimeout(
      () => {
        const best = cpuPickChoice(team, pool, scale('all'), cpuLevelOf(state.cpuLevel), createRng(randomSeed()));
        if (best) lock(currentTeam, best.slot, best.id);
      },
      fastCpu ? 40 : 550,
    );
    return () => window.clearTimeout(timer);
  }, [state.phase, state.pick, fastCpu]);

  const start = () => {
    setState((s) => ({
      ...s,
      phase: 'drafting',
      pick: 0,
      selected: null,
      seed: null,
      shinySalt: s.noShinies ? undefined : randomSeed(),
      shinies: [],
      log: [],
      teams: s.teams.map((tm) => ({ ...tm, slots: emptySlots(tm.formation) })),
    }));
    setFilters({ query: '', type: null, region: state.region });
  };

  const setTeamCount = (count: number) =>
    setState((s) => {
      const teams = s.teams.slice(0, count);
      const free = cpuNames(teams.map((tm) => tm.name));
      while (teams.length < count) {
        const formation = FORMATION_IDS[teams.length % FORMATION_IDS.length];
        teams.push({ name: free.shift() ?? `Team ${teams.length + 1}`, cpu: true, formation, slots: emptySlots(formation) });
      }
      return { ...s, teams };
    });

  const updateTeam = (i: number, patch: Partial<DraftTeam>) =>
    setState((s) => ({
      ...s,
      teams: s.teams.map((tm, j) =>
        j === i ? { ...tm, ...patch, slots: patch.formation ? emptySlots(patch.formation) : tm.slots } : tm,
      ),
    }));

  const reset = () => setState({ ...INITIAL, teams: defaultTeams(state.teams.length) });

  /** Satzbaustein für die Pool-Beschreibung wie im Builder: „aus Kanto (Nr. 1–151)" */
  const poolPhrase = useMemo(() => {
    const rp = t.common.regionPhrase;
    const r = state.region === 0 ? undefined : REGIONS[state.region - 1];
    if (!r) return rp.all;
    return r.gen === 1 ? rp.first151 : rp.range(t.game.region[r.gen], r.from, r.to);
  }, [state.region, t]);

  /** Team-Score eines Teams wie in der Liga (Kapitän zählt doppelt, Shinys mit Bonus) */
  const teamRating = (tm: DraftTeam): number => {
    const players = tm.slots.map((id) => (id != null ? byId.get(id) ?? null : null));
    const shinies = state.shinies?.length ? new Set(state.shinies) : undefined;
    const ev = evaluateTeam(tm.formation, players, scale('all'), captainOf(tm), shinies ? (id) => (shinies.has(id) ? SHINY_FIT_BONUS : 0) : undefined);
    return Math.min(1000, ev.score + shinyBonus(players, shinies));
  };

  // ---------- Liga ----------
  const league = useMemo(() => {
    if (state.phase !== 'league' || state.seed == null) return null;
    const leagueTeams: LeagueTeam[] = state.teams.map((tm) => {
      const players = tm.slots.map((id) => (id != null ? byId.get(id) ?? null : null));
      const defs = FORMATIONS[tm.formation].slots;
      return {
        name: tm.name,
        rating: teamRating(tm),
        isUser: !tm.cpu,
        squad: players.flatMap((p, i) => (p ? [{ pokemonId: p.id, pos: defs[i].pos, atk: p.atk, spa: p.spa }] : [])),
      };
    });
    const result = simulateLeague(leagueTeams, createRng(state.seed), state.model === 'draft' ? DRAFT_MODEL : CLASSIC_MODEL);
    const scorers = new Map<number, { id: number; team: number; goals: number }>();
    for (const m of result.matches) {
      for (const [team, goals] of [
        [m.home, m.homeScorers],
        [m.away, m.awayScorers],
      ] as const) {
        for (const g of goals) {
          const s = scorers.get(g.pokemonId) ?? { id: g.pokemonId, team, goals: 0 };
          s.goals++;
          scorers.set(g.pokemonId, s);
        }
      }
    }
    return { ...result, scorers: [...scorers.values()].sort((a, b) => b.goals - a.goals).slice(0, 10) };
  }, [state.phase, state.seed, state.model, state.teams, state.shinies, state.cpuCaptains, byId, scale]);

  // Meisterchancen: dieselben Teams 50-mal neu ausgespielt (Seeds aus dem Liga-Seed abgeleitet → stabil)
  const titleOdds = useMemo(() => {
    if (!league || state.seed == null || league.teams.length < 2) return null;
    const model = state.model === 'draft' ? DRAFT_MODEL : CLASSIC_MODEL;
    const wins = new Array<number>(league.teams.length).fill(0);
    for (let k = 1; k <= TITLE_RUNS; k++) wins[simulateLeague(league.teams, createRng(state.seed + k * 7919), model).table[0].team]++;
    return wins;
  }, [league, state.seed, state.model]);

  // Titelsammlung: Meister jeder ausgespielten lokalen Liga (einmal je Seed, die letzten 50)
  const [champions, setChampions] = useState<LocalChampion[]>(() => load<LocalChampion[]>(STORAGE_KEYS.draftChampions, []));
  useEffect(() => {
    if (!league || state.seed == null || !league.table.length) return;
    const seed = state.seed;
    const name = state.teams[league.table[0].team]?.name;
    if (!name) return;
    setChampions((list) => {
      if (list.some((c) => c.seed === seed)) return list;
      const next = [...list, { seed, name }].slice(-50);
      save(STORAGE_KEYS.draftChampions, next);
      return next;
    });
  }, [league, state.seed, state.teams]);

  // Spielwiedergabe (2D/Bericht) der lokalen Liga – jedes Team mit seiner gedrafteten Elf
  const report = useMatchReport(
    (i) => teamName(state.teams[i]?.name ?? ''),
    (id) => {
      const p = byId.get(id);
      return p ? t.game.pokemon(p) : `#${id}`;
    },
    (m) => tx.roundNo(m.round),
    undefined,
    (i) => (state.teams[i] ? { formation: state.teams[i].formation, ids: state.teams[i].slots, jerseys: cleanJerseys(state.teams[i].jerseys), captain: captainOf(state.teams[i]), kit: cleanKit(state.teams[i].kit), cheer: cleanCheer(state.teams[i].cheer), crest: cleanCrest(state.teams[i].crest), shinies: state.shinies } : null),
  );

  if (state.phase === 'setup') {
    return (
      <div className="page draft">
        {modeSwitch}
        <header className="page-head">
          <h1 className="page-title">{tx.title}</h1>
          <p className="page-lead">{tx.lead}</p>
        </header>
        <div className="draft__setup">
          <section className="card" aria-labelledby="draft-teams">
            <h2 id="draft-teams" className="section-title">
              {t.draft.teams}
            </h2>
            <Segmented
              label={tx.teamCount}
              value={n}
              onChange={setTeamCount}
              options={[2, 3, 4, 5, 6, 7, 8].map((v) => ({ value: v, label: String(v) }))}
              wrap
            />
            <ol className="draft__teamlist">
              {state.teams.map((tm, i) => (
                <li key={i} className="draft__teamrow">
                  <span className="draft__no">{i + 1}</span>
                  <input
                    className="input"
                    aria-label={tx.teamNameAria(i + 1)}
                    value={teamName(tm.name)}
                    maxLength={28}
                    onChange={(e) => updateTeam(i, { name: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost random-name"
                    title={t.common.randomName}
                    aria-label={t.common.randomName}
                    // Ranglisten-Team oder deutscher Vereinsname (übersetzt erst bei der Anzeige), keiner doppelt
                    onClick={() => {
                      const free = cpuNames(state.teams.map((x) => x.name));
                      if (free.length) updateTeam(i, { name: free[0] });
                    }}
                  >
                    <span aria-hidden="true">🎲</span>
                  </button>
                  <select
                    className="input select"
                    aria-label={tx.teamFormationAria(i + 1)}
                    value={tm.formation}
                    onChange={(e) => updateTeam(i, { formation: e.target.value as FormationId })}
                  >
                    {FORMATION_IDS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`btn btn--small ${tm.cpu ? '' : 'btn--accent'}`}
                    aria-pressed={!tm.cpu}
                    onClick={() => updateTeam(i, { cpu: !tm.cpu })}
                  >
                    {tm.cpu ? t.draft.cpu : tx.human}
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="btn btn--small draft__shuffle"
              // Reihenfolge der Liste = Draft-Reihenfolge (Snake); Mischen nur in der Oberfläche
              onClick={() => setState((s) => ({ ...s, teams: shuffle(Math.random, s.teams) }))}
            >
              {t.online.shuffleOrder}
            </button>
            {/* Pick-Nummern der menschlichen Teams (Reihenfolge der Liste, Snake) */}
            {state.teams.some((tm) => !tm.cpu) && (
              <ul className="small draft__teampicks">
                {state.teams.map((tm, i) =>
                  tm.cpu ? null : <li key={i}>{tx.teamPicks(teamName(tm.name), pickNumbersLabel(i, n, n * ROUNDS))}</li>,
                )}
              </ul>
            )}
            <p className="muted small">{tx.hotSeatNote}</p>
          </section>
          <section className="card" aria-labelledby="draft-pool">
            <h2 id="draft-pool" className="section-title">
              {t.draft.pool}
            </h2>
            {(() => {
              // Schnellstart: mehrere Pool-Regeln auf einmal (Shinys an, Party nur bei der Vorlage)
              const apply = (id: LocalPresetId) =>
                setState(({ noShinies: _off, shinyParty: _party, ...s }) => {
                  const p = LOCAL_PRESETS[id];
                  return { ...s, region: p.region, legends: p.legends, forms: p.forms, megas: p.megas, ...(p.shinyParty ? { shinyParty: true as const } : {}) };
                });
              return (
                <div className="field draft-presets">
                  <span className="field__label">{t.online.presets}</span>
                  <div className="chips">
                    {LOCAL_PRESET_IDS.map((id) => (
                      <button key={id} type="button" className="chip" title={tx.localPresetNote[id]} onClick={() => apply(id)}>
                        {t.online.presetName[id]}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="chip draft-presets__random"
                      title={t.online.presetRandomTitle}
                      onClick={() => apply(LOCAL_PRESET_IDS[Math.floor(Math.random() * LOCAL_PRESET_IDS.length)])}
                    >
                      🎲 {t.online.presetRandom}
                    </button>
                  </div>
                </div>
              );
            })()}
            <Segmented
              label={tx.region}
              wrap
              value={state.region}
              onChange={(region) => setState((s) => ({ ...s, region }))}
              options={[
                ...REGIONS.map((r) => ({ value: r.gen as RegionFilter, label: t.game.region[r.gen] })),
                { value: 0 as RegionFilter, label: t.game.allRegions },
              ]}
            />
            <Segmented
              label={tx.legendsLabel}
              value={state.legends}
              onChange={(legends) => setState((s) => ({ ...s, legends }))}
              options={[
                { value: false, label: tx.pokemon },
                { value: true, label: tx.legends },
              ]}
            />
            <p className="settings__desc">{tx.poolDesc(poolPhrase, state.legends)}</p>
            <Segmented
              label={t.builder.forms}
              value={!!state.forms}
              onChange={(forms) => setState((s) => ({ ...s, forms }))}
              options={[
                { value: false, label: t.common.off },
                { value: true, label: t.common.on },
              ]}
            />
            <Segmented
              label={t.draft.settings.maxMegas}
              value={megas}
              onChange={(m) => setState((s) => ({ ...s, megas: m }))}
              options={MEGA_OPTIONS.map((m) =>
                m === 0
                  ? { value: m, label: t.common.off }
                  : m === MEGAS_UNLIMITED
                    ? { value: m, label: '∞', title: t.builder.megasUnlimited }
                    : { value: m, label: String(m) },
              )}
            />
            <Segmented
              label={t.draft.settings.shinies}
              value={state.noShinies ? 'off' : state.shinyParty ? 'party' : 'on'}
              onChange={(v) =>
                setState(({ noShinies: _off, shinyParty: _party, ...s }) =>
                  v === 'off' ? { ...s, noShinies: true } : v === 'party' ? { ...s, shinyParty: true } : s,
                )
              }
              options={[
                { value: 'off', label: t.common.off },
                { value: 'on', label: t.common.on, title: t.draft.settings.shiniesTitle },
                { value: 'party', label: t.draft.settings.shinyParty, title: t.draft.settings.shinyPartyTitle },
              ]}
            />
            <Segmented
              label={tx.cpuLevel}
              value={state.cpuLevel ?? 'normal'}
              onChange={(v) => setState(({ cpuLevel: _l, ...s }) => (v === 'normal' ? s : { ...s, cpuLevel: v }))}
              options={[
                { value: 'easy', label: tx.cpuLevels.easy, title: tx.cpuLevelTitles.easy },
                { value: 'normal', label: tx.cpuLevels.normal, title: tx.cpuLevelTitles.normal },
                { value: 'hard', label: tx.cpuLevels.hard, title: tx.cpuLevelTitles.hard },
              ]}
            />
            <Segmented
              label={tx.pickClock}
              value={state.pickSeconds ?? 0}
              onChange={(v) => setState(({ pickSeconds: _p, ...s }) => (v ? { ...s, pickSeconds: v } : s))}
              options={LOCAL_PICK_SECONDS.map((v) => ({ value: v, label: v ? t.online.timerSeconds(v) : t.common.off }))}
            />
            {poolTooSmall && <p className="notice notice--error">{tx.poolTooSmall(poolSize, n, ROUNDS, n * ROUNDS)}</p>}
            <button type="button" className="btn btn--primary btn--big" onClick={start} disabled={poolTooSmall}>
              {tx.start}
            </button>
          </section>
          {/* Die stärksten Pokémon der gewählten Einstellungen – wie in der Online-Lobby */}
          {!poolTooSmall && <PoolStars pool={pool} scale={scale('all')} formations={state.teams.map((tm) => tm.formation)} />}
        </div>
      </div>
    );
  }

  if (state.phase === 'captains') {
    return (
      <div className="page draft">
        {modeSwitch}
        <section className="card" aria-labelledby="draft-captains-title">
          <h1 id="draft-captains-title" className="section-title">
            {t.captain.localTitle}
          </h1>
          <p className="muted small">{t.captain.localNote}</p>
          {(() => {
            // Vor dem Anpfiff: Favorit nach Team-Score und der Rang jedes menschlichen Teams (wie online)
            const ratings = state.teams.map(teamRating);
            const fav = ratings.reduce((a, r, i) => (r > ratings[a] ? i : a), 0);
            const ranks = state.teams.flatMap((tm, i) =>
              tm.cpu ? [] : [`${teamName(tm.name)}: ${ratings.filter((r) => r > ratings[i]).length + 1}.`],
            );
            return (
              <p className="small muted draft__odds">
                {t.captain.favorite(teamName(state.teams[fav].name), Math.round(ratings[fav]))} · {tx.humanRanks(ranks.join(', '))}
              </p>
            );
          })()}
        </section>
        <section className="draft__rosters" aria-label={tx.squads}>
          {state.teams.map((tm, i) =>
            tm.cpu ? null : (
              <div key={i} className="card draft__roster">
                <h3 className="section-title">{teamName(tm.name)}</h3>
                <Pitch
                  formation={tm.formation}
                  slots={tm.slots}
                  sprite={sprite}
                  ariaLabel={tx.squadAria(teamName(tm.name))}
                  jerseys={tm.jerseys}
                  captain={tm.captain ?? null}
                  shinies={state.shinies}
                />
                <CaptainPicker
                  formation={tm.formation}
                  slots={tm.slots}
                  captain={tm.captain ?? null}
                  onChange={(captain) => setState((s) => ({ ...s, teams: s.teams.map((x, j) => (j === i ? { ...x, captain } : x)) }))}
                />
              </div>
            ),
          )}
        </section>
        <div className="actionbar">
          {state.teams.some((tm) => !tm.cpu && tm.captain == null) && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  teams: s.teams.map((x) =>
                    x.cpu || x.captain != null ? x : { ...x, captain: bestCaptain(x.formation, x.slots.map((id) => (id != null ? byId.get(id) : undefined)), scale('all')) },
                  ),
                }))
              }
            >
              {t.captain.bestForAll(state.teams.filter((tm) => !tm.cpu && tm.captain == null).length)}
            </button>
          )}
          <button type="button" className="btn btn--primary btn--big" onClick={() => setState((s) => ({ ...s, phase: 'league' }))}>
            {t.captain.kickoff}
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'league' && league) {
    const c = t.draft.col;
    const monName = (id: number) => {
      const p = byId.get(id);
      return p ? t.game.pokemon(p) : `#${id}`;
    };
    const grades = draftGrades(league.teams.map((tm) => tm.rating));
    const champion = league.table[0];
    return (
      <div className="page draft">
        {modeSwitch}
        <header className="page-head">
          <h1 className="page-title">{tx.leagueTitle}</h1>
          <p className="page-lead">{tx.leagueLead(league.matches.length)}</p>
          {/* Meister ist ein menschliches Team: Konfetti wie im Online-Ergebnis */}
          {champion && state.teams[champion.team] && !state.teams[champion.team].cpu && <Confetti />}
          {champion && (
            <p className="draft__champion">
              <span aria-hidden="true">★ </span>
              {t.draft.results.championLabel}
              <strong>{teamName(champion.name)}</strong> · {t.draft.results.heroLine(champion, champion.rating)}
            </p>
          )}
          {/* Platz jedes menschlichen Teams (Hot-Seat: auch mehrere) */}
          {league.table.map((r, i) =>
            state.teams[r.team] && !state.teams[r.team].cpu ? (
              <p key={r.team} className="draft__you">
                {/* Standardname „Mein Team“: ohne Namen, sonst hieße es „Dein Team Mein Team“ */}
                {r.name === OWN_TEAM ? t.draft.manager.yourPlace(i + 1, r.pts) : t.draft.results.yourPlace(teamName(r.name), i + 1, r.pts)}
              </p>
            ) : null,
          )}
          {champion && (
            <button
              type="button"
              className="btn btn--small draft__share"
              onClick={async () => {
                // Wie online: Teilen-Menü, sonst (oder wenn nicht erlaubt) in die Zwischenablage
                const humans = league.table.flatMap((r, i) => (state.teams[r.team] && !state.teams[r.team].cpu ? [{ name: r.name === OWN_TEAM ? null : teamName(r.name), place: i + 1 }] : []));
                const text = localShareText(teamName(champion.name), champion.pts, humans, `${location.origin}/draft`);
                if (typeof navigator.share === 'function') {
                  try {
                    await navigator.share({ text });
                    return;
                  } catch (e) {
                    if ((e as Error).name === 'AbortError') return;
                  }
                }
                toast((await copyText(text)) ? t.draft.results.copied : t.draft.results.copyFailed);
              }}
            >
              {t.draft.results.share}
            </button>
          )}
        </header>
        <div className="result-grid">
          <section className="card" aria-labelledby="draft-table">
            <h2 id="draft-table" className="section-title">
              {t.draft.table}
            </h2>
            <Segmented
              label={t.draft.results.tableView}
              hideLabel
              value={tableView}
              onChange={setTableView}
              options={(['all', 'home', 'away'] as const).map((v) => ({ value: v, label: t.draft.results.tableViews[v] }))}
            />
            <div className="table-scroll">
              <table className="league-table">
                <thead>
                  <tr>
                    <th>{c.place}</th>
                    <th className="left">{c.team}</th>
                    <th>{c.score}</th>
                    <th title={t.draft.results.gradeTitle}>{t.draft.results.grade}</th>
                    <th>{c.played}</th>
                    <th>{c.won}</th>
                    <th>{c.drawn}</th>
                    <th>{c.lost}</th>
                    <th>{c.goals}</th>
                    <th>{c.diff}</th>
                    <th>{c.pts}</th>
                    <th title={c.formTitle} className="league-live__form-col">
                      {c.form}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(tableView === 'all' ? league.table : sideTable(league.teams, league.matches, tableView)).map((r, i) => (
                    <tr key={r.team} className={tableView === 'all' ? tableRowClass(r.isUser, i + 1, league.table.length) : r.isUser ? 'is-user' : ''}>
                      <td>{i + 1}</td>
                      <td className="left">
                        {cleanCrest(state.teams[r.team].crest) && (
                          <>
                            <Crest crest={cleanCrest(state.teams[r.team].crest)!} size={16} />{' '}
                          </>
                        )}
                        {teamName(r.name)} {state.teams[r.team].cpu && <span className="rating">{t.draft.cpu}</span>}
                      </td>
                      <td>{r.rating}</td>
                      <td className="draft__grade">{grades[r.team]}</td>
                      <td>{r.played}</td>
                      <td>{r.w}</td>
                      <td>{r.d}</td>
                      <td>{r.l}</td>
                      <td>
                        {`${r.gf}:${r.ga}`}
                      </td>
                      <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                      <td>
                        <strong>{r.pts}</strong>
                      </td>
                      <td className="league-live__form-col">
                        <FormDots form={recentForm(tableView === 'all' ? league.matches : league.matches.filter((m) => (tableView === 'home' ? m.home : m.away) === r.team), r.team, Infinity)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tableView === 'all' && <TableLegend total={league.table.length} />}
          </section>
          <section className="card" aria-labelledby="draft-scorers">
            <h2 id="draft-scorers" className="section-title">
              {t.draft.topScorers}
            </h2>
            <ol className="scorers">
              {league.scorers.map((s, i) => {
                const p = byId.get(s.id);
                return (
                  <li key={s.id}>
                    {/* Raster wie überall: Platz, Sprite, Name, Tore */}
                    <span className="muted">{i + 1}.</span>
                    {p ? <Sprite pokemon={p} style={sprite} className="scorers__sprite" /> : <span aria-hidden="true" />}
                    <span className="scorers__name">
                      {p && t.game.pokemon(p)}{' '}
                      {captainOf(state.teams[s.team]) === s.id && (
                        <>
                          <span className="captain-badge" title={t.captain.title}>
                            C<span className="sr-only"> – {t.captain.title}</span>
                          </span>{' '}
                        </>
                      )}
                      <small className="muted">{teamName(state.teams[s.team].name)}</small>
                    </span>
                    <span className="scorers__goals">{s.goals}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
        {/* Vorlagen, Scorerpunkte und Teamwerte wie im Online-Draft (Torjäger stehen schon oben) */}
        <SeasonStats
          league={league}
          you={(() => {
            const i = state.teams.findIndex((tm) => !tm.cpu);
            return i < 0 ? null : i;
          })()}
          nameOf={(i) => teamName(state.teams[i].name)}
          tabs={['assists', 'points', 'teams']}
          captains={state.teams.map((tm) => captainOf(tm))}
        />
        {(() => {
          // Saisonverlauf des (ersten) menschlichen Teams – wie im Online-Draft
          const you = state.teams.findIndex((tm) => !tm.cpu);
          const days = leagueTimeline(league);
          if (you < 0 || days.length < 2) return null;
          return (
            <section className="card" aria-labelledby="draft-local-chart">
              <h2 id="draft-local-chart" className="section-title">
                {t.draft.results.placeChart}
              </h2>
              <PlaceChart places={days.map((d) => d.places[you])} teams={league.teams.length} />
            </section>
          );
        })()}
        {(() => {
          // Zeitreise: Tabelle nach jedem Spieltag – wie im Online-Draft
          const days = leagueTimeline(league);
          if (days.length < 2) return null;
          const you = state.teams.findIndex((tm) => !tm.cpu);
          return (
            <section className="card" aria-labelledby="draft-local-timetravel">
              <h2 id="draft-local-timetravel" className="section-title">
                {t.draft.results.timeTravel}
              </h2>
              <TableTimeTravel days={days} you={you < 0 ? null : you} nameOf={(i) => teamName(state.teams[i].name)} />
            </section>
          );
        })()}
        {(() => {
          // Deine Duelle: Bilanz des (ersten) menschlichen Teams gegen jeden Gegner – wie im Online-Draft
          const you = state.teams.findIndex((tm) => !tm.cpu);
          const duels = you < 0 ? [] : headToHead(league, you);
          if (duels.length === 0) return null;
          const r = t.draft.results;
          return (
            <section className="card" aria-labelledby="draft-local-duels">
              <h2 id="draft-local-duels" className="section-title">
                {r.duels}
              </h2>
              <div className="table-scroll">
                <table className="league-table draft-results__duels">
                  <thead>
                    <tr>
                      <th scope="col" className="left">
                        {r.duelsOpponent}
                      </th>
                      <th scope="col" className="left">
                        {r.duelsScores}
                      </th>
                      <th scope="col" title={r.duelsRecordTitle}>
                        {r.duelsRecord}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {duels.map((d) => (
                      <tr key={d.opponent} className={d.w > d.l ? 'is-up' : d.l > d.w ? 'is-down' : ''}>
                        <th scope="row" className="left">
                          {teamName(state.teams[d.opponent].name)}
                        </th>
                        <td className="left">
                          {d.scores.map((x, i) => (
                            <span key={i} className="draft-results__duel" title={x.home ? r.duelHome : r.duelAway}>
                              {x.gf}:{x.ga}
                            </span>
                          ))}
                        </td>
                        <td>
                          <strong>{formatRecord({ w: d.w, d: d.d, l: d.l })}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })()}
        {league.table.length > 1 && (() => {
          // Saisonrekorde wie im Online-Draft (ohne Pick-Tempo – lokal gibt es keine Uhr)
          const r = t.draft.results;
          const nameOf = (i: number) => teamName(state.teams[i].name);
          const tb = league.table;
          const attack = tb.reduce((a, b) => (b.gf > a.gf ? b : a));
          const defense = tb.reduce((a, b) => (b.ga < a.ga ? b : a));
          const draws = tb.reduce((a, b) => (b.d > a.d ? b : a));
          const bigWin = biggestWin(league.matches);
          const fest = goalFest(league.matches);
          const comeback = comebackOf(league.matches);
          const streak = longestWinStreak(league);
          const ratings: number[] = [];
          for (const row of tb) ratings[row.team] = row.rating;
          const { up, down } = seasonSwings(tb.map((row) => row.team), ratings);
          const line = (m: NonNullable<typeof bigWin>) => r.recordWinLine(nameOf(m.home), `${m.hg}:${m.ag}`, nameOf(m.away), m.round);
          // Herbstmeister und Rückrunden-Tabelle (doppelte Runde, ab 4 Spieltagen) – wie online
          const days = leagueTimeline(league);
          const half = days.length >= 4 && days.length % 2 === 0 ? days[days.length / 2 - 1] : null;
          const second = half ? buildTable(league.teams, league.matches.filter((m) => m.round > half.round))[0] : null;
          return (
            <section className="card" aria-labelledby="draft-local-records">
              <h2 id="draft-local-records" className="section-title">
                {r.records}
              </h2>
              {(() => {
                // Schnäppchen des Drafts (bester Pick der zweiten Hälfte nach Fit) – nur mit vollständigem Pick-Verlauf
                const log = state.log;
                if (!log || log.length !== state.teams.length * ROUNDS) return null;
                const steal = draftSteal(
                  log.map((x, i) => ({ pick: i, teamId: String(x.team), pokemonId: x.id, slot: x.slot })),
                  state.teams.map((tm, i) => ({ id: String(i), formation: tm.formation })),
                  byId,
                  scale('all'),
                );
                const mon = steal ? byId.get(steal.pokemonId) : undefined;
                if (!steal || !mon) return null;
                return (
                  <p className="draft-results__steal">
                    {r.steal(t.game.pokemon(mon), steal.pick + 1, nameOf(Number(steal.teamId)), t.game.posName[steal.pos])}
                  </p>
                );
              })()}
              <dl className="draft-records">
                <div>
                  <dt>{r.recordAttack}</dt>
                  <dd>{r.recordGoals(nameOf(attack.team), attack.gf)}</dd>
                </div>
                <div>
                  <dt>{r.recordDefense}</dt>
                  <dd>{r.recordConceded(nameOf(defense.team), defense.ga)}</dd>
                </div>
                {draws.d >= 4 && (
                  <div>
                    <dt>{r.recordDraws}</dt>
                    <dd>{r.recordDrawsLine(nameOf(draws.team), draws.d)}</dd>
                  </div>
                )}
                {(() => {
                  const clean = mostCleanSheets(league.matches, tb.map((x) => x.team));
                  return clean ? (
                    <div>
                      <dt>{r.recordClean}</dt>
                      <dd>{r.recordCleanLine(nameOf(clean.team), clean.n)}</dd>
                    </div>
                  ) : null;
                })()}
                {half && (
                  <div>
                    <dt>{r.recordHalf}</dt>
                    <dd>{r.recordHalfLine(nameOf(half.leader.team), half.leader.pts, half.round)}</dd>
                  </div>
                )}
                {second && (
                  <div>
                    <dt>{r.recordSecond}</dt>
                    <dd>{r.recordSecondLine(nameOf(second.team), second.pts)}</dd>
                  </div>
                )}
                {bigWin && (
                  <div>
                    <dt>{r.recordWin}</dt>
                    <dd>{line(bigWin)}</dd>
                  </div>
                )}
                {(() => {
                  // Hattricks der Saison: Anzahl und der erste (wie online)
                  const hats = hatTricks(league.matches);
                  const first = hats[0];
                  const mon = first ? byId.get(first.pokemonId) : undefined;
                  return first && mon ? (
                    <div>
                      <dt>{r.recordHatTricks}</dt>
                      <dd>{r.recordHatTricksLine(hats.length, t.game.pokemon(mon), nameOf(first.team), first.round)}</dd>
                    </div>
                  ) : null;
                })()}
                {fest && fest !== bigWin && (
                  <div>
                    <dt>{r.recordFest}</dt>
                    <dd>{line(fest)}</dd>
                  </div>
                )}
                {comeback && (
                  // 🔄 Größtes Comeback der Saison
                  <div>
                    <dt>{r.recordComeback}</dt>
                    <dd>
                      {r.recordComebackLine(
                        nameOf(comeback.winner),
                        `${comeback.behind[0]}:${comeback.behind[1]}`,
                        comeback.match.home === comeback.winner ? `${comeback.match.hg}:${comeback.match.ag}` : `${comeback.match.ag}:${comeback.match.hg}`,
                        nameOf(comeback.loser),
                        comeback.match.round,
                      )}
                    </dd>
                  </div>
                )}
                {up && up.delta >= 2 && (
                  <div>
                    <dt>{r.recordSurprise}</dt>
                    <dd>{r.recordSwingLine(nameOf(up.team), up.delta)}</dd>
                  </div>
                )}
                {down && down.delta <= -2 && (
                  <div>
                    <dt>{r.recordFlop}</dt>
                    <dd>{r.recordSwingLine(nameOf(down.team), down.delta)}</dd>
                  </div>
                )}
                {streak && streak.length >= 3 && (
                  <div>
                    <dt>{r.recordStreak}</dt>
                    <dd>{r.streak(nameOf(streak.team), streak.length, streak.from, streak.to)}</dd>
                  </div>
                )}
              </dl>
            </section>
          );
        })()}
        {titleOdds && (() => {
          // Meisterchancen: wie oft jedes Team bei 50 Neuausspielungen Meister würde (höchstens 5 Teams)
          const rows = titleOdds
            .map((n, team) => ({ team, pct: Math.round((n / TITLE_RUNS) * 100) }))
            .filter((r) => r.pct > 0)
            .sort((a, b) => b.pct - a.pct)
            .slice(0, 5);
          const champ = league.table[0].team;
          return (
            <section className="card" aria-labelledby="draft-local-odds">
              <h2 id="draft-local-odds" className="section-title">
                {tx.oddsTitle}
              </h2>
              <ol className="draft__titles">
                {rows.map((r) => (
                  <li key={r.team} className={state.teams[r.team].cpu ? '' : 'is-user'}>
                    <span>
                      {teamName(state.teams[r.team].name)}
                      {r.team === champ && ' 🏆'}
                    </span>{' '}
                    <strong>{r.pct} %</strong>
                  </li>
                ))}
              </ol>
              <p className="muted small">{tx.oddsNote(TITLE_RUNS)}</p>
            </section>
          );
        })()}
        {champions.length >= 2 && (() => {
          // Titelsammlung über alle lokalen Ligen auf diesem Gerät (ab zwei Ligen)
          const counts = new Map<string, number>();
          for (const c of champions) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
          const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
          return (
            <section className="card" aria-labelledby="draft-local-titles">
              <h2 id="draft-local-titles" className="section-title">
                {tx.titlesTitle}
              </h2>
              <ol className="draft__titles">
                {rows.map(([name, n]) => (
                  <li key={name}>
                    <span>{teamName(name)}</span> <strong>{tx.titlesCount(n)}</strong>
                  </li>
                ))}
              </ol>
              <p className="muted small">{tx.titlesNote(champions.length)}</p>
            </section>
          );
        })()}
        {state.teams.length >= 2 && (() => {
          // Elf der Saison wie im Online-Draft: beste Scorer je Position über alle Teams
          const eleven = seasonEleven(league, state.teams, byId, scale('all'));
          if (!eleven) return null;
          return (
            <section className="card draft-results__eleven" aria-labelledby="draft-eleven" ref={elevenRef}>
              <div className="draft-results__table-head">
                <h2 id="draft-eleven" className="section-title">
                  {t.draft.results.elevenTitle}
                </h2>
                <SaveImageButton
                  target={elevenRef}
                  filename="elf-der-saison.png"
                  label={t.draft.results.saveTable}
                  aria={t.draft.results.saveElevenAria}
                />
              </div>
              <p className="muted small">{t.draft.results.elevenNote(eleven.formation)}</p>
              <Pitch formation={eleven.formation} slots={eleven.slots} sprite={sprite} ariaLabel={t.draft.results.elevenTitle} jerseys={false} shinies={state.shinies} />
              <ul className="draft-results__eleven-list small">
                {eleven.slots.map((id, j) => {
                  const p = byId.get(id);
                  return (
                    <li key={id} className={state.teams[eleven.teamOf[j]]?.cpu ? '' : 'is-mine'}>
                      {p ? t.game.pokemon(p) : `#${id}`} <span className="muted">({teamName(state.teams[eleven.teamOf[j]].name)})</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })()}
        {league.table.length >= 2 && (() => {
          // Kreuztabelle: Zeile = Heimteam, Spalte = Gast, beide nach Abschlusstabelle geordnet
          const order = league.table.map((r) => r.team);
          const score = new Map(league.matches.map((m) => [`${m.home}-${m.away}`, m]));
          return (
            <details className="card details draft__cross">
              <summary>{tx.crossTitle}</summary>
              <p className="muted small">{tx.crossNote}</p>
              <div className="table-scroll">
                <table className="league-table draft__cross-table">
                  <thead>
                    <tr>
                      <th scope="col" className="left">
                        {t.draft.col.team}
                      </th>
                      {order.map((team, k) => (
                        <th key={team} scope="col" title={teamName(state.teams[team].name)}>
                          {k + 1}.
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order.map((home, k) => (
                      <tr key={home} className={state.teams[home].cpu ? '' : 'is-user'}>
                        <th scope="row" className="left">
                          {k + 1}. {teamName(state.teams[home].name)}
                        </th>
                        {order.map((away) => {
                          if (home === away) return <td key={away} className="draft__cross-self" aria-hidden="true" />;
                          const m = score.get(`${home}-${away}`);
                          const cls = !m ? '' : m.hg > m.ag ? 'is-S' : m.hg < m.ag ? 'is-N' : 'is-U';
                          return (
                            <td key={away} className={cls}>
                              {m ? `${m.hg}:${m.ag}` : '–'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })()}
        {state.log && state.log.length === state.teams.length * ROUNDS && (
          // Wo landeten die Stars des Pools? (wie im Online-Ergebnis; Pool ohne Mega-Limit je Team)
          <StarsLanded
            stars={poolStars(all.filter(inPool), scale('all')).map((x) => {
              const k = state.log!.findIndex((e) => e.id === x.pokemon.id);
              if (k < 0) return { pokemon: x.pokemon };
              const tm = state.teams[state.log![k].team];
              return { pokemon: x.pokemon, team: teamName(tm?.name ?? ''), pick: k + 1, mine: !!tm && !tm.cpu };
            })}
          />
        )}
        {state.log && state.log.length === state.teams.length * ROUNDS && (
          // Alle Picks in Reihenfolge – wie im Online-Ergebnis (nur mit Pick-Verlauf)
          <details className="card details draft-results__picks">
            <summary>{t.draft.results.allPicks(state.log.length)}</summary>
            <ol className="draft-results__picklist">
              {(() => {
                // 🏅 bester Pick jeder Runde (Fit an der jetzigen Position)
                const sc = scale('all');
                const best = roundBestPicks(
                  state.log.map((x) => {
                    const tm = state.teams[x.team];
                    const at = tm ? tm.slots.indexOf(x.id) : -1;
                    const pos = tm && at >= 0 ? FORMATIONS[tm.formation].slots[at]?.pos : undefined;
                    const mon = byId.get(x.id);
                    return mon && pos ? positionFit(mon, pos, sc) : null;
                  }),
                  state.teams.length,
                );
                return state.log.map((x, k) => {
                  const p = byId.get(x.id);
                  const round = Math.floor(k / state.teams.length) + 1;
                  return (
                    <li key={k} className={state.teams[x.team]?.cpu ? '' : 'is-you'}>
                      <span className="muted" title={t.draft.results.pickRound(round)}>
                        #{k + 1} · R{round}
                      </span>{' '}
                      <strong>{p ? t.game.pokemon(p) : `#${x.id}`}</strong>
                      {p && <KindMarks kinds={limitKindsOf(p)} />}
                      {state.shinies?.includes(x.id) && <span title={t.shiny.title}> ✨</span>} → {teamName(state.teams[x.team].name)}
                      {best.has(k) && <RoundBest />}
                    </li>
                  );
                });
              })()}
            </ol>
          </details>
        )}
        <details className="card details">
          <summary>{tx.allMatches}</summary>
          <ReplayToggle />
          {report.element}
          <ol className="matches">
            {league.matches.map((m, i) => (
              <li key={i} className="match match--league">
                <span className="match__round">{tx.roundNo(m.round)}</span>
                <span className="match__opp">
                  {teamName(state.teams[m.home].name)} – {teamName(state.teams[m.away].name)}
                </span>
                {report.open ? (
                  <button
                    type="button"
                    className="match__score match__score--btn"
                    aria-label={t.draft.report.open(teamName(state.teams[m.home].name), teamName(state.teams[m.away].name), `${m.hg}:${m.ag}`)}
                    title={t.draft.report.title}
                    onClick={() => report.open?.(m)}
                  >
                    {m.hg}:{m.ag}
                  </button>
                ) : (
                  <span className="match__score">
                    {m.hg}:{m.ag}
                  </span>
                )}
                {(m.homeScorers.length > 0 || m.awayScorers.length > 0) && (
                  <span className="match__scorers">
                    {[scorerSummary(m.homeScorers, monName), scorerSummary(m.awayScorers, monName)].filter(Boolean).join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </details>
        <section className="draft__rosters" aria-label={tx.squads}>
          {state.teams.map((tm, i) => (
            <div key={i} className="card draft__roster">
              <h3 className="section-title">
                {cleanCrest(tm.crest) && (
                  <>
                    <Crest crest={cleanCrest(tm.crest)!} size={20} />{' '}
                  </>
                )}
                {teamName(tm.name)}
              </h3>
              <Pitch
                formation={tm.formation}
                slots={tm.slots}
                sprite={sprite}
                ariaLabel={tx.squadAria(teamName(tm.name))}
                jerseys={tm.jerseys}
                captain={captainOf(tm)}
                shinies={state.shinies}
              />
              {(() => {
                // Shinys dieses Teams mit ihrem Team-Bonus
                const own = tm.slots.filter((id): id is number => id != null && !!state.shinies?.includes(id));
                if (!own.length) return null;
                const parts = own.flatMap((id) => {
                  const p = byId.get(id);
                  return p ? [`${t.game.pokemon(p)} +${shinyTeamBoost(p)}`] : [];
                });
                return <p className="small">✨ {parts.join(', ')}</p>;
              })()}
              {!tm.cpu && (
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={async () => {
                    // Teambild wie im Builder – mit Bilanz und Platz dieser Liga
                    const at = league.table.findIndex((r) => r.team === i);
                    const row = league.table[at];
                    try {
                      const blob = await lineupImage({
                        formation: tm.formation,
                        slots: tm.slots,
                        sprite,
                        byId,
                        teamName: teamName(tm.name),
                        subtitle: tm.formation,
                        result: row && {
                          record: formatRecord({ w: row.w, d: row.d, l: row.l }),
                          points: row.pts,
                          score: league.teams[i]?.rating ?? 0,
                          position: at + 1,
                          label: tx.localKicker,
                        },
                        jerseys: cleanJerseys(tm.jerseys),
                        captain: captainOf(tm),
                        crest: cleanCrest(tm.crest),
                        shinies: state.shinies,
                      });
                      downloadBlob(blob, `${slugify(teamName(tm.name) || 'pokemon-elf')}.png`);
                      toast(t.builder.imageSaved);
                    } catch (e) {
                      console.error(e);
                      toast(t.builder.imageFailed);
                    }
                  }}
                >
                  {t.builder.saveImage}
                </button>
              )}
              {!tm.cpu && (
                <KitPicker
                  kit={cleanKit(tm.kit)}
                  onChange={(kit) => setState((s) => ({ ...s, teams: s.teams.map((x, j) => (j === i ? { ...x, kit } : x)) }))}
                  cheer={cleanCheer(tm.cheer)}
                  onCheer={(cheer) => setState((s) => ({ ...s, teams: s.teams.map((x, j) => (j === i ? { ...x, cheer } : x)) }))}
                />
              )}
              {!tm.cpu && (
                <CrestEditor
                  crest={cleanCrest(tm.crest)}
                  onChange={(crest) => setState((s) => ({ ...s, teams: s.teams.map((x, j) => (j === i ? { ...x, crest } : x)) }))}
                  pokemon={tm.slots.filter((x): x is number => x != null)}
                />
              )}
              {!tm.cpu && (
                <JerseyEditor
                  formation={tm.formation}
                  slots={tm.slots}
                  ss={null}
                  jerseys={cleanJerseys(tm.jerseys)}
                  onChange={(jerseys) => setState((s) => ({ ...s, teams: s.teams.map((x, j) => (j === i ? { ...x, jerseys } : x)) }))}
                />
              )}
            </div>
          ))}
        </section>
        <div className="actionbar">
          <button type="button" className="btn btn--primary" onClick={() => setState((s) => ({ ...s, seed: randomSeed(), model: 'draft', cpuCaptains: true }))}>
            {tx.replay}
          </button>
          <button
            type="button"
            className="btn"
            title={tx.rematchTitle}
            // Revanche: dieselben Teams (Namen, Formation, Mensch/CPU, Trikot, Wappen) und Pool-Einstellungen, leere Kader
            onClick={() =>
              setState((s) => ({
                ...s,
                phase: 'setup',
                pick: 0,
                selected: null,
                seed: null,
                shinies: [],
                log: undefined,
                teams: s.teams.map((tm) => ({ ...tm, slots: emptySlots(tm.formation), captain: null })),
              }))
            }
          >
            {tx.rematch}
          </button>
          <button type="button" className="btn" onClick={reset}>
            {tx.newDraft}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Draft läuft ----------
  const round = Math.floor(state.pick / n) + 1;
  const selected = state.selected != null ? byId.get(state.selected) : undefined;
  const defs = team ? FORMATIONS[team.formation].slots : [];
  const slotState = (i: number): SlotState =>
    team?.slots[i] != null ? 'locked' : !team?.cpu && state.selected != null ? 'target' : undefined;

  return (
    <div className="page draft">
        {modeSwitch}
      <header className="page-head">
        <h1 className="page-title">{tx.title}</h1>
        <div className="statusline" role="status">
          <span className={`statusline__item ${round === ROUNDS ? 'draft-turnbar__final' : ''}`}>
            {tx.round} <strong>{round}/{ROUNDS}</strong>
            {round === ROUNDS && (
              // Letzte Draft-Runde (wie online)
              <span title={t.online.finalRound}>
                {' '}
                <span aria-hidden="true">🏁</span>
                <span className="sr-only">{t.online.finalRound}</span>
              </span>
            )}
          </span>
          <span className="statusline__item">
            {tx.pick} <strong>{state.pick + 1}/{totalPicks}</strong>
          </span>
          <span className="statusline__item">
            {tx.onTheClock} <strong>{team && teamName(team.name)}</strong> {team?.cpu ? tx.cpuTag : ''}
          </span>
          {clockLeft != null && (
            // Pick-Uhr des menschlichen Teams am Zug
            <span className={`statusline__item draft__clock ${clockLeft <= 10 ? 'is-urgent' : ''}`} role="timer">
              ⏱ <strong>{clockLeft} s</strong>
            </span>
          )}
        </div>
        {(() => {
          // Letzter Pick (aus dem Verlauf) – wie im Online-Draft; zeigt v. a. die schnellen CPU-Picks
          const last = state.log?.at(-1);
          const mon = last ? byId.get(last.id) : undefined;
          if (!last || !mon) return null;
          return (
            <p className="small muted draft__last">
              {t.online.lastPick} <strong>{t.game.pokemon(mon)}</strong>
              {state.shinies?.includes(last.id) && <span title={t.shiny.title}> ✨</span>} → {teamName(state.teams[last.team].name)}
            </p>
          );
        })()}
        {(() => {
          // Die nächsten Picks nach dem aktuellen (Snake), höchstens drei – wie im Online-Draft
          const next: string[] = [];
          for (let p = state.pick + 1; p < totalPicks && next.length < 3; p++) next.push(teamName(state.teams[teamForPick(p, n)].name));
          if (!next.length) return null;
          // Bedarf des nächsten Teams (falls es ein anderes ist): offene Feldpositionen, gruppiert
          const nt = state.pick + 1 < totalPicks ? teamForPick(state.pick + 1, n) : -1;
          const nextTeam = nt >= 0 && nt !== currentTeam ? state.teams[nt] : undefined;
          const needs = new Map<string, number>();
          if (nextTeam)
            FORMATIONS[nextTeam.formation].slots.forEach((d, j) => {
              if (nextTeam.slots[j] == null) needs.set(t.game.posShort[d.pos], (needs.get(t.game.posShort[d.pos]) ?? 0) + 1);
            });
          return (
            <>
              <p className="small muted draft__next">{t.online.nextUp(next.join(' → '))}</p>
              {nextTeam && needs.size > 0 && (
                <p className="small muted draft__needs">
                  {t.online.nextNeeds(teamName(nextTeam.name), [...needs].map(([pos, k]) => (k > 1 ? `${k}× ${pos}` : pos)).join(', '))}
                </p>
              )}
            </>
          );
        })()}
      </header>
      <div className="challenge__play">
        <div className="challenge__controls">
          {team?.cpu ? (
            <div className="card cpu-thinking" aria-live="polite">
              <span className="boot__ball boot__ball--small" aria-hidden="true" /> {tx.cpuScouting(teamName(team.name))}
              {(() => {
                // Was der CPU noch fehlt (offene Feldpositionen, gruppiert in Reihenfolge der Formation)
                const open = new Map<string, number>();
                FORMATIONS[team.formation].slots.forEach((d, j) => {
                  if (team.slots[j] == null) open.set(t.game.posShort[d.pos], (open.get(t.game.posShort[d.pos]) ?? 0) + 1);
                });
                if (!open.size) return null;
                return (
                  <span className="small muted draft__cpuneeds">
                    {' '}
                    {tx.cpuNeeds([...open].map(([pos, k]) => (k > 1 ? `${k}× ${pos}` : pos)).join(', '))}
                  </span>
                );
              })()}
              {!fastCpu && (
                <button type="button" className="btn btn--small btn--ghost draft__fastcpu" onClick={() => setFastCpu(true)}>
                  {tx.fastCpu}
                </button>
              )}
            </div>
          ) : (
            <section aria-labelledby="draft-pick-title">
              <h2 id="draft-pick-title" className="section-title">
                {tx.pickTitle}
              </h2>
              {(() => {
                // Hot-Seat: Hat gerade ein anderes menschliches Team gewählt, Gerät weitergeben
                if (state.pick < 1 || !team) return null;
                const prev = state.teams[teamForPick(state.pick - 1, n)];
                if (!prev || prev.cpu || prev === team) return null;
                return (
                  <p className="notice draft__handover" role="status">
                    <span aria-hidden="true">📱 </span>
                    {tx.handover(teamName(team.name))}
                  </p>
                );
              })()}
              <p className={`hint ${selected ? 'hint--active' : ''}`} aria-live="polite">
                {selected ? (
                  <>
                    <strong>{t.game.pokemon(selected)}</strong>
                    {tx.selectedHint}
                  </>
                ) : (
                  <>
                    {tx.yourTurn(teamName(String(team?.name)))}
                    {team && (() => {
                      // Noch offene Positionen des Teams am Zug (gruppiert, Reihenfolge der Formation)
                      const open = new Map<string, number>();
                      FORMATIONS[team.formation].slots.forEach((d, j) => {
                        if (team.slots[j] == null) open.set(t.game.posShort[d.pos], (open.get(t.game.posShort[d.pos]) ?? 0) + 1);
                      });
                      if (!open.size) return null;
                      return t.online.hintOpen([...open].map(([pos, n]) => (n > 1 ? `${n}× ${pos}` : pos)).join(', '));
                    })()}
                  </>
                )}
              </p>
              {state.pick + 1 < totalPicks && teamForPick(state.pick + 1, n) === currentTeam && (
                // Snake-Wende: dasselbe Team ist gleich noch einmal dran (wie online)
                <p className="small draft-double">🐍 {t.online.doublePick}</p>
              )}
              <div className="draft-pooltools">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={suggest}
                  title={t.online.suggestKey}
                  aria-keyshortcuts="V"
                >
                  {t.online.suggest}
                </button>
                <button type="button" className="btn btn--small" onClick={randomPick} title={t.online.randomPickTitle} aria-keyshortcuts="R">
                  🎲 {t.online.randomPick}
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => {
                    // Sofort-Pick für das Team am Zug: bester Pick wie eine starke CPU
                    if (!team || team.cpu) return;
                    const best = cpuPickChoice(team, pool, scale('all'), 'hard', () => 0.5);
                    if (best) lock(currentTeam, best.slot, best.id);
                  }}
                >
                  {t.online.autoPickFor(teamName(String(team?.name)))}
                </button>
                {canUndo && (
                  <button type="button" className="btn btn--small btn--ghost" onClick={undo} title={tx.undoTitle} aria-keyshortcuts="Z">
                    {tx.undo}
                  </button>
                )}
              </div>
              {bestFree.length > 0 && (
                <p className="draft__bestfree small">
                  <span className="muted">{tx.bestFree}</span>{' '}
                  {bestFree.map((b) => (
                    <button
                      key={b.pos}
                      type="button"
                      className={`chip ${state.selected === b.p.id ? 'is-active' : ''}`}
                      title={tx.bestFreeTitle(t.game.pokemon(b.p), t.game.posShort[b.pos], Math.round(b.fit))}
                      onClick={() => setState((s) => ({ ...s, selected: b.p.id }))}
                    >
                      <strong>{t.game.posShort[b.pos]}</strong> {t.game.pokemon(b.p)} {Math.round(b.fit)}
                    </button>
                  ))}
                </p>
              )}
              {state.legends && (
                // Noch freie Legendäre/Mysteriöse (wie im Pool-Kopf des Online-Drafts)
                <p className="small muted draft-pool__legends">
                  ★ {t.online.legendsFreeTitle(pool.filter((p) => p.leg || p.myth).length)}
                </p>
              )}
              <FilterBar filters={filters} onChange={setFilters} showRegion={state.region === 0} resultCount={filtered.length} slashFocus />
              <PokemonGrid
                items={filtered}
                sprite={sprite}
                selectedId={state.selected}
                onPick={(p: Pokemon) => {
                  setState((s) => ({ ...s, selected: s.selected === p.id ? null : p.id }));
                  if (window.matchMedia('(max-width: 899px)').matches) {
                    setTimeout(() => pitchRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
                  }
                }}
                className="pgrid-wrap--compact pgrid-wrap--scroll"
              />
            </section>
          )}
          <section className="draft__board" aria-label={t.draft.draftBoard} ref={boardRef}>
            {state.teams.map((tm, i) => (
              <div
                key={i}
                className={`draft__col ${i === currentTeam ? 'is-current' : ''} ${
                  state.pick + 1 < totalPicks && i === teamForPick(state.pick + 1, n) && i !== currentTeam ? 'is-next' : ''
                }`}
              >
                <h3>{teamName(tm.name)}</h3>
                {boardFits[i] != null && (
                  <p className="draft-board__meta">
                    <span className="draft-board__fit" title={t.draft.board.fitTitle(boardFits[i]!)}>
                      <span aria-hidden="true">Ø {boardFits[i]}</span>
                      <span className="sr-only">{t.draft.board.fitTitle(boardFits[i]!)}</span>
                    </span>
                    {boardTop === i && (
                      <span className="draft-board__top" title={t.draft.board.topFit}>
                        <span aria-hidden="true">👑</span>
                        <span className="sr-only">{t.draft.board.topFit}</span>
                      </span>
                    )}
                    <DraftTypeChip pokemon={tm.slots.flatMap((id) => (id != null && byId.get(id) ? [byId.get(id)!] : []))} />
                  </p>
                )}
                <ol>
                  {FORMATIONS[tm.formation].slots.map((d, j) => {
                    const p = tm.slots[j] != null ? byId.get(tm.slots[j]!) : undefined;
                    return (
                      <li key={j}>
                        <PosBadge pos={d.pos} />
                        <span>{p ? t.game.pokemon(p) : '–'}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </section>
          {(() => {
            // Letzte Picks wie im Online-Draft: Position und Fit, ★/UB/M, ✨ und 🏅 bester Fit bisher
            const log = state.log;
            if (!log?.length) return null;
            const sc = scale('all');
            const placed = (x: (typeof log)[number]) => {
              const tm = state.teams[x.team];
              const at = tm ? tm.slots.indexOf(x.id) : -1;
              const pos = tm && at >= 0 ? FORMATIONS[tm.formation].slots[at]?.pos : undefined;
              const mon = byId.get(x.id);
              return { mon, pos, fit: mon && pos ? Math.round(positionFit(mon, pos, sc)) : undefined };
            };
            let top = -1;
            if (log.length >= 2) {
              let best = -1;
              log.forEach((x, k) => {
                const fit = placed(x).fit;
                if (fit != null && fit > best) [best, top] = [fit, k];
              });
            }
            const items: FeedItem[] = log
              .map((x, k) => {
                const { mon, pos, fit } = placed(x);
                const kinds = mon ? limitKindsOf(mon) : [];
                return {
                  key: `${k}-${x.id}`,
                  no: k + 1,
                  pokemon: mon ? t.game.pokemon(mon) : `#${x.id}`,
                  team: teamName(state.teams[x.team]?.name ?? ''),
                  teamId: String(x.team),
                  auto: false,
                  ...(pos ? { pos, fit } : {}),
                  ...(state.shinies?.includes(x.id) ? { shiny: true } : {}),
                  ...(k === top ? { top: true } : {}),
                  ...(kinds.length ? { kinds } : {}),
                };
              })
              .slice(-8)
              .reverse();
            return <DraftPickFeed items={items} you={null} />;
          })()}
          <button type="button" className="btn btn--ghost btn--small abort" onClick={() => window.confirm(tx.abortConfirm) && reset()}>
            {tx.abort}
          </button>
        </div>
        <div className="challenge__pitch" ref={pitchRef}>
          {team && (
            <>
              <h2 className="section-title">
                {teamName(team.name)} · {team.formation}
              </h2>
              <Pitch
                formation={team.formation}
                slots={team.slots}
                sprite={sprite}
                jerseys={team.jerseys}
                captain={team.captain ?? null}
                shinies={state.shinies}
                slotState={slotState}
                positionTips
                onSlotClick={(i) => {
                  if (team.cpu || state.selected == null || team.slots[i] != null || !defs[i]) return;
                  lock(currentTeam, i, state.selected);
                }}
              />
              {!team.cpu && (
                <CaptainPicker
                  formation={team.formation}
                  slots={team.slots}
                  captain={team.captain ?? null}
                  onChange={(captain) =>
                    setState((s) => ({ ...s, teams: s.teams.map((x, j) => (j === currentTeam ? { ...x, captain } : x)) }))
                  }
                  hint={t.captain.draftNote}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type DraftMode = 'online' | 'local';

/** Gewählter Modus in diesem Seitenaufruf (Tab-Wechsel innerhalb der App behält ihn). */
let sessionMode: DraftMode | null = null;

/** Läuft am Gerät schon ein Hot-Seat-Draft? Dann startet /draft dort. */
function localDraftRunning(): boolean {
  const phase = load<Partial<DraftState>>(STORAGE_KEYS.draft, {}).phase;
  return phase === 'drafting' || phase === 'captains' || phase === 'league';
}

/**
 * /draft: Online-Liga (Standard, wenn der Server Ligen kann) oder Hot-Seat an einem Gerät.
 * Ohne Server bzw. bei laufendem lokalem Draft startet der lokale Modus.
 */
export function Draft() {
  const t = useT();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [mode, setMode] = useState<DraftMode | null>(() => sessionMode ?? (localDraftRunning() ? 'local' : null));
  const [check, setCheck] = useState(0);

  useEffect(() => {
    let alive = true;
    if (check > 0) setSupported(null);
    draftsSupported(check > 0).then((ok) => alive && setSupported(ok));
    return () => {
      alive = false;
    };
  }, [check]);

  const effective: DraftMode | null = mode ?? (supported == null ? null : supported ? 'online' : 'local');
  const choose = (m: DraftMode) => {
    sessionMode = m;
    setMode(m);
  };
  const modeSwitch = (
    <div className="draft-modes">
      <Segmented
        label={t.draft.modeLabel}
        hideLabel
        value={effective ?? 'online'}
        onChange={choose}
        options={[
          { value: 'online' as DraftMode, label: t.draft.modeOnline },
          { value: 'local' as DraftMode, label: t.draft.modeLocal },
        ]}
      />
    </div>
  );

  if (effective === 'local') return <LocalDraft modeSwitch={modeSwitch} />;
  return (
    <DraftOnline
      modeSwitch={modeSwitch}
      supported={supported}
      onRetry={() => setCheck((c) => c + 1)}
      onLocal={() => choose('local')}
    />
  );
}
