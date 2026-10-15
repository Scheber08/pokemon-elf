import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { useT } from '../i18n';
import { DRAFT_BENCH_SLOT, DRAFT_REROLL_KINDS, type DraftRerollKind, type DraftSnapshot, type DraftTeam } from '../lib/api/draftContract';
import {
  allowedPicks,
  autoPickChoice,
  autoPickOpensAt,
  canReroll,
  DRAFT_SS_SLOT,
  effectiveRoll,
  freeSlots,
  legendsOf,
  pickAllowed,
  kindOf,
  poolHasLegends,
  poolHasMegas,
  poolHasUltraBeasts,
  poolOf,
  rerollsLeft,
  rerollUsable,
  picksUntilTurn,
} from '../lib/draftEngine';
import { positionFit } from '../lib/fit';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import {
  draftedKey,
  ownerOfPicks,
  pickAnnouncement,
  pickFeed,
  snapshotState,
  teamLabel,
  type DraftRoom,
} from '../state/useDraftRoom';
import type { Pokemon, PosCode } from '../types';
import { TypeBadge } from './Badges';
import { BenchRow } from './BenchRow';
import { CaptainPicker } from './CaptainPicker';
import { JerseyEditor } from './JerseyEditor';
import { DraftBoard, DraftPickFeed } from './DraftBoard';
import { DraftQueue } from './DraftQueue';
import { DraftCountdown } from './DraftCountdown';
import { FilterBar, typingElsewhere, useFilteredPokemon, type PokemonFilters } from './FilterBar';
import { Pitch, type SlotState } from './Pitch';
import { PokemonGrid } from './PokemonGrid';
import { RunNotice } from './RunBoard';
import { KitPicker } from './KitPicker';
import '../styles/draft.css';
import { cleanKit } from '../lib/kits';
import { CrestEditor } from './CrestEditor';
import { cleanCrest } from '../lib/crest';
import { rosterOf } from '../lib/draftEngine';
import { SHINY_PARTY_CHANCE, shinyTeamBoost } from '../lib/shiny';

/** Draft-Slot schon besetzt? Feld, Standardschütze oder Bank (Manager-Saison). */
function slotFilled(team: DraftTeam, i: number): boolean {
  if (i === DRAFT_SS_SLOT) return team.ss != null;
  if (i >= DRAFT_BENCH_SLOT) return team.bench?.[i - DRAFT_BENCH_SLOT] != null;
  return team.slots[i] != null;
}

/** Schlüssel des aktuellen Wurfs (leer ohne Wurf) – ändert sich mit jedem neuen Wurf bzw. Reroll. */
function rollKeyOf(s: Pick<DraftSnapshot, 'roll'>): string {
  return s.roll ? `${s.roll.gen}|${s.roll.type}|${s.roll.own ? 1 : 0}` : '';
}

/**
 * Wurf des aktuellen Picks (Zufallsmodus) in der Statusleiste: Generation + Typ, „eigener Wurf"
 * und – nur für das Team am Zug – die Reroll-Knöpfe mit den übrigen Rerolls.
 */
