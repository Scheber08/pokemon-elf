import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { FORMATIONS } from '../config/formations';
import { TYPE_KEYS, TYPES } from '../config/pokemonTypes';
import { REGIONS } from '../config/regions';
import { useT } from '../i18n';
import {
  canReroll,
  candidates,
  isComplete,
  isFreeSlot,
  isLegend,
  legendBlocked,
  legendsUsed,
  MODE_RULES,
  rerollsLeft,
  totalRounds,
  type EngineData,
  type RerollKind,
  type RunState,
} from '../lib/challengeEngine';
import { createClickGuard } from '../lib/clickGuard';
import type { Pokemon, SpriteStyle } from '../types';
import { TypeBadges } from './Badges';
import { RollCard, StatusLine, useRolling } from './ChallengeParts';
import { CaptainPicker } from './CaptainPicker';
import { JerseyEditor } from './JerseyEditor';
import { useJerseys } from '../state/useJerseys';
import { useKit } from '../state/useKit';
import { useCheer } from '../state/useCheer';
import { KitPicker } from './KitPicker';
import { Pitch, type SlotState } from './Pitch';
import { PokemonGrid } from './PokemonGrid';
import { Sprite } from './Sprite';
import '../styles/run.css';
import { useCrest } from '../state/useCrest';
import { usePokemonData } from '../state/PokemonData';
import { CrestEditor } from './CrestEditor';

/** So lange nach einem Reroll werden weitere Reroll-Klicks ignoriert (Doppelklick-Schutz). */
const REROLL_LOCK_MS = 400;

interface Props {
  state: RunState;
  data: EngineData;
  /** Sprite-Stil aus den Einstellungen – Retro 34–0 nutzt immer 'retro' */
  sprite: SpriteStyle;
  onReroll: (kind: RerollKind) => void;
  onPlace: (pokemonId: number, slot: number) => void;
  onFinish: () => void;
  /** Auswertung läuft – „Ergebnis ansehen" gesperrt */
  finishing: boolean;
  /** Senden gescheitert: Button heißt „Erneut senden" und es gibt „Offline auswerten" */
  onFinishOffline?: () => void;
  /** Ohne onAbort kein „Run abbrechen" */
  onAbort?: () => void;
  /** Zusätzliches Element in der Statuszeile, z. B. <RunModeBadge> oder Tageslabel */
  statusExtra?: ReactNode;
  /** Hinweise/Fehler über der Statuszeile */
  notice?: ReactNode;
  /** Kapitän (Pokémon-ID) – wählbar, sobald die Elf steht; zählt in der Wertung doppelt */
  captain?: number | null;
  onCaptain?: (pokemonId: number | null) => void;
}

/**
 * Spielfläche aller Challenges – gesteuert über MODE_RULES[challenge].roll:
 *   'region+type'  Region + Typ würfeln, Pokémon aus den Kandidaten wählen
 *   'type'         nur Typ würfeln (Retro 34–0)
 *   'pokemon'      ein Pokémon würfeln, das direkt gesetzt wird (151 Challenge)
 * Der Zustand liegt komplett in der Engine; hier gibt es nur Auswahl + Animation.
 */
