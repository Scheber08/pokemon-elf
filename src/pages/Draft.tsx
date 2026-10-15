import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isMega } from '../config/categories';
import { DEFAULT_FORMATION, FORMATION_IDS, FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { REGIONS } from '../config/regions';
import { CLUB_NAMES } from '../config/season';
import { PosBadge } from '../components/Badges';
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
import { positionFit } from '../lib/fit';
import { emptySlots } from '../lib/formation';
import { draftGrades, seasonEleven, tableRowClass } from '../lib/leagueTimeline';
import { createRng, randomSeed, shuffle } from '../lib/rng';
import { cpuLevelOf, cpuPickChoice } from '../lib/localCpu';
import { CLASSIC_MODEL, DRAFT_MODEL, formatRecord, simulateLeague, type LeagueTeam } from '../lib/season';
import { scorerSummary } from '../lib/seasonTimeline';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { bestCaptain, evaluateTeam } from '../lib/teamScore';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import type { FormationId, Pokemon, RegionFilter, Slots } from '../types';
import { DraftOnline } from './DraftOnline';
import { TableLegend } from '../components/LeagueTicker';
import { SaveImageButton } from '../components/SaveImageButton';
import { ReplayToggle, useMatchReport } from '../components/MatchReport';
import '../styles/draft.css';
import '../styles/league.css';
import { cleanCheer } from '../lib/cheer';
import { cleanCrest, type Crest as CrestData } from '../lib/crest';
import { Crest } from '../components/Crest';
import { CrestEditor } from '../components/CrestEditor';
import { cpuCaptain } from '../lib/draftEngine';
import { SHINY_CHANCE, SHINY_FIT_BONUS, SHINY_PARTY_CHANCE, shinyBonus, shinyRoll, shinyTeamBoost } from '../lib/shiny';
import { useToast } from '../state/Toast';
import { downloadBlob } from '../lib/exportImage';
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
  /** Shinys ausgeschaltet (Einstellung vor dem Draft) */
  noShinies?: true;
  /** Shiny-Party: 10 % statt 2 % */
  shinyParty?: true;
  /** Stärke der CPU-Teams beim Picken (fehlt = normal) */
  cpuLevel?: 'easy' | 'hard';
}


