import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FORMATION } from '../config/formations';
import { TYPE_KEYS, TYPES } from '../config/pokemonTypes';
import { HowItWorks, RollCard, RunSetup, StatCards, StatusLine, useRolling } from '../components/ChallengeParts';
import { TypeBadges } from '../components/Badges';
import { Pitch, SS_INDEX, type SlotState } from '../components/Pitch';
import { PokemonGrid } from '../components/PokemonGrid';
import { Segmented } from '../components/Segmented';
import { SeasonResultView } from '../components/SeasonResultView';
import { Sprite } from '../components/Sprite';
import { dexNo } from '../components/StatTooltip';
import { loadStats } from '../lib/challengeStats';
import { emptySlots } from '../lib/formation';
import { randomSeed, shuffle } from '../lib/rng';
import { computeRun, recordFinishedRun } from '../lib/runFinish';
import { load, remove, save, STORAGE_KEYS } from '../lib/storage';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import type { ChallengeKey, FormationId, Pokemon, Slots, SpriteStyle, TypeKey } from '../types';

type Mode = 'classic' | 'retro';
const STORAGE_ID = 'c151';
const REROLLS = 5;
const MAX_LEGENDS = 2;
const challengeKey = (m: Mode): ChallengeKey => (m === 'classic' ? 'c151' : 'retro340');

interface Run {
  phase: 'setup' | 'draft' | 'done' | 'result';
  mode: Mode;
  formation: FormationId;
  ssEnabled: boolean;
  teamName: string;
  slots: Slots;
  ss: number | null;
  round: number;
  /** Klassisch: das gewürfelte Pokémon */
  current: number | null;
  rerollsLeft: number;
  /** Retro 34–0: gewürfelter Typ + Auswahl */
  type: TypeKey;
  typeRerolled: boolean;
  selected: number | null;
  seed: number | null;
  entryId: string | null;
}

const NEW_RUN: Run = {
  phase: 'setup',
  mode: 'classic',
  formation: DEFAULT_FORMATION,
  ssEnabled: false,
  teamName: '',
  slots: emptySlots(DEFAULT_FORMATION),
  ss: null,
  round: 1,
  current: null,
  rerollsLeft: REROLLS,
  type: 'normal',
  typeRerolled: false,
  selected: null,
  seed: null,
  entryId: null,
};

const isLegend = (p: Pokemon) => !!(p.leg || p.myth);

