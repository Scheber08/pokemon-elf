import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FORMATION, FORMATIONS } from '../config/formations';
import { TYPE_KEYS, TYPES } from '../config/pokemonTypes';
import { REGIONS, regionName } from '../config/regions';
import { HowItWorks, RollCard, RunSetup, StatCards, StatusLine, useRolling } from '../components/ChallengeParts';
import { Pitch, SS_INDEX, type SlotState } from '../components/Pitch';
import { PokemonGrid } from '../components/PokemonGrid';
import { SeasonResultView } from '../components/SeasonResultView';
import { loadStats } from '../lib/challengeStats';
import { emptySlots } from '../lib/formation';
import { randomSeed, shuffle } from '../lib/rng';
import { computeRun, recordFinishedRun } from '../lib/runFinish';
import { load, remove, save, STORAGE_KEYS } from '../lib/storage';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import type { FormationId, Pokemon, Slots, TypeKey } from '../types';

const CHALLENGE = 'c340';
const MAX_LEGENDS = 2;

interface Run {
  phase: 'setup' | 'draft' | 'done' | 'result';
  formation: FormationId;
  ssEnabled: boolean;
  teamName: string;
  slots: Slots;
  ss: number | null;
  round: number;
  region: number;
  type: TypeKey;
  rerolled: { type: boolean; region: boolean };
  selected: number | null;
  seed: number | null;
  entryId: string | null;
}

const NEW_RUN: Run = {
  phase: 'setup',
  formation: DEFAULT_FORMATION,
  ssEnabled: false,
  teamName: '',
  slots: emptySlots(DEFAULT_FORMATION),
  ss: null,
  round: 1,
  region: 1,
  type: 'normal',
  rerolled: { type: false, region: false },
  selected: null,
  seed: null,
  entryId: null,
};

const isLegend = (p: Pokemon) => !!(p.leg || p.myth);

