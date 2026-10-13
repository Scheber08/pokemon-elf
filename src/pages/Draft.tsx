import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_FORMATION, FORMATION_IDS, FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { REGIONS, regionPhrase } from '../config/regions';
import { CLUB_NAMES } from '../config/season';
import { PosBadge } from '../components/Badges';
import { FilterBar, useFilteredPokemon, type PokemonFilters } from '../components/FilterBar';
import { Pitch, type SlotState } from '../components/Pitch';
import { PokemonGrid } from '../components/PokemonGrid';
import { Segmented } from '../components/Segmented';
import { Sprite } from '../components/Sprite';
import { draftsSupported } from '../lib/api/draftClient';
import { positionFit } from '../lib/fit';
import { emptySlots } from '../lib/formation';
import { createRng, gaussian, randomSeed, shuffle } from '../lib/rng';
import { simulateLeague, type LeagueTeam } from '../lib/season';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { evaluateTeam } from '../lib/teamScore';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import type { FormationId, Pokemon, RegionFilter, Slots } from '../types';
import { DraftOnline } from './DraftOnline';
import '../styles/draft.css';

const ROUNDS = 11;

interface DraftTeam {
  name: string;
  cpu: boolean;
  formation: FormationId;
  slots: Slots;
}

interface DraftState {
  phase: 'setup' | 'drafting' | 'league';
  teams: DraftTeam[];
  region: RegionFilter;
  legends: boolean;
  pick: number;
  selected: number | null;
  seed: number | null;
}

function defaultTeams(n: number): DraftTeam[] {
  const names = shuffle(Math.random, CLUB_NAMES);
  return Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? 'Mein Team' : names[i],
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
  pick: 0,
  selected: null,
  seed: null,
};

/** Snake-Draft: Runde 1 vorwärts, Runde 2 rückwärts … */
function teamForPick(pick: number, n: number): number {
  const round = Math.floor(pick / n);
  const idx = pick % n;
  return round % 2 === 0 ? idx : n - 1 - idx;
}

