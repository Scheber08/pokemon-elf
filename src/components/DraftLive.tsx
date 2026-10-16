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
  fastPickCounts,
  hasKind,
  isLegend,
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
  rounds as engineRounds,
  teamIndexForPick,
} from '../lib/draftEngine';
import { fitImpact, positionFit } from '../lib/fit';
import { rainbowGain, typeElevenGain } from '../config/pokemonTypes';
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
import { DraftProgress } from './DraftProgress';
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
  /** Beste Freie: je noch offener Feldposition das wählbare Pokémon mit dem besten Fit (wie im lokalen Draft) */
  const bestFree = useMemo(() => {
    if (!me || readOnly) return [];
    const sc = scale('all');
    const candidates = pool.filter((p) => !owners.has(p.id) && (!allowed || allowed.has(p.id)));
    const seen = new Set<string>();
    const out: { pos: PosCode; p: Pokemon; fit: number }[] = [];
    FORMATIONS[me.formation].slots.forEach((d, j) => {
      if (me.slots[j] != null || seen.has(d.pos)) return;
      seen.add(d.pos);
      let best: { p: Pokemon; fit: number } | null = null;
      for (const p of candidates) {
        const fit = positionFit(p, d.pos, sc);
        if (!best || fit > best.fit) best = { p, fit };
      }
      if (best) out.push({ pos: d.pos, ...best });
    });
    return out;
  }, [pool, owners, allowed, freeKey, me?.formation, readOnly]);
  // ⏳ Wohl weg, bevor man wieder dran ist: die k stärksten freien Pokémon (bester Feld-Fit), k = fremde Picks bis zum nächsten eigenen
  const goneSoon = useMemo(() => {
    if (!me || s.phase !== 'drafting') return new Set<number>();
    const n = s.teams.length;
    const mine = s.teams.findIndex((x) => x.id === me.id);
    const total = n * engineRounds(s.settings);
    let next = -1;
    for (let p = s.pickIndex + (myTurn ? 1 : 0); p < total; p++)
      if (teamIndexForPick(p, n, s.settings.snake ?? true) === mine) {
        next = p;
        break;
      }
    // Picks anderer Teams dazwischen (am eigenen Zug zählt der eigene jetzt nicht mit)
    const k = next < 0 ? 0 : next - s.pickIndex - (myTurn ? 1 : 0);
    if (k <= 0) return new Set<number>();
    const sc = scale('all');
    const field = (Object.keys(POSITIONS) as PosCode[]).filter((pos) => pos !== 'SS');
    const ranked = pool
      .filter((p) => !owners.has(p.id))
      .map((p) => ({ id: p.id, fit: Math.max(...field.map((pos) => positionFit(p, pos, sc))) }))
      .sort((a, b) => b.fit - a.fit || a.id - b.id);
    return new Set(ranked.slice(0, k).map((x) => x.id));
  }, [pool, owners, s.pickIndex, s.phase, myTurn, me?.id]);
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
  // Ist als Nächstes eine CPU dran: ihr wahrscheinlicher Pick (ohne Zufall) – am eigenen Zug zum Wegschnappen
  const cpuGuess = useMemo(() => {
    if (s.phase !== 'drafting' || randomMode) return null;
    const total = s.teams.length * engineRounds(s.settings);
    if (s.pickIndex + 1 >= total) return null;
    const next = s.teams[teamIndexForPick(s.pickIndex + 1, s.teams.length, s.settings.snake ?? true)];
    if (!next?.cpu) return null;
    try {
      const mon = byId.get(autoPickChoice(snapshotState(s), next.id, list, scale('all'), false).pokemonId);
      return mon ? { team: next, mon } : null;
    } catch {
      return null;
    }
  }, [takenKey, s.pickIndex, s.phase, randomMode, list, byId, scale]);
  const legendLimit = maxLegends != null && poolHasLegends(s.settings) ? maxLegends : null;
  const ultraBeastLimit = maxUltraBeasts != null && ultraBeasts ? maxUltraBeasts : null;
  const megaLimit = maxMegas != null && megas ? maxMegas : null;

  // Eigener Pick setzt den besten Positions-Fit des Drafts (🏅 im Verlauf): kurz feiern (ein Shiny-Hinweis geht vor)
  const recordSeen = useRef(s.picks.length);
  useEffect(() => {
    if (s.picks.length <= recordSeen.current) return;
    recordSeen.current = s.picks.length;
    const top = feed[0];
    if (top?.top && top.teamId === me?.id && top.pos && top.fit != null) {
      setInfo(t.online.recordPick(top.pokemon, top.fit, t.game.posName[top.pos]));
    }
  }, [s.picks.length]);

  // ✅ Eigene Elf vollständig (alle Feldplätze besetzt): einmal mit Ø Fit feiern – nicht beim Laden
  const myFieldDone = !!me && FORMATIONS[me.formation].slots.every((_, j) => me.slots[j] != null);
  const fieldDoneSeen = useRef(myFieldDone);
  useEffect(() => {
    const was = fieldDoneSeen.current;
    fieldDoneSeen.current = myFieldDone;
    if (was || !myFieldDone || !me) return;
    const sc = scale('all');
    const fits = FORMATIONS[me.formation].slots.flatMap((d, j) => {
      const p = byId.get(me.slots[j]!);
      return p ? [positionFit(p, d.pos, sc)] : [];
    });
    if (fits.length) setInfo(t.online.elevenDone(Math.round(fits.reduce((a, b) => a + b, 0) / fits.length)));
  }, [myFieldDone]);

  // ★ Erstes legendäres Pokémon des Drafts und das letzte freie: kurz ansagen (einmal je Pick, nicht beim Laden)
  const legendSeen = useRef(s.picks.length);
  useEffect(() => {
    const before = legendSeen.current;
    legendSeen.current = s.picks.length;
    if (s.picks.length <= before) return;
    for (const pk of s.picks.slice(before)) {
      const mon = byId.get(pk.pokemonId);
      const team = s.teams.find((x) => x.id === pk.teamId);
      if (!mon || !team || !isLegend(mon)) continue;
      const upTo = s.picks.slice(0, s.picks.indexOf(pk) + 1);
      const taken = new Set(upTo.map((x) => x.pokemonId));
      const left = pool.filter((p) => isLegend(p) && !taken.has(p.id)).length;
      if (left === 0) setInfo(t.online.legendLast(t.game.pokemon(mon), teamLabel(team, t)));
      else if (upTo.filter((x) => { const m = byId.get(x.pokemonId); return !!m && isLegend(m); }).length === 1)
        setInfo(t.online.legendFirst(t.game.pokemon(mon), teamLabel(team, t)));
    }
  }, [s.picks.length]);

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

  // Fremder Pick von der eigenen Wunschliste: kurz bedauern (der Server streicht ihn danach aus der Liste)
  const wishSeen = useRef({ n: s.picks.length, queue: s.queue ?? [] });
  useEffect(() => {
    const before = wishSeen.current;
    wishSeen.current = { n: s.picks.length, queue: s.queue ?? [] };
    if (s.picks.length <= before.n) return;
    const hit = s.picks
      .slice(before.n)
      .filter((p) => p.teamId !== me?.id && p.pokemonId !== selected && before.queue.includes(p.pokemonId))
      .sort((a, b) => before.queue.indexOf(a.pokemonId) - before.queue.indexOf(b.pokemonId))[0];
    const mon = hit && byId.get(hit.pokemonId);
    const team = hit && s.teams.find((x) => x.id === hit.teamId);
    if (mon && team) setInfo(t.online.wishGone(t.game.pokemon(mon), before.queue.indexOf(mon.id) + 1, teamLabel(team, t)));
  }, [s.picks.length, s.queue]);

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
  // 👀 Feld eines anderen Teams ansehen (nur Ansicht; null = eigenes bzw. das am Zug)
  const [peekId, setPeekId] = useState<string | null>(null);
  const peek = peekId ? s.teams.find((x) => x.id === peekId) : undefined;
  const pitchTeam = peek ?? me ?? current;
  // Am eigenen Zug zurück aufs eigene Feld (dort wird gewählt)
  useEffect(() => {
    if (myTurn) setPeekId(null);
  }, [myTurn]);
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

  // 🎲 Zufall: ein zufälliges erlaubtes Pokémon vormerken, auf seinen bestpassenden freien Platz (bestätigen wie beim Vorschlag)
  const randomPick = () => {
    if (!me || !mySlots.length) return;
    const options = allowedPicks(s, me.id, list).filter((p) => !owners.has(p.id));
    if (!options.length) return setInfo(t.online.noSuggestion);
    const mon = options[Math.floor(Math.random() * options.length)];
    const defs = FORMATIONS[me.formation].slots;
    // Feldplätze nach Fit, danach Standardschütze, zuletzt die Bank
    const score = (slot: number) => (slot === DRAFT_SS_SLOT ? -1 : slot >= DRAFT_BENCH_SLOT ? -2 : positionFit(mon, defs[slot].pos, scale('all')));
    const slot = [...mySlots].sort((a, b) => score(b) - score(a))[0];
    setSelected(mon.id);
    setSuggestSlot(slot);
  };

  // Taste „V“: Vorschlag, Taste „R“: 🎲 Zufall (wie die Knöpfe; nicht beim Tippen)
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const randomRef = useRef(randomPick);
  randomRef.current = randomPick;
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((key !== 'v' && key !== 'r') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (typingElsewhere(e.target)) return;
      e.preventDefault();
      if (key === 'r') randomRef.current();
      else suggestRef.current();
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

  // Auswahl: bester freier Feldplatz des Pokémon und was er aus dem Ø Fit der eigenen Elf macht
  const impact = (() => {
    const x = me && selectedMon ? fitImpact(selectedMon, FORMATIONS[me.formation].slots, me.slots, byId, scale('all')) : null;
    if (!x || !me || !selectedMon) return null;
    const mons = me.slots.flatMap((id) => (id != null && byId.get(id) ? [byId.get(id)!] : []));
    const gain = typeElevenGain(mons, selectedMon);
    const rainbow = rainbowGain(mons, selectedMon);
    return (
      <span className="draft-hint__impact">
        {t.online.hintImpact(t.game.posShort[x.pos], x.fit, x.before, x.after)}
        {gain && <strong className="draft-hint__typeelf">{t.online.hintTypeEleven(t.game.type[gain.type], gain.n)}</strong>}
        {rainbow != null && <strong className="draft-hint__typeelf">{t.online.hintRainbow(rainbow)}</strong>}
      </span>
    );
  })();

  const hint = !me ? null : myTurn ? (
    selectedMon ? (
      <>
        <strong>{t.game.pokemon(selectedMon)}</strong>
        {t.online.hintChosen}
        {suggestLabel ? t.online.hintSuggestion(suggestLabel) : null}
        {t.online.hintClickSlot}
        {impact}
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
      {impact}
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
          <span className={`statusline__item ${room.round === room.rounds ? 'draft-turnbar__final' : ''}`}>
            {t.online.round}{' '}
            <strong>
              {room.round}/{room.rounds}
            </strong>
            {room.round === room.rounds && (
              // Letzte Draft-Runde
              <span title={t.online.finalRound}>
                {' '}
                <span aria-hidden="true">🏁</span>
                <span className="sr-only">{t.online.finalRound}</span>
              </span>
            )}
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
          {me && (() => {
            // Eigene Blitz-Picks ⚡ – Fortschritt zum Erfolg „Blitzdrafter“ (5)
            const n = fastPickCounts(s.picks).get(me.id) ?? 0;
            if (!n) return null;
            return (
              <span className="statusline__item draft-turnbar__blitz" title={t.online.blitzTitle(n)}>
                <span aria-hidden="true">⚡ </span>
                <strong>{n >= 5 ? n : `${n}/5`}</strong>
                <span className="sr-only"> – {t.online.blitzTitle(n)}</span>
              </span>
            );
          })()}
        </div>
        {(() => {
          // Fortschritt des Drafts mit den eigenen Picks als Striche
          const total = s.teams.length * engineRounds(s.settings);
          const mine = me ? s.teams.findIndex((x) => x.id === me.id) : -1;
          const marks: number[] = [];
          if (mine >= 0) for (let p = 0; p < total; p++) if (teamIndexForPick(p, s.teams.length, s.settings.snake ?? true) === mine) marks.push(p);
          return <DraftProgress done={Math.min(s.pickIndex, total)} total={total} marks={marks} />;
        })()}
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
        {(() => {
          // Die nächsten Picks nach dem aktuellen (Snake-Reihenfolge), höchstens drei
          const total = s.teams.length * engineRounds(s.settings);
          const next: string[] = [];
          for (let p = s.pickIndex + 1; p < total && next.length < 3; p++) {
            const tm = s.teams[teamIndexForPick(p, s.teams.length, s.settings.snake ?? true)];
            if (tm) next.push(tm.id === me?.id ? t.online.you : teamLabel(tm, t));
          }
          if (!next.length) return null;
          // Restdauer höchstens: offene Picks menschlicher Teams × Pick-Zeit (CPU wählt sofort)
          let humanLeft = 0;
          for (let p = s.pickIndex + 1; p < total; p++) if (!s.teams[teamIndexForPick(p, s.teams.length, s.settings.snake ?? true)]?.cpu) humanLeft++;
          const restMin = s.settings.pickSeconds > 0 && humanLeft > 0 ? Math.ceil((humanLeft * s.settings.pickSeconds) / 60) : 0;
          // Wer als Nächstes wählt (nicht man selbst): welche Feldpositionen ihm noch fehlen – zum Wegschnappen
          const nextTeam = s.pickIndex + 1 < total ? s.teams[teamIndexForPick(s.pickIndex + 1, s.teams.length, s.settings.snake ?? true)] : undefined;
          const needs = new Map<string, number>();
          if (nextTeam && nextTeam.id !== me?.id) {
            FORMATIONS[nextTeam.formation].slots.forEach((d, j) => {
              if (nextTeam.slots[j] == null) needs.set(t.game.posShort[d.pos], (needs.get(t.game.posShort[d.pos]) ?? 0) + 1);
            });
          }
          return (
            <>
              <p className="draft-turnbar__last draft-turnbar__next">
                {t.online.nextUp(next.join(' → '))}
                {restMin > 0 && <span className="draft-turnbar__rest"> · {t.online.restMax(restMin)}</span>}
              </p>
              {nextTeam && needs.size > 0 && (
                <p className="draft-turnbar__last draft-turnbar__needs">
                  {t.online.nextNeeds(teamLabel(nextTeam, t), [...needs].map(([pos, n]) => (n > 1 ? `${n}× ${pos}` : pos)).join(', '))}
                </p>
              )}
              {cpuGuess && myTurn && (
                <p className="draft-turnbar__last draft-turnbar__cpuguess" title={t.online.cpuGuessTitle}>
                  {t.online.cpuGuess(teamLabel(cpuGuess.team, t), t.game.pokemon(cpuGuess.mon))}
                </p>
              )}
            </>
          );
        })()}
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
              suggestions={[...new Set(bestFree.map((b) => b.p.id))]}
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
                {(() => {
                  // Noch freie Legendäre/Mysteriöse im Pool (nur wenn der Pool welche hat)
                  const legends = pool.filter((p) => isLegend(p)).length;
                  if (!legends) return null;
                  const free = pool.filter((p) => isLegend(p) && !owners.has(p.id)).length;
                  return (
                    <span className="muted draft-pool__legends" title={t.online.legendsFreeTitle(free)}>
                      {' '}
                      <span aria-hidden="true">★ {free}</span>
                      <span className="sr-only">{t.online.legendsFreeTitle(free)}</span>
                    </span>
                  );
                })()}
                {(['ub', 'mega'] as const).map((kind) => {
                  // Ebenso freie Ultrabestien bzw. Megas (nur wenn der Pool welche hat)
                  if (!pool.some((p) => hasKind(p, kind))) return null;
                  const free = pool.filter((p) => hasKind(p, kind) && !owners.has(p.id)).length;
                  const label = kind === 'ub' ? t.online.ubFreeTitle(free) : t.online.megasFreeTitle(free);
                  return (
                    <span key={kind} className={`muted draft-pool__${kind}`} title={label}>
                      {' '}
                      <span aria-hidden="true">
                        {kind === 'ub' ? 'UB' : 'M'} {free}
                      </span>
                      <span className="sr-only">{label}</span>
                    </span>
                  );
                })}
              </h2>
              <p className={`hint ${myTurn || selectedMon ? 'hint--active' : ''}`}>{hint}</p>
              {myTurn &&
                me &&
                s.pickIndex + 1 < s.teams.length * engineRounds(s.settings) &&
                s.teams[teamIndexForPick(s.pickIndex + 1, s.teams.length, s.settings.snake ?? true)]?.id === me.id && (
                  // Snake-Wende: gleich noch einmal dran
                  <p className="small draft-double">🐍 {t.online.doublePick}</p>
                )}
              <div className="draft-pooltools">
                <button type="button" className="btn btn--small" onClick={suggest} disabled={!mySlots.length} title={t.online.suggestKey} aria-keyshortcuts="V">
                  {t.online.suggest}
                </button>
                <button type="button" className="btn btn--small" onClick={randomPick} disabled={!mySlots.length} title={t.online.randomPickTitle} aria-keyshortcuts="R">
                  🎲 {t.online.randomPick}
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
              {bestFree.length > 0 && (
                <p className="draft__bestfree small">
                  <span className="muted">{t.draft.local.bestFree}</span>{' '}
                  {bestFree.map((b) => (
                    <button
                      key={b.pos}
                      type="button"
                      className={`chip ${selected === b.p.id ? 'is-active' : ''}`}
                      title={t.draft.local.bestFreeTitle(t.game.pokemon(b.p), t.game.posShort[b.pos], Math.round(b.fit))}
                      onClick={() => choose(b.p)}
                    >
                      <strong>{t.game.posShort[b.pos]}</strong> {t.game.pokemon(b.p)} {Math.round(b.fit)}
                    </button>
                  ))}
                </p>
              )}
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
                  const soon = goneSoon.has(p.id) ? `⏳ ${t.online.goneSoon}` : null;
                  return [soon, queued, fit].filter(Boolean).join(' · ') || null;
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
              {s.teams.length > 1 && (
                <label className="draft-peek small">
                  <span aria-hidden="true">👀 </span>
                  <span className="muted">{t.online.peekLabel}</span>{' '}
                  <select className="input select" value={peek ? peek.id : ''} onChange={(e) => setPeekId(e.target.value || null)}>
                    <option value="">{me ? t.online.yourTeam : t.online.peekCurrent}</option>
                    {s.teams
                      .filter((x) => x.id !== me?.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {teamLabel(x, t)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <Pitch
                formation={pitchTeam.formation}
                slots={pitchTeam.slots}
                ss={s.settings.setPiece ? pitchTeam.ss : undefined}
                sprite={sprite}
                slotState={slotState}
                positionTips
                onSlotClick={pitchTeam === me ? onSlotClick : undefined}
                emptyBadge={
                  pitchTeam === me && me
                    ? (i) => {
                        // Bester noch freier Fit für diese Position: grün viel Auswahl, gelb mittel, rot knapp
                        const pos = FORMATIONS[me.formation].slots[i]?.pos;
                        const b = pos ? bestFree.find((x) => x.pos === pos) : undefined;
                        if (!b) return null;
                        const fit = Math.round(b.fit);
                        return { text: String(fit), tone: fit >= 90 ? 'good' : fit >= 80 ? 'ok' : 'bad', title: t.online.slotBest(fit) };
                      }
                    : undefined
                }
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

      <DraftBoard
        state={s}
        byId={byId}
        currentId={current?.id ?? null}
        nextId={
          s.phase === 'drafting' && s.pickIndex + 1 < s.teams.length * engineRounds(s.settings)
            ? s.teams[teamIndexForPick(s.pickIndex + 1, s.teams.length, s.settings.snake ?? true)]?.id ?? null
            : null
        }
      />
      <DraftPickFeed items={feed} you={s.you} />
    </div>
  );
}