export function Challenge340() {
  const { list, byId, scale } = usePokemonData();
  const { sprite } = useSettings();
  const [run, setRun] = useState<Run>(() => ({ ...NEW_RUN, ...load<Partial<Run>>(STORAGE_KEYS.run(CHALLENGE), {}) }));
  const [stats, setStats] = useState(() => loadStats(CHALLENGE));
  const { rolling, start: startRolling, skip } = useRolling();
  const pitchRef = useRef<HTMLDivElement>(null);

  useEffect(() => save(STORAGE_KEYS.run(CHALLENGE), run), [run]);

  const totalRounds = 11 + (run.ssEnabled ? 1 : 0);
  const usedIds = useMemo(
    () => new Set([...run.slots, run.ss].filter((id): id is number => id != null)),
    [run.slots, run.ss],
  );
  const legendsUsed = [...usedIds].filter((id) => {
    const p = byId.get(id);
    return p && isLegend(p);
  }).length;

  const candidatesFor = (region: number, type: TypeKey, used: Set<number>) =>
    list.filter((p) => p.gen === region && p.types.includes(type) && !used.has(p.id));
  const pickable = (cands: Pokemon[], legends: number) => cands.filter((p) => !isLegend(p) || legends < MAX_LEGENDS);

  /** Würfelt Region + Typ – bei null Treffern wird automatisch neu gewürfelt. */
  const rollBoth = (used: Set<number>, legends: number) => {
    for (let i = 0; i < 500; i++) {
      const region = 1 + Math.floor(Math.random() * REGIONS.length);
      const type = TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)];
      if (pickable(candidatesFor(region, type, used), legends).length) return { region, type };
    }
    return { region: 0, type: 'normal' as TypeKey };
  };

  const candidates = useMemo(
    () =>
      candidatesFor(run.region, run.type, usedIds).sort(
        (a, b) => Number(isLegend(a)) - Number(isLegend(b)) || a.id - b.id,
      ),
    [run.region, run.type, usedIds, list],
  );

  const startRun = () => {
    const used = new Set<number>();
    const roll = rollBoth(used, 0);
    setRun((r) => ({
      ...NEW_RUN,
      formation: r.formation,
      ssEnabled: r.ssEnabled,
      teamName: r.teamName,
      slots: emptySlots(r.formation),
      phase: 'draft',
      ...roll,
    }));
    startRolling();
  };

  const reroll = (what: 'type' | 'region') => {
    if (run.rerolled[what]) return;
    const options =
      what === 'type'
        ? shuffle(Math.random, TYPE_KEYS.filter((t) => t !== run.type)).map((type) => ({ region: run.region, type }))
        : shuffle(Math.random, REGIONS.map((r) => r.gen).filter((g) => g !== run.region)).map((region) => ({
            region,
            type: run.type,
          }));
    const next = options.find((o) => pickable(candidatesFor(o.region, o.type, usedIds), legendsUsed).length);
    if (!next) return;
    setRun((r) => ({ ...r, ...next, selected: null, rerolled: { ...r.rerolled, [what]: true } }));
    startRolling();
  };

  const freeSlot = (i: number) => (i === SS_INDEX ? run.ssEnabled && run.ss == null : run.slots[i] == null);

  const place = (index: number) => {
    if (run.phase !== 'draft' || run.selected == null || rolling || !freeSlot(index)) return;
    const id = run.selected;
    const slots = index === SS_INDEX ? run.slots : run.slots.map((v, i) => (i === index ? id : v));
    const ss = index === SS_INDEX ? id : run.ss;
    const used = new Set([...slots, ss].filter((x): x is number => x != null));
    const legends = [...used].filter((x) => isLegend(byId.get(x)!)).length;
    const nextRound = run.round + 1;
    if (nextRound > totalRounds) {
      setRun((r) => ({ ...r, slots, ss, selected: null, round: nextRound, phase: 'done' }));
      return;
    }
    const roll = rollBoth(used, legends);
    setRun((r) => ({ ...r, slots, ss, selected: null, round: nextRound, ...roll }));
    startRolling();
  };

  const showResult = async () => {
    const seed = randomSeed();
    const input = {
      formation: run.formation,
      slots: run.slots,
      ss: run.ssEnabled ? run.ss : undefined,
      teamName: run.teamName,
      seed,
    };
    const computed = computeRun(input, byId, scale('all'));
    const { stats: next, entryId } = await recordFinishedRun(CHALLENGE, input, computed);
    setStats(next);
    setRun((r) => ({ ...r, phase: 'result', seed, entryId }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const newRun = () => {
    remove(STORAGE_KEYS.run(CHALLENGE));
    setRun((r) => ({ ...NEW_RUN, formation: r.formation, ssEnabled: r.ssEnabled, teamName: r.teamName }));
  };

  const slotState = (i: number): SlotState => {
    if (run.phase !== 'draft') return undefined;
    if (!freeSlot(i)) return 'locked';
    return run.selected != null && !rolling ? 'target' : undefined;
  };

  const selectCandidate = (p: Pokemon) => {
    setRun((r) => ({ ...r, selected: r.selected === p.id ? null : p.id }));
    if (window.matchMedia('(max-width: 899px)').matches) {
      setTimeout(() => pitchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };

  if (run.phase === 'result' && run.seed != null) {
    return (
      <div className="page">
        <SeasonResultView
          challenge={CHALLENGE}
          input={{
            formation: run.formation,
            slots: run.slots,
            ss: run.ssEnabled ? run.ss : undefined,
            teamName: run.teamName,
            seed: run.seed,
          }}
          scaleKind="all"
          sprite={sprite}
          entryId={run.entryId}
          onNewRun={newRun}
        />
        <StatCards stats={stats} />
      </div>
    );
  }

  const selectedPokemon = run.selected != null ? byId.get(run.selected) : undefined;
  const typeInfo = TYPES[run.type];

  return (
    <div className="page challenge">
      <header className="page-head">
        <h1 className="page-title">34–0 Challenge</h1>
        <p className="page-lead">Alle 1.025 Pokémon. Schaffst du 34–0?</p>
      </header>

      {run.phase === 'setup' ? (
        <div className="challenge__setup">
          <div>
            <HowItWorks>
              Jede Runde würfelt eine Region und einen Typ. Setze ein passendes Pokémon auf einen freien Platz, mit
              höchstens 2 Legendären. Fülle alle 11 Plätze und spiel dann eine Saison mit 34 Spielen. Schaffst du 34–0?
            </HowItWorks>
            <StatCards stats={stats} />
          </div>
          <RunSetup
            formation={run.formation}
            ssEnabled={run.ssEnabled}
            teamName={run.teamName}
            onChange={(v) => setRun((r) => ({ ...r, ...v, slots: emptySlots(v.formation) }))}
            onStart={startRun}
          />
        </div>
      ) : (
        <div className="challenge__play">
          <div className="challenge__controls">
            <StatusLine
              items={[
                run.phase === 'done' ? (
                  <>Alle Plätze belegt</>
                ) : (
                  <>
                    Runde <strong>{Math.min(run.round, totalRounds)}/{totalRounds}</strong>
                  </>
                ),
                <>
                  Legendäre <strong>{legendsUsed}/{MAX_LEGENDS}</strong>
                </>,
              ]}
            />

            {run.phase === 'draft' && (
              <>
                <div className="rollcards">
                  <RollCard
                    label="Region"
                    rolling={rolling}
                    value={regionName(run.region)}
                    reel={REGIONS.map((r) => r.name)}
                    onSkip={skip}
                  />
                  <RollCard
                    label="Typ"
                    rolling={rolling}
                    value={typeInfo.de}
                    reel={TYPE_KEYS.map((t) => TYPES[t].de)}
                    color={typeInfo.color}
                    textColor={typeInfo.text}
                    onSkip={skip}
                  />
                </div>
                <div className="reroll-row">
                  <button type="button" className="btn btn--small" disabled={run.rerolled.type || rolling} onClick={() => reroll('type')}>
                    Typ neu würfeln {run.rerolled.type ? '(verbraucht)' : '(1×)'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={run.rerolled.region || rolling}
                    onClick={() => reroll('region')}
                  >
                    Region neu würfeln {run.rerolled.region ? '(verbraucht)' : '(1×)'}
                  </button>
                </div>

                {!rolling && (
                  <section aria-labelledby="cands-title" className="cands">
                    <h2 id="cands-title" className="section-title">
                      Wähle ein Pokémon <span className="muted">({candidates.length})</span>
                    </h2>
                    <p className={`hint ${selectedPokemon ? 'hint--active' : ''}`} aria-live="polite">
                      {selectedPokemon ? (
                        <>
                          <strong>{selectedPokemon.de}</strong> gewählt. Klicke auf einen freien Platz auf dem Feld, um
                          ihn festzulegen.
                        </>
                      ) : (
                        'Wähle ein Pokémon, das zu Region und Typ passt. Festgelegte Spieler bleiben stehen.'
                      )}
                    </p>
                    <PokemonGrid
                      items={candidates}
                      sprite={sprite}
                      selectedId={run.selected}
                      onPick={selectCandidate}
                      disabledReason={(p) =>
                        isLegend(p) && legendsUsed >= MAX_LEGENDS ? 'Schon 2 Legendäre im Team' : null
                      }
                      className="pgrid-wrap--compact"
                    />
                  </section>
                )}
              </>
            )}

            {run.phase === 'done' && (
              <div className="done-box card">
                <p>Deine Elf steht. Zeit für die Saison!</p>
                <button type="button" className="btn btn--primary btn--big" onClick={showResult}>
                  Ergebnis ansehen
                </button>
              </div>
            )}

            <button
              type="button"
              className="btn btn--ghost btn--small abort"
              onClick={() => window.confirm('Run wirklich abbrechen?') && newRun()}
            >
              Run abbrechen
            </button>
          </div>

          <div className="challenge__pitch" ref={pitchRef}>
            <Pitch
              formation={run.formation}
              slots={run.slots}
              ss={run.ssEnabled ? run.ss : undefined}
              sprite={sprite}
              onSlotClick={place}
              slotState={slotState}
              ariaLabel={`Spielfeld, Formation ${FORMATIONS[run.formation].label}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