function defaultTeams(n: number): DraftTeam[] {
  const names = shuffle(Math.random, CLUB_NAMES);
  return Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? OWN_TEAM : names[i],
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

/** Mega-Limit „unbegrenzt" (wie im Builder) */
const MEGAS_UNLIMITED = 99;
const MEGA_OPTIONS = [0, 1, 2, 3, MEGAS_UNLIMITED];

/** Snake-Draft: Runde 1 vorwärts, Runde 2 rückwärts … */
function teamForPick(pick: number, n: number): number {
  const round = Math.floor(pick / n);
  const idx = pick % n;
  return round % 2 === 0 ? idx : n - 1 - idx;
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
  const team = state.teams[currentTeam];

  const drafted = useMemo(
    () => new Set(state.teams.flatMap((tm) => tm.slots.filter((id): id is number => id != null))),
    [state.teams],
  );
  /** Teamname für die Anzeige: Vorgabe „Mein Team" und Vereinsnamen (CPU) in der aktiven Sprache */
  const teamName = (name: string) => (name === OWN_TEAM ? tx.myTeam : t.game.club(name));
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
        ...(shiny ? { shinies: [...(s.shinies ?? []), pokemonId] } : {}),
        selected: null,
        phase: pick >= s.teams.length * ROUNDS ? (s.teams.some((x) => !x.cpu) ? 'captains' : 'league') : 'drafting',
        seed: pick >= s.teams.length * ROUNDS ? randomSeed() : s.seed,
        ...(pick >= s.teams.length * ROUNDS ? { model: 'draft' as const, cpuCaptains: true as const } : {}),
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
  // Taste „V“: Vorschlag (wie online; nicht beim Tippen)
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  useEffect(() => {
    if (state.phase !== 'drafting') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'v' && e.key !== 'V') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (typingElsewhere(e.target)) return;
      e.preventDefault();
      suggestRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.phase]);

  // CPU-Picks: beste Kombination aus Pokémon und freiem Slot nach Fit – mit etwas Zufall (je nach CPU-Stärke).
  useEffect(() => {
    if (state.phase !== 'drafting' || !team?.cpu) return;
    const timer = window.setTimeout(() => {
      const best = cpuPickChoice(team, pool, scale('all'), cpuLevelOf(state.cpuLevel), createRng(randomSeed()));
      if (best) lock(currentTeam, best.slot, best.id);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.pick]);

  const start = () => {
    setState((s) => ({
      ...s,
      phase: 'drafting',
      pick: 0,
      selected: null,
      seed: null,
      shinySalt: s.noShinies ? undefined : randomSeed(),
      shinies: [],
      teams: s.teams.map((tm) => ({ ...tm, slots: emptySlots(tm.formation) })),
    }));
    setFilters({ query: '', type: null, region: state.region });
  };

  const setTeamCount = (count: number) =>
    setState((s) => {
      const teams = s.teams.slice(0, count);
      const free = shuffle(Math.random, CLUB_NAMES).filter((name) => !teams.some((tm) => tm.name === name));
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

  // ---------- Liga ----------
  const league = useMemo(() => {
    if (state.phase !== 'league' || state.seed == null) return null;
    const sc = scale('all');
    const leagueTeams: LeagueTeam[] = state.teams.map((tm) => {
      const players = tm.slots.map((id) => (id != null ? byId.get(id) ?? null : null));
      const shinies = state.shinies?.length ? new Set(state.shinies) : undefined;
      const ev = evaluateTeam(tm.formation, players, sc, captainOf(tm), shinies ? (id) => (shinies.has(id) ? SHINY_FIT_BONUS : 0) : undefined);
      const defs = FORMATIONS[tm.formation].slots;
      return {
        name: tm.name,
        rating: Math.min(1000, ev.score + shinyBonus(players, shinies)),
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
            <p className="muted small">{tx.hotSeatNote}</p>
          </section>
          <section className="card" aria-labelledby="draft-pool">
            <h2 id="draft-pool" className="section-title">
              {t.draft.pool}
            </h2>
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
            {poolTooSmall && <p className="notice notice--error">{tx.poolTooSmall(poolSize, n, ROUNDS, n * ROUNDS)}</p>}
            <button type="button" className="btn btn--primary btn--big" onClick={start} disabled={poolTooSmall}>
              {tx.start}
            </button>
          </section>
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
                {t.draft.results.yourPlace(teamName(r.name), i + 1, r.pts)}
              </p>
            ) : null,
          )}
        </header>
        <div className="result-grid">
          <section className="card" aria-labelledby="draft-table">
            <h2 id="draft-table" className="section-title">
              {t.draft.table}
            </h2>
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
                  </tr>
                </thead>
                <tbody>
                  {league.table.map((r, i) => (
                    <tr key={r.team} className={tableRowClass(r.isUser, i + 1, league.table.length)}>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TableLegend total={league.table.length} />
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
          <span className="statusline__item">
            {tx.round} <strong>{round}/{ROUNDS}</strong>
          </span>
          <span className="statusline__item">
            {tx.pick} <strong>{state.pick + 1}/{totalPicks}</strong>
          </span>
          <span className="statusline__item">
            {tx.onTheClock} <strong>{team && teamName(team.name)}</strong> {team?.cpu ? tx.cpuTag : ''}
          </span>
        </div>
      </header>
      <div className="challenge__play">
        <div className="challenge__controls">
          {team?.cpu ? (
            <div className="card cpu-thinking" aria-live="polite">
              <span className="boot__ball boot__ball--small" aria-hidden="true" /> {tx.cpuScouting(teamName(team.name))}
            </div>
          ) : (
            <section aria-labelledby="draft-pick-title">
              <h2 id="draft-pick-title" className="section-title">
                {tx.pickTitle}
              </h2>
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
              </div>
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
              <div key={i} className={`draft__col ${i === currentTeam ? 'is-current' : ''}`}>
                <h3>{teamName(tm.name)}</h3>
                {(() => {
                  // Ø Positions-Fit der gesetzten Elf – grobe Live-Stärke wie im Online-Draft
                  const sc = scale('all');
                  const fits = FORMATIONS[tm.formation].slots.flatMap((d, j) => {
                    const p = tm.slots[j] != null ? byId.get(tm.slots[j]!) : undefined;
                    return p ? [positionFit(p, d.pos, sc)] : [];
                  });
                  if (!fits.length) return null;
                  const avg = Math.round(fits.reduce((a, b) => a + b, 0) / fits.length);
                  return (
                    <p className="draft-board__meta">
                      <span className="draft-board__fit" title={t.draft.board.fitTitle(avg)}>
                        <span aria-hidden="true">Ø {avg}</span>
                        <span className="sr-only">{t.draft.board.fitTitle(avg)}</span>
                      </span>
                    </p>
                  );
                })()}
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
