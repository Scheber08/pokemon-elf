import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { FORMATIONS } from '../config/formations';
import { TYPE_KEYS, TYPES } from '../config/pokemonTypes';
import { REGIONS, regionName } from '../config/regions';
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
import { Pitch, type SlotState } from './Pitch';
import { PokemonGrid } from './PokemonGrid';
import { Sprite } from './Sprite';
import { dexNo } from './StatTooltip';
import '../styles/run.css';

/** So lange nach einem Reroll werden weitere Reroll-Klicks ignoriert (Doppelklick-Schutz). */
const REROLL_LOCK_MS = 400;

const REGION_REEL = REGIONS.map((r) => r.name);
const TYPE_REEL = TYPE_KEYS.map((t) => TYPES[t].de);

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
}: Props) {
  const { challenge, formation, ssEnabled } = state.config;
  const rules = MODE_RULES[challenge];
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
                <span>{p.de}</span>
              </span>
            )),
    [data, rules],
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
        title={left > 0 && !possible ? 'Kein anderer Wurf möglich' : undefined}
        onClick={() => {
          if (acceptReroll()) onReroll(kind);
        }}
      >
        {label(left)}
      </button>
    );
  };
  const usedUp = (left: number) => (left > 0 ? `(${left}×)` : '(verbraucht)');

  const status: ReactNode[] = [
    complete ? (
      <>Alle Plätze belegt</>
    ) : (
      <>
        Runde <strong>{state.round}/{total}</strong>
      </>
    ),
  ];
  if (challenge === 'c151') status.push(<>Original 151</>);
  if (challenge === 'retro340') status.push(<>Retro 34–0</>);
  if (rules.maxLegends != null) {
    status.push(
      <>
        Legendäre <strong>{legends}/{rules.maxLegends}</strong>
      </>,
    );
  }
  if (rules.rerolls.pokemon > 0) {
    status.push(
      <>
        Neu würfeln: <strong>{rerollsLeft(state, 'pokemon')}</strong>
      </>,
    );
  }
  if (statusExtra) status.push(statusExtra);

  const typeInfo = roll?.type ? TYPES[roll.type] : null;
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
                label="Region"
                rolling={rolling}
                value={regionName(roll.region ?? 0)}
                reel={REGION_REEL}
                onSkip={skip}
              />
              <RollCard
                label="Typ"
                rolling={rolling}
                value={typeInfo.de}
                reel={TYPE_REEL}
                color={typeInfo.color}
                textColor={typeInfo.text}
                onSkip={skip}
              />
            </div>
            <div className="reroll-row">
              {rerollButton('type', (left) => `Typ neu würfeln ${usedUp(left)}`)}
              {rerollButton('region', (left) => `Region neu würfeln ${usedUp(left)}`)}
            </div>
          </>
        )}

        {!complete && rules.roll === 'type' && roll && typeInfo && (
          <>
            <div className="rollcards rollcards--single">
              <RollCard
                label="Typ"
                rolling={rolling}
                value={typeInfo.de}
                reel={TYPE_REEL}
                color={typeInfo.color}
                textColor={typeInfo.text}
                onSkip={skip}
              />
            </div>
            <div className="reroll-row">{rerollButton('type', (left) => `Typ neu würfeln ${usedUp(left)}`)}</div>
          </>
        )}

        {!complete && rules.roll === 'pokemon' && rolled && (
          <>
            <RollCard
              label="Dein Pokémon"
              rolling={rolling}
              onSkip={skip}
              reel={monReel}
              value={
                <span className="rollmon rollmon--final">
                  <Sprite pokemon={rolled} style={style} loading="eager" />
                  <span>
                    <small>{dexNo(rolled.id)}</small>
                    {rolled.de}
                    <TypeBadges types={rolled.types} small />
                  </span>
                </span>
              }
            />
            <div className="reroll-row">{rerollButton('pokemon', (left) => `Pokémon neu würfeln (${left})`)}</div>
            {!rolling && (
              <p className="hint hint--active" aria-live="polite">
                Klicke auf einen freien Platz auf dem Feld, um <strong>{rolled.de}</strong> festzulegen.
              </p>
            )}
          </>
        )}

        {!complete && rules.roll !== 'pokemon' && !rolling && (
          <section aria-labelledby={titleId} className="cands">
            <h2 id={titleId} className="section-title">
              Wähle ein Pokémon <span className="muted">({cands.length})</span>
            </h2>
            <p className={`hint ${selected ? 'hint--active' : ''}`} aria-live="polite">
              {selected ? (
                <>
                  <strong>{selected.de}</strong> gewählt. Klicke auf einen freien Platz auf dem Feld, um ihn festzulegen.
                </>
              ) : rules.roll === 'type' ? (
                'Wähle ein Pokémon dieses Typs aus den Original-151.'
              ) : (
                'Wähle ein Pokémon, das zu Region und Typ passt. Festgelegte Spieler bleiben stehen.'
              )}
            </p>
            <PokemonGrid
              items={cands}
              sprite={style}
              selectedId={selectedId}
              onPick={choose}
              disabledReason={(p) =>
                legendBlocked(state, p, data) ? `Schon ${rules.maxLegends} Legendäre im Team` : null
              }
              className="pgrid-wrap--compact"
            />
          </section>
        )}

        {complete && (
          <div className="done-box card">
            <p>Deine Elf steht. Zeit für die Saison!</p>
            <button
              type="button"
              className="btn btn--primary btn--big"
              onClick={onFinish}
              disabled={finishing}
              aria-busy={finishing}
            >
              {finishing ? 'Saison läuft …' : onFinishOffline ? 'Erneut senden' : 'Ergebnis ansehen'}
            </button>
            {onFinishOffline && (
              <button type="button" className="btn btn--ghost btn--small" onClick={onFinishOffline} disabled={finishing}>
                Offline auswerten (ohne Wertung)
              </button>
            )}
          </div>
        )}

        {onAbort && (
          <button
            type="button"
            className="btn btn--ghost btn--small abort"
            disabled={finishing}
            onClick={() => window.confirm('Run wirklich abbrechen?') && onAbort()}
          >
            Run abbrechen
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
          ariaLabel={`Spielfeld, Formation ${FORMATIONS[formation].label}`}
        />
      </div>
    </div>
  );
}