/** Hot-Seat-Draft an einem Gerät (Modus „An einem Gerät"). */
function LocalDraft({ modeSwitch }: { modeSwitch?: ReactNode }) {
  const { list, byId, scale } = usePokemonData();
  const { sprite } = useSettings();
  const [state, setState] = useState<DraftState>(() => ({ ...INITIAL, ...load<Partial<DraftState>>(STORAGE_KEYS.draft, {}) }));
  const [filters, setFilters] = useState<PokemonFilters>({ query: '', type: null, region: 0 });
  const pitchRef = useRef<HTMLDivElement>(null);

  useEffect(() => save(STORAGE_KEYS.draft, state), [state]);

  const n = state.teams.length;
  const totalPicks = n * ROUNDS;
  const currentTeam = state.phase === 'drafting' ? teamForPick(state.pick, n) : -1;
  const team = state.teams[currentTeam];

  const drafted = useMemo(
    () => new Set(state.teams.flatMap((t) => t.slots.filter((id): id is number => id != null))),
    [state.teams],
  );
  const pool = useMemo(
    () =>
      list.filter(
        (p) =>
          (state.region === 0 || p.gen === state.region) && (state.legends || (!p.leg && !p.myth)) && !drafted.has(p.id),
      ),
    [list, state.region, state.legends, drafted],
  );
  const filtered = useFilteredPokemon(pool, filters);
  const poolSize = useMemo(
    () => list.filter((p) => (state.region === 0 || p.gen === state.region) && (state.legends || (!p.leg && !p.myth))).length,
    [list, state.region, state.legends],
  );
  const poolTooSmall = poolSize < n * ROUNDS;

  const lock = (teamIdx: number, slot: number, pokemonId: number) =>
    setState((s) => {
      const teams = s.teams.map((t, i) =>
        i === teamIdx ? { ...t, slots: t.slots.map((v, j) => (j === slot ? pokemonId : v)) } : t,
      );
      const pick = s.pick + 1;
      return {
        ...s,
        teams,
        pick,
        selected: null,
        phase: pick >= s.teams.length * ROUNDS ? 'league' : 'drafting',
        seed: pick >= s.teams.length * ROUNDS ? randomSeed() : s.seed,
      };
    });

  // CPU-Picks: beste Kombination aus Pokémon und freiem Slot nach Fit – mit etwas Zufall.
  useEffect(() => {
    if (state.phase !== 'drafting' || !team?.cpu) return;
    const timer = window.setTimeout(() => {
      const sc = scale('all');
      const defs = FORMATIONS[team.formation].slots;
      const rng = createRng(randomSeed());
      let best: { score: number; slot: number; id: number } | null = null;
      for (const [slot, d] of defs.entries()) {
        if (team.slots[slot] != null) continue;
        const top = pool
          .map((p) => ({ p, fit: positionFit(p, d.pos, sc) }))
          .sort((a, b) => b.fit - a.fit)
          .slice(0, 4);
        for (const { p, fit } of top) {
          const score = fit * (0.92 + 0.08 * POSITIONS[d.pos].teamWeight) + gaussian(rng) * 5;
          if (!best || score > best.score) best = { score, slot, id: p.id };
        }
      }
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
      teams: s.teams.map((t) => ({ ...t, slots: emptySlots(t.formation) })),
    }));
    setFilters({ query: '', type: null, region: state.region });
  };

  const setTeamCount = (count: number) =>
    setState((s) => {
      const teams = s.teams.slice(0, count);
      const free = shuffle(Math.random, CLUB_NAMES).filter((name) => !teams.some((t) => t.name === name));
      while (teams.length < count) {
        const formation = FORMATION_IDS[teams.length % FORMATION_IDS.length];
        teams.push({ name: free.shift() ?? `Team ${teams.length + 1}`, cpu: true, formation, slots: emptySlots(formation) });
      }
      return { ...s, teams };
    });

  const updateTeam = (i: number, patch: Partial<DraftTeam>) =>
    setState((s) => ({
      ...s,
      teams: s.teams.map((t, j) =>
        j === i ? { ...t, ...patch, slots: patch.formation ? emptySlots(patch.formation) : t.slots } : t,
      ),
    }));

  const reset = () => setState({ ...INITIAL, teams: defaultTeams(state.teams.length) });

  // ---------- Liga ----------
  const league = useMemo(() => {
    if (state.phase !== 'league' || state.seed == null) return null;
    const sc = scale('all');
    const leagueTeams: LeagueTeam[] = state.teams.map((t) => {
      const players = t.slots.map((id) => (id != null ? byId.get(id) ?? null : null));
      const ev = evaluateTeam(t.formation, players, sc);
      const defs = FORMATIONS[t.formation].slots;
      return {
        name: t.name,
        rating: ev.score,
        isUser: !t.cpu,
        squad: players.flatMap((p, i) => (p ? [{ pokemonId: p.id, pos: defs[i].pos, atk: p.atk, spa: p.spa }] : [])),
      };
    });
    const result = simulateLeague(leagueTeams, createRng(state.seed));
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
  }, [state.phase, state.seed, state.teams, byId, scale]);

  if (state.phase === 'setup') {
    return (
      <div className="page draft">
        {modeSwitch}
        <header className="page-head">
          <h1 className="page-title">Fantasy-Draft</h1>
          <p className="page-lead">
            2–8 Teams, ein gemeinsamer Pool, Snake-Draft über 11 Runden. Danach spielt jeder gegen jeden – Hin- und
            Rückrunde.
          </p>
        </header>
        <div className="draft__setup">
          <section className="card" aria-labelledby="draft-teams">
            <h2 id="draft-teams" className="section-title">
              Teams
            </h2>
            <Segmented
              label="Anzahl Teams"
              value={n}
              onChange={setTeamCount}
              options={[2, 3, 4, 5, 6, 7, 8].map((v) => ({ value: v, label: String(v) }))}
              wrap
            />
            <ol className="draft__teamlist">
              {state.teams.map((t, i) => (
                <li key={i} className="draft__teamrow">
                  <span className="draft__no">{i + 1}</span>
                  <input
                    className="input"
                    aria-label={`Name Team ${i + 1}`}
                    value={t.name}
                    maxLength={28}
                    onChange={(e) => updateTeam(i, { name: e.target.value })}
                  />
                  <select
                    className="input select"
                    aria-label={`Formation Team ${i + 1}`}
                    value={t.formation}
                    onChange={(e) => updateTeam(i, { formation: e.target.value as FormationId })}
                  >
                    {FORMATION_IDS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`btn btn--small ${t.cpu ? '' : 'btn--accent'}`}
                    aria-pressed={!t.cpu}
                    onClick={() => updateTeam(i, { cpu: !t.cpu })}
                  >
                    {t.cpu ? 'CPU' : 'Mensch'}
                  </button>
                </li>
              ))}
            </ol>
            <p className="muted small">Menschliche Teams wählen nacheinander am selben Gerät (Hot-Seat).</p>
          </section>
          <section className="card" aria-labelledby="draft-pool">
            <h2 id="draft-pool" className="section-title">
              Pool
            </h2>
            <Segmented
              label="Region"
              wrap
              value={state.region}
              onChange={(region) => setState((s) => ({ ...s, region }))}
              options={[
                ...REGIONS.map((r) => ({ value: r.gen as RegionFilter, label: r.name })),
                { value: 0 as RegionFilter, label: 'Alle' },
              ]}
            />
            <Segmented
              label="Pokémon / Legendäre"
              value={state.legends}
              onChange={(legends) => setState((s) => ({ ...s, legends }))}
              options={[
                { value: false, label: 'Pokémon' },
                { value: true, label: 'Legendäre' },
              ]}
            />
            <p className="settings__desc">
              Draft {regionPhrase(state.region)}, {state.legends ? 'mit Legendären' : 'ohne Legendäre'}.
            </p>
            {poolTooSmall && (
              <p className="notice notice--error">
                Nur {poolSize} Pokémon im Pool – für {n} Teams × 11 Runden braucht ihr {n * ROUNDS}. Wählt eine größere
                Region, „Alle" oder weniger Teams.
              </p>
            )}
            <button type="button" className="btn btn--primary btn--big" onClick={start} disabled={poolTooSmall}>
              Draft starten
            </button>
          </section>
        </div>
      </div>
    );
  }

  if (state.phase === 'league' && league) {
    return (
      <div className="page draft">
        {modeSwitch}
        <header className="page-head">
          <h1 className="page-title">Draft-Liga</h1>
          <p className="page-lead">
            Jeder gegen jeden, Hin- und Rückrunde – {league.matches.length} Spiele.
          </p>
        </header>
        <div className="result-grid">
          <section className="card" aria-labelledby="draft-table">
            <h2 id="draft-table" className="section-title">
              Tabelle
            </h2>
            <div className="table-scroll">
              <table className="league-table">
                <thead>
                  <tr>
                    <th>Pl.</th>
                    <th className="left">Team</th>
                    <th>Score</th>
                    <th>Sp</th>
                    <th>S</th>
                    <th>U</th>
                    <th>N</th>
                    <th>Tore</th>
                    <th>Diff</th>
                    <th>Pkt</th>
                  </tr>
                </thead>
                <tbody>
                  {league.table.map((r, i) => (
                    <tr key={r.team} className={r.isUser ? 'is-user' : ''}>
                      <td>{i + 1}</td>
                      <td className="left">
                        {r.name} {state.teams[r.team].cpu && <span className="rating">CPU</span>}
                      </td>
                      <td>{r.rating}</td>
                      <td>{r.played}</td>
                      <td>{r.w}</td>
                      <td>{r.d}</td>
                      <td>{r.l}</td>
                      <td>
                        {r.gf}:{r.ga}
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
          </section>
          <section className="card" aria-labelledby="draft-scorers">
            <h2 id="draft-scorers" className="section-title">
              Torjäger
            </h2>
            <ol className="scorers">
              {league.scorers.map((s) => {
                const p = byId.get(s.id);
                return (
                  <li key={s.id}>
                    {p && <Sprite pokemon={p} style={sprite} className="scorers__sprite" />}
                    <span className="scorers__name">
                      {p?.de} <small className="muted">{state.teams[s.team].name}</small>
                    </span>
                    <span className="scorers__goals">{s.goals}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
        <details className="card details">
          <summary>Alle Spiele</summary>
          <ol className="matches">
            {league.matches.map((m, i) => (
              <li key={i} className="match">
                <span className="match__round">{m.round}.</span>
                <span className="match__opp">
                  {state.teams[m.home].name} – {state.teams[m.away].name}
                </span>
                <span className="match__score">
                  {m.hg}:{m.ag}
                </span>
              </li>
            ))}
          </ol>
        </details>
        <section className="draft__rosters" aria-label="Kader">
          {state.teams.map((t, i) => (
            <div key={i} className="card draft__roster">
              <h3 className="section-title">{t.name}</h3>
              <Pitch formation={t.formation} slots={t.slots} sprite={sprite} ariaLabel={`Kader ${t.name}`} />
            </div>
          ))}
        </section>
        <div className="actionbar">
          <button type="button" className="btn btn--primary" onClick={() => setState((s) => ({ ...s, seed: randomSeed() }))}>
            Liga neu ausspielen
          </button>
          <button type="button" className="btn" onClick={reset}>
            Neuer Draft
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
        <h1 className="page-title">Fantasy-Draft</h1>
        <div className="statusline" role="status">
          <span className="statusline__item">
            Runde <strong>{round}/{ROUNDS}</strong>
          </span>
          <span className="statusline__item">
            Pick <strong>{state.pick + 1}/{totalPicks}</strong>
          </span>
          <span className="statusline__item">
            Am Zug: <strong>{team?.name}</strong> {team?.cpu ? '(CPU)' : ''}
          </span>
        </div>
      </header>
      <div className="challenge__play">
        <div className="challenge__controls">
          {team?.cpu ? (
            <div className="card cpu-thinking" aria-live="polite">
              <span className="boot__ball boot__ball--small" aria-hidden="true" /> {team.name} scoutet …
            </div>
          ) : (
            <section aria-labelledby="draft-pick-title">
              <h2 id="draft-pick-title" className="section-title">
                Wähle ein Pokémon
              </h2>
              <p className={`hint ${selected ? 'hint--active' : ''}`} aria-live="polite">
                {selected ? (
                  <>
                    <strong>{selected.de}</strong> gewählt. Klicke auf einen freien Platz auf dem Feld.
                  </>
                ) : (
                  `${team?.name}, du bist dran.`
                )}
              </p>
              <FilterBar filters={filters} onChange={setFilters} showRegion={state.region === 0} resultCount={filtered.length} />
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
                className="pgrid-wrap--compact"
              />
            </section>
          )}
          <section className="draft__board" aria-label="Draft-Board">
            {state.teams.map((t, i) => (
              <div key={i} className={`draft__col ${i === currentTeam ? 'is-current' : ''}`}>
                <h3>{t.name}</h3>
                <ol>
                  {FORMATIONS[t.formation].slots.map((d, j) => {
                    const p = t.slots[j] != null ? byId.get(t.slots[j]!) : undefined;
                    return (
                      <li key={j}>
                        <PosBadge pos={d.pos} />
                        <span>{p?.de ?? '–'}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </section>
          <button type="button" className="btn btn--ghost btn--small abort" onClick={() => window.confirm('Draft abbrechen?') && reset()}>
            Draft abbrechen
          </button>
        </div>
        <div className="challenge__pitch" ref={pitchRef}>
          {team && (
            <>
              <h2 className="section-title">
                {team.name} · {team.formation}
              </h2>
              <Pitch
                formation={team.formation}
                slots={team.slots}
                sprite={sprite}
                slotState={slotState}
                positionTips
                onSlotClick={(i) => {
                  if (team.cpu || state.selected == null || team.slots[i] != null || !defs[i]) return;
                  lock(currentTeam, i, state.selected);
                }}
              />
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
  return phase === 'drafting' || phase === 'league';
}

/**
 * /draft: Online-Liga (Standard, wenn der Server Ligen kann) oder Hot-Seat an einem Gerät.
 * Ohne Server bzw. bei laufendem lokalem Draft startet der lokale Modus.
 */
export function Draft() {
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
        label="Spielmodus"
        hideLabel
        value={effective ?? 'online'}
        onChange={choose}
        options={[
          { value: 'online' as DraftMode, label: 'Online-Liga' },
          { value: 'local' as DraftMode, label: 'An einem Gerät' },
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