function DraftRollBar({ room, readOnly }: { room: DraftRoom; readOnly: boolean }) {
  const t = useT();
  const { all: list } = usePokemonData();
  const whyId = useId();
  const s = room.state!;
  const roll = s.roll ?? null;
  const me = room.me;
  if (!roll) {
    return (
      <p className="draft-roll draft-roll--free">
        <span className="draft-roll__label">{t.online.roll}</span> {t.online.freeChoice}
      </p>
    );
  }
  const region = t.game.region[roll.gen] ?? '?';
  const round = s.roundRoll && roll.own ? s.roundRoll : null;
  // Reroll oder Pick unterwegs: kein Reroll (bei einem Snake-Doppelzug träfe er sonst schon den nächsten Wurf)
  const busy = room.busy.reroll || room.pending;
  const kinds = room.myTurn && me && !readOnly ? DRAFT_REROLL_KINDS.filter((k) => rerollUsable(s.settings, k)) : [];
  const button = (kind: DraftRerollKind) => {
    const left = rerollsLeft(s, me!.id, kind);
    const possible = canReroll(s, me!.id, kind, list);
    // Sichtbarer Grund statt Tooltip auf einem gesperrten Knopf (Tastatur, Touch)
    const reason = left <= 0 ? t.online.noRerollLeft : !possible ? t.online.noOtherRoll : null;
    const id = `${whyId}-${kind}`;
    return (
      <span key={kind} className="draft-roll__option">
        <button
          type="button"
          className="btn btn--small draft-roll__reroll"
          disabled={room.status !== 'open'}
          // Gesperrt bzw. unterwegs nicht disabled, damit der Tastaturfokus bleibt – gesendet wird nur, was geht
          aria-disabled={busy || !!reason || undefined}
          aria-busy={room.busy.reroll}
          aria-describedby={reason ? id : undefined}
          onClick={() => !busy && !reason && room.reroll(kind)}
        >
          {kind === 'type' ? t.online.rerollType(left) : t.online.rerollRegion(left)}
        </button>
        {reason && (
          <small id={id} className="draft-roll__why">
            {reason}
          </small>
        )}
      </span>
    );
  };
  return (
    <div className={`draft-roll ${room.myTurn ? 'is-mine' : ''}`}>
      {/* key: neuer Wurf → kurze Animation */}
      <p className="draft-roll__value" key={rollKeyOf(s)}>
        <span className="sr-only">{t.online.rollAria(region, t.game.type[roll.type])}</span>
        <span className="draft-roll__label" aria-hidden="true">
          {t.online.roll}
        </span>
        <strong className="draft-roll__gen" aria-hidden="true">
          {region}
        </strong>
        <span aria-hidden="true">
          <TypeBadge type={roll.type} />
        </span>
        {roll.own && (
          <span className="draft-roll__own" title={t.online.ownRollTitle}>
            {t.online.ownRoll}
          </span>
        )}
      </p>
      {round && (
        <span className="draft-roll__round">{t.online.roundRoll(t.game.region[round.gen] ?? '?', t.game.type[round.type])}</span>
      )}
      {kinds.length > 0 && <span className="draft-roll__actions">{kinds.map(button)}</span>}
    </div>
  );
}

/**
 * Team am Zug ist weg (offline bzw. ohne Timer sehr lange dran): Ab `opensAt` (Serverzeit) darf
 * jedes Mitglied für es wählen – vorher läuft ein Countdown. Eigene Komponente, damit nur sie tickt.
 */
function AutoPickNotice({ room, team, opensAt }: { room: DraftRoom; team: DraftTeam; opensAt: number }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now() + room.clockOffset);
  const wait = opensAt - now;
  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setNow(Date.now() + room.clockOffset), Math.min(1000, wait));
    return () => window.clearTimeout(id);
  }, [now, wait, room.clockOffset]);

  // Online und noch in der Bedenkzeit: kein Hinweis (ohne Timer kommt er erst nach afkMs)
  if (team.online && wait > 0) return null;
  const busy = room.busy['auto-pick'];
  return (
    <div className="notice draft-hostauto">
      <span>
        <strong>{teamLabel(team, t)}</strong> {team.online ? t.online.thinkingLong : t.online.isOffline}
        {wait > 0 && t.online.autoPickIn(Math.ceil(wait / 1000))}
      </span>
      {wait <= 0 && (
        <button
          type="button"
          className="btn btn--small"
          disabled={room.status !== 'open'}
          // Unterwegs nicht disabled, damit der Tastaturfokus bleibt (das Team kann gleich wieder dran sein)
          aria-disabled={busy || undefined}
          aria-busy={busy}
          onClick={() => !busy && room.autoPick(team.id)}
        >
          {busy ? t.online.autoPicking : t.online.autoPickFor(teamLabel(team, t))}
        </button>
      )}
    </div>
  );
}