/** Online-Status im Setup: kommen Runs in die Rangliste? */
export function OnlineNote({ online }: { online: boolean | null }) {
  const [mod, text] =
    online == null
      ? ['checking', 'Verbindung wird geprüft …']
      : online
        ? ['online', 'Online – deine Runs kommen in die Rangliste']
        : ['offline', 'Offline – Runs werden nur lokal gespeichert'];
  return (
    <p className={`runnet runnet--${mod}`} role="status">
      <span className="runnet__dot" aria-hidden="true" />
      {text}
    </p>
  );
}

/** Hinweis- bzw. Fehlerzeile mit optionalem Schließen-Knopf. */
export function RunNotice({ children, error, onClose }: { children: ReactNode; error?: boolean; onClose?: () => void }) {
  return (
    <p className={`notice run-notice ${error ? 'notice--error' : ''}`} role={error ? 'alert' : 'status'}>
      <span className="run-notice__text">{children}</span>
      {onClose && (
        <button type="button" className="run-notice__close" aria-label="Hinweis schließen" onClick={onClose}>
          ×
        </button>
      )}
    </p>
  );
}

/** Kleines Badge für die Statuszeile: gewerteter Online-Run oder lokaler Run. */
export function RunModeBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`runbadge ${online ? 'runbadge--ranked' : 'runbadge--offline'}`}
      title={online ? 'Dieser Run kommt in die Online-Rangliste' : 'Dieser Run wird nur lokal gespeichert'}
    >
      {online ? 'Gewertet' : 'Offline'}
    </span>
  );
}