export function RunBoard({
  state,
  data,
  sprite,
  onReroll,
  onPlace,
  onFinish,
  finishing,
  onFinishOffline,
  onAbort,
  statusExtra,
  notice,
  captain = null,
  onCaptain,
}: Props) {
  const t = useT();
  const tc = t.challenge;
  const { challenge, formation, ssEnabled } = state.config;
  const rules = MODE_RULES[challenge];
  const { scale } = usePokemonData();
  // Eigene Trikotnummern je Challenge (Gerät) – reine Optik, der Run bleibt unberührt
  const [jerseys, setJerseys] = useJerseys(challenge);
  const [kit, setKit] = useKit(challenge);
  const [cheer, setCheer] = useCheer(challenge);
  const [crest, setCrest] = useCrest(challenge);
  const style: SpriteStyle = challenge === 'retro340' ? 'retro' : sprite;
  const total = totalRounds(state.config);
  const complete = isComplete(state);
  const roll = state.roll;
  /** Ändert sich mit jedem neuen Wurf (neue Runde oder Reroll). */
  const rollKey = `${state.round}:${state.roundRerolls.length}`;
  const { rolling, start: startRolling, skip } = useRolling(rules.roll === 'pokemon' ? 1000 : 1100);
  const [pick, setPick] = useState<{ key: string; id: number } | null>(null);
  const pitchRef = useRef<HTMLDivElement>(null);
  /**
   * Verhindert doppelte Rerolls per Doppelklick – zeitbasiert, weil der zweite Klick schon den
   * neuen Wurf sieht und `rolling` bei reduzierter Bewegung nie sperrt.
   */
  const [acceptReroll] = useState(() => createClickGuard(REROLL_LOCK_MS));
  const titleId = useId();
  const regionReel = useMemo(() => REGIONS.map((r) => t.game.region[r.gen]), [t]);
  const typeReel = useMemo(() => TYPE_KEYS.map((k) => t.game.type[k]), [t]);

  // Jeder neue Wurf wird animiert – auch der erste nach dem Start. Bewusst nur an rollKey
  // gebunden: startRolling ist bei jedem Render neu, soll aber nur bei neuem Wurf laufen.
  useEffect(() => {
    if (!complete) startRolling();
  }, [rollKey]);

  const selectedId =
    rules.roll === 'pokemon' ? roll?.pokemonId ?? null : pick && pick.key === rollKey ? pick.id : null;
  const selected = selectedId != null ? data.byId.get(selectedId) : undefined;
  const legends = legendsUsed(state, data);

  const cands = useMemo(
    () =>
      rules.roll === 'pokemon'
        ? []
        : candidates(state, data).sort((a, b) => Number(isLegend(a)) - Number(isLegend(b)) || a.id - b.id),
    [state, data, rules.roll],
  );

  const monReel = useMemo(
    () =>
      rules.roll !== 'pokemon'
        ? []
        : data.list
            .filter((p) => rules.pool === 'all' || p.gen === 1)
            .map((p) => (
              <span key={p.id} className="rollmon">
                <span className="rollmon__ball" aria-hidden="true" />
                <span>{t.game.pokemon(p)}</span>
              </span>
            )),
    [data, rules, t],
  );

  const choose = (p: Pokemon) => {
    const deselect = selectedId === p.id;
    setPick(deselect ? null : { key: rollKey, id: p.id });
    if (!deselect && window.matchMedia('(max-width: 899px)').matches) {
      window.setTimeout(() => pitchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };

  const onSlotClick = (i: number) => {
    if (complete || rolling || finishing || selectedId == null || !isFreeSlot(state, i)) return;
    onPlace(selectedId, i);
  };

  const slotState = (i: number): SlotState => {
    if (complete) return undefined;
    if (!isFreeSlot(state, i)) return 'locked';
    return selectedId != null && !rolling ? 'target' : undefined;
  };

  const rerollButton = (kind: RerollKind, label: (left: number) => string) => {
    const left = rerollsLeft(state, kind);
    const possible = canReroll(state, kind, data);
    return (
      <button
        key={kind}
        type="button"
        className="btn btn--small"
        disabled={!possible || rolling}
        title={left > 0 && !possible ? tc.noOtherRoll : undefined}
        onClick={() => {
          if (acceptReroll()) onReroll(kind);
        }}
      >
        {label(left)}
      </button>
    );
  };
  const usedUp = tc.rerollsLeft;

  const status: ReactNode[] = [
    complete ? (
      <>{tc.allPlaced}</>
    ) : (
      <>
        {tc.round} <strong>{state.round}/{total}</strong>
      </>
    ),
  ];
  if (challenge === 'c151') status.push(<>{tc.original151}</>);
  if (challenge === 'retro340') status.push(<>{t.game.challenge.retro340}</>);
  if (rules.maxLegends != null) {
    status.push(
      <>
        {tc.legends} <strong>{legends}/{rules.maxLegends}</strong>
      </>,
    );
  }
  if (rules.rerolls.pokemon > 0) {
    status.push(
      <>
        {tc.rerolls} <strong>{rerollsLeft(state, 'pokemon')}</strong>
      </>,
    );
  }
  if (statusExtra) status.push(statusExtra);

  const typeInfo = roll?.type ? TYPES[roll.type] : null;
  const typeLabel = roll?.type ? t.game.type[roll.type] : '';
  const rolled = rules.roll === 'pokemon' ? selected : undefined;

  return (
    <div className={`challenge__play ${challenge === 'retro340' ? 'challenge--retro' : ''}`}>
      <div className="challenge__controls">
        {notice}
        <StatusLine items={status} />

        {!complete && rules.roll === 'region+type' && roll && typeInfo && (
          <>
            <div className="rollcards">
              <RollCard
                label={tc.region}
                rolling={rolling}
                value={t.game.region[roll.region ?? 0] || '?'}
                reel={regionReel}
                onSkip={skip}
              />
              <RollCard
                label={tc.type}
                rolling={rolling}
                value={typeLabel}
                reel={typeReel}
                color={typeInfo.color}
                textColor={typeInfo.text}
                onSkip={skip}
              />
            </div>
            <div className="reroll-row">
              {rerollButton('type', (left) => tc.rerollType(usedUp(left)))}
              {rerollButton('region', (left) => tc.rerollRegion(usedUp(left)))}
            </div>
          </>
        )}

        {!complete && rules.roll === 'type' && roll && typeInfo && (
          <>
            <div className="rollcards rollcards--single">
              <RollCard
                label={tc.type}
                rolling={rolling}
                value={typeLabel}
                reel={typeReel}
                color={typeInfo.color}
                textColor={typeInfo.text}
                onSkip={skip}
              />
            </div>
            <div className="reroll-row">{rerollButton('type', (left) => tc.rerollType(usedUp(left)))}</div>
          </>
        )}

        {!complete && rules.roll === 'pokemon' && rolled && (
          <>
            <RollCard
              label={tc.yourPokemon}
              rolling={rolling}
              onSkip={skip}
              reel={monReel}
              value={
                <span className="rollmon rollmon--final">
                  <Sprite pokemon={rolled} style={style} loading="eager" />
                  <span>
                    <small>{t.game.dexNo(rolled.id)}</small>
                    {t.game.pokemon(rolled)}
                    <TypeBadges types={rolled.types} small />
                  </span>
                </span>
              }
            />
            <div className="reroll-row">{rerollButton('pokemon', tc.rerollPokemon)}</div>
            {!rolling && (
              <p className="hint hint--active" aria-live="polite">
                {tc.placeRolledBefore}
                <strong>{t.game.pokemon(rolled)}</strong>
                {tc.placeRolledAfter}
              </p>
            )}
          </>
        )}

        {!complete && rules.roll !== 'pokemon' && !rolling && (
          <section aria-labelledby={titleId} className="cands">
            <h2 id={titleId} className="section-title">
              {tc.choose} <span className="muted">({cands.length})</span>
            </h2>
            <p className={`hint ${selected ? 'hint--active' : ''}`} aria-live="polite">
              {selected ? (
                <>
                  <strong>{t.game.pokemon(selected)}</strong>
                  {tc.selectedAfter}
                </>
              ) : rules.roll === 'type' ? (
                tc.hintType
              ) : (
                tc.hintRegionType
              )}
            </p>
            <PokemonGrid
              items={cands}
              sprite={style}
              selectedId={selectedId}
              onPick={choose}
              disabledReason={(p) => (legendBlocked(state, p, data) ? tc.legendLimit(rules.maxLegends ?? 0) : null)}
              className="pgrid-wrap--compact"
            />
          </section>
        )}

        {complete && (
          <div className="done-box card">
            <p>{tc.done}</p>
            {onCaptain && (
              <CaptainPicker formation={formation} slots={state.slots} captain={captain} onChange={onCaptain} disabled={finishing} scale={scale(rules.scale)} />
            )}
            <button
              type="button"
              className="btn btn--primary btn--big"
              onClick={onFinish}
              disabled={finishing}
              aria-busy={finishing}
            >
              {finishing ? tc.seasonRunning : onFinishOffline ? tc.resend : tc.showResult}
            </button>
            {onFinishOffline && (
              <button type="button" className="btn btn--ghost btn--small" onClick={onFinishOffline} disabled={finishing}>
                {tc.finishOffline}
              </button>
            )}
          </div>
        )}

        {onAbort && (
          <button
            type="button"
            className="btn btn--ghost btn--small abort"
            disabled={finishing}
            onClick={() => window.confirm(tc.abortConfirm) && onAbort()}
          >
            {tc.abort}
          </button>
        )}
      </div>

      <div className="challenge__pitch" ref={pitchRef}>
        <Pitch
          formation={formation}
          slots={state.slots}
          ss={ssEnabled ? state.ss : undefined}
          sprite={style}
          onSlotClick={onSlotClick}
          slotState={slotState}
          ariaLabel={tc.pitchAria(FORMATIONS[formation].label)}
          jerseys={jerseys}
          captain={captain}
        />
      </div>
      <KitPicker kit={kit} onChange={setKit} cheer={cheer} onCheer={setCheer} />
      <CrestEditor crest={crest} onChange={setCrest} pokemon={[...state.slots, ssEnabled ? state.ss : null].filter((x): x is number => x != null)} />
      <JerseyEditor formation={formation} slots={state.slots} ss={ssEnabled ? state.ss : null} jerseys={jerseys} onChange={setJerseys} />
    </div>
  );
}

/** Online-Status im Setup: kommen Runs in die Rangliste? */
export function OnlineNote({ online }: { online: boolean | null }) {
  const t = useT();
  const [mod, text] =
    online == null
      ? ['checking', t.challenge.netChecking]
      : online
        ? ['online', t.challenge.netOnline]
        : ['offline', t.challenge.netOffline];
  return (
    <p className={`runnet runnet--${mod}`} role="status">
      <span className="runnet__dot" aria-hidden="true" />
      {text}
    </p>
  );
}

/** Hinweis- bzw. Fehlerzeile mit optionalem Schließen-Knopf. */
export function RunNotice({ children, error, onClose }: { children: ReactNode; error?: boolean; onClose?: () => void }) {
  const t = useT();
  return (
    <p className={`notice run-notice ${error ? 'notice--error' : ''}`} role={error ? 'alert' : 'status'}>
      <span className="run-notice__text">{children}</span>
      {onClose && (
        <button type="button" className="run-notice__close" aria-label={t.challenge.closeNotice} onClick={onClose}>
          ×
        </button>
      )}
    </p>
  );
}

/** Kleines Badge für die Statuszeile: gewerteter Online-Run oder lokaler Run. */
export function RunModeBadge({ online }: { online: boolean }) {
  const t = useT();
  return (
    <span
      className={`runbadge ${online ? 'runbadge--ranked' : 'runbadge--offline'}`}
      title={online ? t.challenge.badgeRankedTitle : t.challenge.badgeOfflineTitle}
    >
      {online ? t.challenge.badgeRanked : t.challenge.badgeOffline}
    </span>
  );
}