/** Live-Draft: Wer ist dran, Timer, Pool, eigenes Feld, Board und Verlauf. readOnly: öffentliche Vorschau ohne Live-Verbindung. */
export function DraftLive({ room, readOnly = false }: { room: DraftRoom; readOnly?: boolean }) {
  const { all: list, byId, scale } = usePokemonData();
  const { sprite } = useSettings();
  const t = useT();
  const s = room.state!;
  const { me, current, myTurn, pending } = room;
  const [selected, setSelected] = useState<number | null>(null);
  const [suggestSlot, setSuggestSlot] = useState<number | null>(null);
  const [showTaken, setShowTaken] = useState(false);
  /** Pool nach „passt am besten auf meine freien Plätze" sortieren */
  const [bestFirst, setBestFirst] = useState(false);
  /** Nur Pokémon zeigen, die gerade erlaubt sind (Wurf, Legendären-Limit) */
  const [onlyFit, setOnlyFit] = useState(true);
  const [filters, setFilters] = useState<PokemonFilters>({ query: '', type: null, region: 0 });
  const [info, setInfo] = useState<string | null>(null);
  const pitchRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Höhe der klebenden Statusleiste → Abstand fürs klebende Spielfeld (CSS-Variable)
  useEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => root.style.setProperty('--draft-bar-h', `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // Stabile Listen: Jeder Schnappschuss ist ein neues Objekt – neu gerechnet wird nur, wenn sich
  // Pool, vergebene Pokémon bzw. der Wurf ändern (sonst springt das Raster bei jedem Online-Wechsel zurück).
  const { gens, types, legendary, mythical, maxLegends, maxUltraBeasts, maxMegas } = s.settings;
  const ultraBeasts = poolHasUltraBeasts(s.settings);
  const forms = !!s.settings.forms;
  const megas = poolHasMegas(s.settings);
  // poolOf hält den Pool je Einstellung fest (dasselbe Array, solange sich der Pool nicht ändert)
  const pool = poolOf({ gens, types, legendary, mythical, ultraBeasts, forms, megas }, list);
  const poolKey = `${gens.join(',')}|${types.join(',')}|${[legendary, mythical, ultraBeasts, forms, megas].map(Number).join('')}`;
  const takenKey = draftedKey(s);
  const owners = useMemo(() => ownerOfPicks(s), [takenKey]);
  const rollKey = rollKeyOf(s);
  // Was das eigene Team gerade wählen darf (Wurf nur am Zug, Legendären-Limit immer)
  const allowed = useMemo(
    () => (me ? new Set(allowedPicks(s, me.id, list).map((p) => p.id)) : null),
    [takenKey, rollKey, s.pickIndex, s.phase, me?.id, poolKey, maxLegends, maxUltraBeasts, maxMegas, list],
  );
  const myRoll = useMemo(() => (me ? effectiveRoll(s, me.id, list) : null), [allowed]);
  const freeCount = pool.length - owners.size;
  /** Die Regeln sperren gerade etwas aus dem freien Pool → Umschalter „Nur passende" */
  const restricted = !!allowed && allowed.size < freeCount;
  const fitOnly = restricted && onlyFit;
  // Freie eigene Plätze (Positionen) – Grundlage für „Beste zuerst"
  const freeKey = me ? freeSlots(me, s.settings).join(',') : '';
  const items = useMemo(() => {
    const shown = pool.filter((p) => (owners.has(p.id) ? showTaken : !fitOnly || allowed!.has(p.id)));
    if (!bestFirst || !me) return shown;
    const sc = scale('all');
    const defs = FORMATIONS[me.formation].slots;
    const positions = freeSlots(me, s.settings).map((slot) => (slot === DRAFT_SS_SLOT ? 'SS' : defs[slot].pos));
    if (!positions.length) return shown;
    // Wie der Auto-Pick: Fit × Positionsgewicht, der Standardschütze zählt halb
    const score = new Map(
      shown.map((p) => [
        p.id,
        Math.max(...positions.map((pos) => positionFit(p, pos, sc) * (pos === 'SS' ? 0.5 : 0.92 + 0.08 * POSITIONS[pos].teamWeight))),
      ]),
    );
    return [...shown].sort((a, b) => score.get(b.id)! - score.get(a.id)! || a.id - b.id);
  }, [pool, owners, showTaken, fitOnly, allowed, bestFirst, freeKey, me?.formation]);
  // Bestpassender freier Feldplatz eines Pokémon (Position und Fit) – für die Notiz auf den Karten
  const freeFieldPos = useMemo(() => {
    if (!me) return [];
    const defs = FORMATIONS[me.formation].slots;
    return [...new Set(freeSlots(me, s.settings).filter((slot) => slot !== DRAFT_SS_SLOT && defs[slot]).map((slot) => defs[slot].pos))];
  }, [freeKey, me?.formation]);
  const bestFreeFit = (p: Pokemon): { pos: PosCode; fit: number } | null => {
    if (!freeFieldPos.length) return null;
    const sc = scale('all');
    let best: { pos: PosCode; fit: number } | null = null;
    for (const pos of freeFieldPos) {
      const fit = Math.round(positionFit(p, pos, sc));
      if (!best || fit > best.fit) best = { pos, fit };
    }
    return best;
  };
  // Regionsfilter nur, solange er zu sehen ist (mehrere Generationen, kein eigener Wurf mit „Nur
  // passende") – ein vorher gewählter Wert bliebe sonst unsichtbar wirksam und leerte das Raster
  const regionShown = gens.length > 1 && !(fitOnly && myRoll);
  const effFilters = useMemo(
    () => (regionShown && gens.includes(filters.region) ? filters : { ...filters, region: 0 as const }),
    [filters, regionShown, gens.join(',')],
  );
  const filtered = useFilteredPokemon(items, effFilters);
  const feed = useMemo(() => pickFeed(s, byId, undefined, t, scale('all')), [s, byId, t, scale]);
  // Raster nur bei anderem Filter/Pool/Wurf wieder von vorn – ein Pick nimmt nur eine Karte heraus
  const gridKey = `${poolKey}|${showTaken}|${bestFirst ? `best:${freeKey}` : ''}|${fitOnly ? rollKey || 'fit' : ''}|${effFilters.region}|${effFilters.type ?? ''}|${effFilters.query}`;
  const filtering = !!effFilters.query.trim() || !!effFilters.type || effFilters.region !== 0;
  const randomMode = s.settings.roll === 'pick' || s.settings.roll === 'round';
  const legendLimit = maxLegends != null && poolHasLegends(s.settings) ? maxLegends : null;
  const ultraBeastLimit = maxUltraBeasts != null && ultraBeasts ? maxUltraBeasts : null;
  const megaLimit = maxMegas != null && megas ? maxMegas : null;

  // Pick schillert: kurz ansagen (einmal je Pick) – eigener gefeiert, fremder als Hinweis
  const newestPick = s.picks[s.picks.length - 1];
  const shinySeen = useRef(s.picks.length);
  useEffect(() => {
    if (s.picks.length <= shinySeen.current) return;
    shinySeen.current = s.picks.length;
    if (!newestPick?.shiny) return;
    const mon = byId.get(newestPick.pokemonId);
    if (!mon) return;
    if (newestPick.teamId === me?.id) {
      setInfo(t.shiny.picked(t.game.pokemon(mon), shinyTeamBoost(mon)));
      return;
    }
    const team = s.teams.find((x) => x.id === newestPick.teamId);
    if (team) setInfo(t.shiny.pickedBy(t.game.pokemon(mon), teamLabel(team, t), shinyTeamBoost(mon)));
  }, [s.picks.length]);

  // Vorgemerktes Pokémon ist vergeben → Auswahl aufheben (bei fremdem Pick mit Hinweis)
  useEffect(() => {
    if (selected == null) return;
    const owner = owners.get(selected);
    if (!owner) return;
    if (owner.id !== me?.id) {
      const mon = byId.get(selected);
      setInfo(t.online.favouriteGone(mon ? t.game.pokemon(mon) : t.online.favouriteFallback, teamLabel(owner, t)));
    }
    setSelected(null);
    setSuggestSlot(null);
  }, [owners]);

  // Neuer Wurf am eigenen Zug: ein vorgemerkter Favorit, der nicht passt, fliegt mit Hinweis heraus
  useEffect(() => {
    if (!me || !myTurn || selected == null || pickAllowed(s, me.id, selected, list) !== 'roll') return;
    const mon = byId.get(selected);
    setInfo(t.online.favouriteNoMatch(mon ? t.game.pokemon(mon) : t.online.favouriteFallback));
    setSelected(null);
    setSuggestSlot(null);
  }, [myTurn, rollKey, selected]);

  // Hinweise verschwinden von selbst
  useEffect(() => {
    if (!info) return;
    const id = window.setTimeout(() => setInfo(null), 5000);
    return () => window.clearTimeout(id);
  }, [info]);

  const selectedMon = selected != null ? byId.get(selected) : undefined;
  const lastPick = room.lastPick;
  const lastMon = lastPick ? byId.get(lastPick.pokemonId) : undefined;
  const lastTeam = lastPick ? s.teams.find((tm) => tm.id === lastPick.teamId) : undefined;
  const pitchTeam = me ?? current;
  const mySlots = me ? freeSlots(me, s.settings) : [];

  const choose = (p: Pokemon) => {
    const deselect = selected === p.id;
    setSelected(deselect ? null : p.id);
    setSuggestSlot(null);
    if (!deselect && me && window.matchMedia('(max-width: 899px)').matches) {
      window.setTimeout(() => pitchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };

  const suggest = () => {
    if (!me || !mySlots.length) return;
    try {
      const choice = autoPickChoice(snapshotState(s), me.id, list, scale('all'), false);
      setSelected(choice.pokemonId);
      setSuggestSlot(choice.slot);
    } catch {
      setInfo(t.online.noSuggestion);
    }
  };

  // Taste „V“: Vorschlag (wie der Knopf; nicht beim Tippen)
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'v' && e.key !== 'V') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (typingElsewhere(e.target)) return;
      e.preventDefault();
      suggestRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly]);

  const onSlotClick = (i: number) => {
    if (!me) return;
    if (slotFilled(me, i)) return;
    if (selected == null) {
      setInfo(t.online.chooseFirst);
      return;
    }
    if (!myTurn) {
      setInfo(t.online.notYourTurnYet);
      return;
    }
    // Ein Reroll ist unterwegs – der Wurf ändert sich gleich (der Hook sendet dann ohnehin nichts)
    if (room.busy.reroll) return;
    room.pick(selected, i);
  };

  const slotState = (i: number): SlotState => {
    if (!pitchTeam) return undefined;
    if (slotFilled(pitchTeam, i)) return 'locked';
    if (pitchTeam !== me) return undefined;
    if (selected != null && i === suggestSlot) return 'selected';
    return myTurn && selected != null && !pending && !room.busy.reroll ? 'target' : undefined;
  };

  const suggestPos =
    suggestSlot != null && me && suggestSlot < DRAFT_BENCH_SLOT
      ? suggestSlot === DRAFT_SS_SLOT
        ? 'SS'
        : FORMATIONS[me.formation].slots[suggestSlot]?.pos
      : null;
  const suggestLabel = suggestPos ? t.game.posName[suggestPos] : suggestSlot != null && suggestSlot >= DRAFT_BENCH_SLOT ? t.draft.bench.label : null;

  const hint = !me ? null : myTurn ? (
    selectedMon ? (
      <>
        <strong>{t.game.pokemon(selectedMon)}</strong>
        {t.online.hintChosen}
        {suggestLabel ? t.online.hintSuggestion(suggestLabel) : null}
        {t.online.hintClickSlot}
      </>
    ) : (
      <>
        {t.online.hintChoose}
        {myRoll && t.online.hintRoll(t.game.region[myRoll.gen] ?? '?', t.game.type[myRoll.type])}
      </>
    )
  ) : selectedMon ? (
    <>
      <strong>{t.game.pokemon(selectedMon)}</strong>
      {t.online.hintQueued}
    </>
  ) : (
    <>
      {t.online.hintWaiting(current ? teamLabel(current, t) : t.online.anotherTeam)}
      {me && (() => {
        const n = picksUntilTurn(s, me.id);
        return n != null && n > 0 ? t.online.hintUntil(n) : null;
      })()}
      {me && (() => {
        // Noch offene Feldpositionen der eigenen Elf (gruppiert, Reihenfolge der Formation)
        const open = new Map<string, number>();
        FORMATIONS[me.formation].slots.forEach((d, j) => {
          if (me.slots[j] == null) open.set(t.game.posShort[d.pos], (open.get(t.game.posShort[d.pos]) ?? 0) + 1);
        });
        if (!open.size) return null;
        return t.online.hintOpen([...open].map(([pos, n]) => (n > 1 ? `${n}× ${pos}` : pos)).join(', '));
      })()}
    </>
  );

  // Abwesendes Team am Zug: jedes Mitglied darf nach der Frist für es wählen (Server prüft dasselbe)
  const autoOpensAt = !readOnly && me && current && !current.cpu && current.id !== me.id ? autoPickOpensAt(snapshotState(s)) : null;

  return (
    <div className="draft-live" ref={rootRef}>
      {/* Einzige Live-Region für Picks: eine kurze Ansage pro Pick („Du bist dran!" meldet sich selbst) */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {pickAnnouncement(s, byId, t)}
      </p>
      <div className={`draft-turnbar ${myTurn ? 'is-my-turn' : ''}`} ref={barRef}>
        <div className="statusline">
          <span className="statusline__item">
            {t.online.round}{' '}
            <strong>
              {room.round}/{room.rounds}
            </strong>
          </span>
          <span className="statusline__item">
            {t.online.pick}{' '}
            <strong>
              {room.pickNo}/{room.totalPicks}
            </strong>
          </span>
          <span className="statusline__item draft-turnbar__team">
            {t.online.onTheClock} <strong>{myTurn ? t.online.you : current ? teamLabel(current, t) : '–'}</strong>
            {current?.cpu && t.online.cpuTag}
            {current && !current.cpu && !current.online && t.online.offlineTag}
          </span>
          {me && legendLimit != null && (
            <span className="statusline__item draft-turnbar__legends">
              {t.online.legendsCount}{' '}
              <strong>
                {legendsOf(me, list)}/{legendLimit}
              </strong>
            </span>
          )}
          {me && ultraBeastLimit != null && (
            <span className="statusline__item draft-turnbar__legends">
              {t.online.ultraBeastsCount}{' '}
              <strong>
                {kindOf(me, 'ub', list)}/{ultraBeastLimit}
              </strong>
            </span>
          )}
          {me && megaLimit != null && (
            <span className="statusline__item draft-turnbar__legends">
              {t.online.megasCount}{' '}
              <strong>
                {kindOf(me, 'mega', list)}/{megaLimit}
              </strong>
            </span>
          )}
        </div>
        <DraftCountdown
          deadline={s.deadline}
          pickSeconds={s.settings.pickSeconds}
          clockOffset={room.clockOffset}
          cpu={!!current?.cpu}
          mine={myTurn && !readOnly}
        />
        {randomMode && current && <DraftRollBar room={room} readOnly={readOnly} />}
        {lastPick && lastMon && (
          <p className="draft-turnbar__last">
            {t.online.lastPick} <strong>{t.game.pokemon(lastMon)}</strong> → {lastTeam && teamLabel(lastTeam, t)}
            {lastPick.auto && t.online.autoTag}
          </p>
        )}
        {s.settings.shinies !== false && s.settings.shinyParty && <p className="draft-turnbar__last">{t.shiny.note(Math.round(SHINY_PARTY_CHANCE * 100))}</p>}
      </div>

      {myTurn && (
        <div className="draft-myturn" role="alert">
          {t.online.yourTurn}
        </div>
      )}

      <div className="challenge__play draft-live__play">
        <div className="challenge__controls">
          {info && <RunNotice onClose={() => setInfo(null)}>{info}</RunNotice>}
          {autoOpensAt != null && current && (
            <AutoPickNotice key={`${s.pickIndex}|${current.id}`} room={room} team={current} opensAt={autoOpensAt} />
          )}
          {me && !readOnly && (
            <DraftQueue
              room={room}
              selected={selected}
              onSelect={(id) => {
                // Wie ein Tipp im Raster (auf dem Handy springt die Ansicht zum Feld)
                const p = byId.get(id);
                if (p) choose(p);
              }}
            />
          )}
          {me ? (
            <section aria-labelledby="draft-pool-title">
              <h2 id="draft-pool-title" className="section-title">
                {t.online.pool} <span className="muted">{t.online.poolFree(pool.length - owners.size)}</span>
              </h2>
              <p className={`hint ${myTurn || selectedMon ? 'hint--active' : ''}`}>{hint}</p>
              <div className="draft-pooltools">
                <button type="button" className="btn btn--small" onClick={suggest} disabled={!mySlots.length} title={t.online.suggestKey} aria-keyshortcuts="V">
                  {t.online.suggest}
                </button>
                {restricted && (
                  <label className="draft-check">
                    <input type="checkbox" checked={onlyFit} onChange={(e) => setOnlyFit(e.target.checked)} />{' '}
                    {t.online.onlyFitting}
                  </label>
                )}
                <label className="draft-check">
                  <input type="checkbox" checked={showTaken} onChange={(e) => setShowTaken(e.target.checked)} />{' '}
                  {t.online.showTaken}
                </label>
                <label className="draft-check">
                  <input type="checkbox" checked={bestFirst} onChange={(e) => setBestFirst(e.target.checked)} />{' '}
                  {t.online.bestFirst}
                </label>
              </div>
              <FilterBar
                filters={filters}
                onChange={setFilters}
                // Mehrere Generationen im Pool – außer der eigene Wurf legt sie ohnehin fest
                showRegion={regionShown}
                // Nur die Generationen des Pools (eine andere leerte das Raster)
                regions={gens}
                // Die Trefferzahl ist eine Live-Region – ohne Filter änderte sie sich bei jedem Pick
                // (die freie Zahl steht ohnehin in der Überschrift)
                resultCount={filtering ? filtered.length : undefined}
                slashFocus
              />
              <PokemonGrid
                items={filtered}
                resetKey={gridKey}
                sprite={sprite}
                selectedId={selected}
                onPick={choose}
                disabledReason={(p) => {
                  const owner = owners.get(p.id);
                  if (owner) return t.online.takenBy(teamLabel(owner, t));
                  const block = me ? pickAllowed(s, me.id, p, list) : null;
                  if (block === 'roll') return t.online.blockedRoll;
                  if (block === 'legend_limit') return t.online.blockedLegends(maxLegends ?? 0);
                  if (block === 'ub_limit') return t.online.blockedUltraBeasts(maxUltraBeasts ?? 0);
                  if (block === 'mega_limit') return t.online.blockedMegas(maxMegas ?? 0);
                  return null;
                }}
                note={(p) => {
                  // Auf der eigenen Wunschliste: Platz zeigen; mit „Beste zuerst“ dazu der bestpassende freie Platz
                  const at = (s.queue ?? []).indexOf(p.id);
                  const queued = at >= 0 ? t.online.queueMark(at + 1) : null;
                  const best = bestFirst && !owners.has(p.id) ? bestFreeFit(p) : null;
                  const fit = best ? `${t.game.posShort[best.pos]} ${best.fit}` : null;
                  return [queued, fit].filter(Boolean).join(' · ') || null;
                }}
                className="pgrid-wrap--compact pgrid-wrap--scroll"
              />
            </section>
          ) : readOnly ? (
            <p className="notice draft-readonly">{t.online.readOnlyLive}</p>
          ) : (
            <p className="notice">{t.online.spectating}</p>
          )}
        </div>
        <div className="challenge__pitch" ref={pitchRef}>
          {pitchTeam && (
            <>
              <h2 className="section-title">
                {pitchTeam === me ? t.online.yourTeam : teamLabel(pitchTeam, t)} · {pitchTeam.formation}
              </h2>
              <Pitch
                formation={pitchTeam.formation}
                slots={pitchTeam.slots}
                ss={s.settings.setPiece ? pitchTeam.ss : undefined}
                sprite={sprite}
                slotState={slotState}
                positionTips
                onSlotClick={pitchTeam === me ? onSlotClick : undefined}
                ariaLabel={t.online.pitchAria(teamLabel(pitchTeam, t), pitchTeam.formation)}
                jerseys={pitchTeam.jerseys}
                captain={pitchTeam.captain ?? null}
                shinies={s.shinies}
              />
              {pitchTeam.bench && (
                <BenchRow
                  bench={pitchTeam.bench}
                  sprite={sprite}
                  onClick={pitchTeam === me ? (i) => onSlotClick(DRAFT_BENCH_SLOT + i) : undefined}
                  state={(i) => {
                    const st = slotState(DRAFT_BENCH_SLOT + i);
                    return st === 'target' || st === 'selected' ? st : undefined;
                  }}
                />
              )}
              {pending && <p className="hint draft-pending">{t.online.pickSending}</p>}
              {pitchTeam === me && me && !readOnly && (
                <CaptainPicker
                  formation={me.formation}
                  slots={me.slots}
                  captain={me.captain ?? null}
                  onChange={(c) => room.setCaptain(c)}
                  hint={s.settings.format === 'manager' ? t.captain.managerNote : t.captain.draftNote}
                />
              )}
              {pitchTeam === me && me && !readOnly && (
        <>
          <KitPicker kit={cleanKit(me.kit)} onChange={(kit) => room.setKit(kit)} cheer={me.cheer ?? ''} onCheer={(c) => room.setCheer(c)} />
          <CrestEditor crest={cleanCrest(me.crest)} onChange={(c) => room.setCrest(c)} pokemon={rosterOf(me)} />
        </>
      )}
              {pitchTeam === me && me && !readOnly && (
                <JerseyEditor
                  formation={me.formation}
                  slots={me.slots}
                  ss={s.settings.setPiece ? me.ss : null}
                  bench={me.bench?.filter((x): x is number => x != null)}
                  jerseys={me.jerseys ?? {}}
                  onChange={(j) => room.setJerseys(j)}
                />
              )}
            </>
          )}
        </div>
      </div>

      <DraftBoard state={s} byId={byId} currentId={current?.id ?? null} />
      <DraftPickFeed items={feed} you={s.you} />
    </div>
  );
}