export function Challenge151() {
  const { list, byId, scale } = usePokemonData();
  const settings = useSettings();
  const [run, setRun] = useState<Run>(() => ({ ...NEW_RUN, ...load<Partial<Run>>(STORAGE_KEYS.run(STORAGE_ID), {}) }));
  const [statsByMode, setStatsByMode] = useState(() => ({ classic: loadStats('c151'), retro: loadStats('retro340') }));
  const { rolling, start: startRolling, skip } = useRolling(1000);
  const pitchRef = useRef<HTMLDivElement>(null);

  useEffect(() => save(STORAGE_KEYS.run(STORAGE_ID), run), [run]);

  const gen1 = useMemo(() => list.filter((p) => p.gen === 1), [list]);
  const sprite: SpriteStyle = run.mode === 'retro' ? 'retro' : settings.sprite;
  const totalRounds = 11 + (run.ssEnabled ? 1 : 0);
  const usedIds = useMemo(
    () => new Set([...run.slots, run.ss].filter((id): id is number => id != null)),
    [run.slots, run.ss],
  );
  const legendsUsed = [...usedIds].filter((id) => isLegend(byId.get(id)!)).length;

  const rollPokemon = (used: Set<number>, exclude?: number | null) => {
    const pool = gen1.filter((p) => !used.has(p.id) && p.id !== exclude);
    return pool[Math.floor(Math.random() * pool.length)]?.id ?? null;
  };
  const typeCandidates = (type: TypeKey, used: Set<number>) =>
    gen1.filter((p) => p.types.includes(type) && !used.has(p.id));
  const rollType = (used: Set<number>, legends: number, exclude?: TypeKey) => {
    const options = shuffle(Math.random, TYPE_KEYS.filter((t) => t !== exclude));
    return (
      options.find((t) => typeCandidates(t, used).some((p) => !isLegend(p) || legends < MAX_LEGENDS)) ?? null
    );
  };

  const candidates = useMemo(
    () =>
      run.mode === 'retro'
        ? gen1.filter((p) => p.types.includes(run.type) && !usedIds.has(p.id))
        : [],
    [run.mode, run.type, usedIds, gen1],
  );

  const startRun = () => {
    const used = new Set<number>();
    setRun((r) => ({
      ...NEW_RUN,
      mode: r.mode,
      formation: r.formation,
      ssEnabled: r.ssEnabled,
      teamName: r.teamName,
      slots: emptySlots(r.formation),
      phase: 'draft',
      current: r.mode === 'classic' ? rollPokemon(used) : null,
      type: r.mode === 'retro' ? rollType(used, 0) ?? 'normal' : 'normal',
    }));
    startRolling();
  };

  const rerollPokemon = () => {
    if (run.rerollsLeft <= 0) return;
    setRun((r) => ({ ...r, current: rollPokemon(usedIds, r.current), rerollsLeft: r.rerollsLeft - 1 }));
    startRolling();
  };

  const rerollType = () => {
    if (run.typeRerolled) return;
    const type = rollType(usedIds, legendsUsed, run.type);
    if (!type) return;
    setRun((r) => ({ ...r, type, typeRerolled: true, selected: null }));
    startRolling();
  };

  const freeSlot = (i: number) => (i === SS_INDEX ? run.ssEnabled && run.ss == null : run.slots[i] == null);
  const placing = run.mode === 'classic' ? run.current : run.selected;

  const place = (index: number) => {
    if (run.phase !== 'draft' || placing == null || rolling || !freeSlot(index)) return;
    const id = placing;
    const slots = index === SS_INDEX ? run.slots : run.slots.map((v, i) => (i === index ? id : v));
    const ss = index === SS_INDEX ? id : run.ss;
    const used = new Set([...slots, ss].filter((x): x is number => x != null));
    const legends = [...used].filter((x) => isLegend(byId.get(x)!)).length;
    const round = run.round + 1;
    if (round > totalRounds) {
      setRun((r) => ({ ...r, slots, ss, round, current: null, selected: null, phase: 'done' }));
      return;
    }
    if (run.mode === 'classic') {
      setRun((r) => ({ ...r, slots, ss, round, current: rollPokemon(used) }));
    } else {
      setRun((r) => ({ ...r, slots, ss, round, selected: null, type: rollType(used, legends) ?? r.type }));
    }
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
    const computed = computeRun(input, byId, scale('gen1'));
    const { stats, entryId } = await recordFinishedRun(challengeKey(run.mode), input, computed);
    setStatsByMode((s) => ({ ...s, [run.mode]: stats }));
    setRun((r) => ({ ...r, phase: 'result', seed, entryId }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const newRun = () => {
    remove(STORAGE_KEYS.run(STORAGE_ID));
    setRun((r) => ({ ...NEW_RUN, mode: r.mode, formation: r.formation, ssEnabled: r.ssEnabled, teamName: r.teamName }));
  };

  const slotState = (i: number): SlotState => {
    if (run.phase !== 'draft') return undefined;
    if (!freeSlot(i)) return 'locked';
    return placing != null && !rolling ? 'target' : undefined;
  };

  const stats = statsByMode[run.mode];

  if (run.phase === 'result' && run.seed != null) {
    return (
      <div className="page">
        <SeasonResultView
          challenge={challengeKey(run.mode)}
          input={{
            formation: run.formation,
            slots: run.slots,
            ss: run.ssEnabled ? run.ss : undefined,
            teamName: run.teamName,
            seed: run.seed,
          }}
          scaleKind="gen1"
          sprite={sprite}
          entryId={run.entryId}
          onNewRun={newRun}
        />
        <StatCards stats={stats} />
      </div>
    );
  }

  const current = run.current != null ? byId.get(run.current) : undefined;
  const selected = run.selected != null ? byId.get(run.selected) : undefined;
  const reel = gen1;
  const typeInfo = TYPES[run.type];

  return (
    <div className={`page challenge ${run.mode === 'retro' ? 'challenge--retro' : ''}`}>
      <header className="page-head">
        <h1 className="page-title">{run.mode === 'classic' ? '151 Challenge' : 'Retro 34–0'}</h1>
        <p className="page-lead">Nur die Original-151. Eigene Gen-1-Skalierung, eigene Rangliste.</p>
      </header>

      {run.phase === 'setup' ? (
        <div className="challenge__setup">
          <div>
            <HowItWorks>
              {run.mode === 'classic'
                ? 'Jede Runde würfelt ein zufälliges Pokémon aus den Original-151. Setze es auf einen beliebigen freien Platz, fülle alle 11 und spiel dann eine Saison mit 34 Spielen. Schaffst du 34–0?'
                : 'Retro-Look, Gen-1-Skalierung: Jede Runde würfelt einen Typ. Wähle ein passendes Pokémon aus den Original-151 und setze es auf einen freien Platz, mit höchstens 2 Legendären. Fülle alle 11 Plätze und spiel eine Saison mit 34 Spielen. Schaffst du 34–0?'}
            </HowItWorks>
            <StatCards stats={stats} />
          </div>
          <RunSetup
            formation={run.formation}
            ssEnabled={run.ssEnabled}
            teamName={run.teamName}
            onChange={(v) => setRun((r) => ({ ...r, ...v, slots: emptySlots(v.formation) }))}
            onStart={startRun}
            extra={
              <Segmented
                label="Modus"
                value={run.mode}
                onChange={(mode) => setRun((r) => ({ ...r, mode }))}
                options={[
                  { value: 'classic', label: '151 Challenge' },
                  { value: 'retro', label: 'Retro 34–0' },
                ]}
              />
            }
          />
        </div>
      ) : (
        <div className="challenge__play">
          <div className="challenge__controls">
            <StatusLine
              items={
                run.mode === 'classic'
                  ? [
                      <>
                        Runde <strong>{Math.min(run.round, totalRounds)}/{totalRounds}</strong>
                      </>,
                      <>Original 151</>,
                      <>
                        Neu würfeln: <strong>{run.rerollsLeft}</strong>
                      </>,
                    ]
                  : [
                      <>
                        Runde <strong>{Math.min(run.round, totalRounds)}/{totalRounds}</strong>
                      </>,
                      <>Retro 34–0</>,
                      <>
                        Legendäre <strong>{legendsUsed}/{MAX_LEGENDS}</strong>
                      </>,
                    ]
              }
            />

            {run.phase === 'draft' && run.mode === 'classic' && current && (
              <>
                <RollCard
                  label="Dein Pokémon"
                  rolling={rolling}
                  onSkip={skip}
                  reel={reel.map((p) => (
                    <span key={p.id} className="rollmon">
                      <span className="rollmon__ball" aria-hidden="true" />
                      <span>{p.de}</span>
                    </span>
                  ))}
                  value={
                    <span className="rollmon rollmon--final">
                      <Sprite pokemon={current} style={sprite} loading="eager" />
                      <span>
                        <small>{dexNo(current.id)}</small>
                        {current.de}
                        <TypeBadges types={current.types} small />
                      </span>
                    </span>
                  }
                />
                <div className="reroll-row">
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={run.rerollsLeft <= 0 || rolling}
                    onClick={rerollPokemon}
                  >
                    Pokémon neu würfeln ({run.rerollsLeft})
                  </button>
                </div>
                {!rolling && (
                  <p className="hint hint--active" aria-live="polite">
                    Klicke auf einen freien Platz auf dem Feld, um <strong>{current.de}</strong> festzulegen.
                  </p>
                )}
              </>
            )}

            {run.phase === 'draft' && run.mode === 'retro' && (
              <>
                <div className="rollcards rollcards--single">
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
                  <button type="button" className="btn btn--small" disabled={run.typeRerolled || rolling} onClick={rerollType}>
                    Typ neu würfeln {run.typeRerolled ? '(verbraucht)' : '(1×)'}
                  </button>
                </div>
                {!rolling && (
                  <section aria-labelledby="cands151-title" className="cands">
                    <h2 id="cands151-title" className="section-title">
                      Wähle ein Pokémon <span className="muted">({candidates.length})</span>
                    </h2>
                    <p className={`hint ${selected ? 'hint--active' : ''}`} aria-live="polite">
                      {selected ? (
                        <>
                          <strong>{selected.de}</strong> gewählt. Klicke auf einen freien Platz auf dem Feld, um ihn
                          festzulegen.
                        </>
                      ) : (
                        'Wähle ein Pokémon dieses Typs aus den Original-151.'
                      )}
                    </p>
                    <PokemonGrid
                      items={candidates}
                      sprite={sprite}
                      selectedId={run.selected}
                      onPick={(p) => {
                        setRun((r) => ({ ...r, selected: r.selected === p.id ? null : p.id }));
                        if (window.matchMedia('(max-width: 899px)').matches) {
                          setTimeout(() => pitchRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
                        }
                      }}
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
            />
          </div>
        </div>
      )}
    </div>
  );
}
