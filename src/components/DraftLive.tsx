import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import type { DraftSnapshot, DraftTeam } from '../lib/api/draftContract';
import { autoPickChoice, autoPickOpensAt, DRAFT_SS_SLOT, freeSlots, poolOf, type DraftState } from '../lib/draftEngine';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { draftedKey, ownerOfPicks, pickAnnouncement, pickFeed, teamLabel, type DraftRoom } from '../state/useDraftRoom';
import type { Pokemon } from '../types';
import { DraftBoard, DraftPickFeed } from './DraftBoard';
import { DraftCountdown } from './DraftCountdown';
import { FilterBar, useFilteredPokemon, type PokemonFilters } from './FilterBar';
import { Pitch, type SlotState } from './Pitch';
import { PokemonGrid } from './PokemonGrid';
import { RunNotice } from './RunBoard';
import '../styles/draft.css';

/** Engine-Zustand aus einem Schnappschuss – nur für die Vorschlags-Berechnung (ohne Zufall). */
function asState(s: DraftSnapshot): DraftState {
  return { ...s, seed: 0, owners: {} };
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
  const { list, byId, scale } = usePokemonData();
  const { sprite } = useSettings();
  const t = useT();
  const s = room.state!;
  const { me, current, myTurn, pending } = room;
  const [selected, setSelected] = useState<number | null>(null);
  const [suggestSlot, setSuggestSlot] = useState<number | null>(null);
  const [showTaken, setShowTaken] = useState(false);
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
  // Pool bzw. vergebene Pokémon ändern (sonst springt das Raster bei jedem Online-Wechsel zurück).
  const { region, legends } = s.settings;
  const pool = useMemo(() => poolOf({ region, legends }, list), [region, legends, list]);
  const takenKey = draftedKey(s);
  const owners = useMemo(() => ownerOfPicks(s), [takenKey]);
  const items = useMemo(() => (showTaken ? pool : pool.filter((p) => !owners.has(p.id))), [pool, owners, showTaken]);
  const filtered = useFilteredPokemon(items, filters);
  const feed = useMemo(() => pickFeed(s, byId, undefined, t), [s, byId, t]);
  // Raster nur bei anderem Filter/Pool wieder von vorn – ein Pick nimmt nur eine Karte heraus
  const gridKey = `${region}|${legends}|${showTaken}|${filters.region}|${filters.type ?? ''}|${filters.query}`;
  const filtering = !!filters.query.trim() || !!filters.type || filters.region !== 0;

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
      const choice = autoPickChoice(asState(s), me.id, list, scale('all'), false);
      setSelected(choice.pokemonId);
      setSuggestSlot(choice.slot);
    } catch {
      setInfo(t.online.noSuggestion);
    }
  };

  const onSlotClick = (i: number) => {
    if (!me) return;
    const filled = i === DRAFT_SS_SLOT ? me.ss != null : me.slots[i] != null;
    if (filled) return;
    if (selected == null) {
      setInfo(t.online.chooseFirst);
      return;
    }
    if (!myTurn) {
      setInfo(t.online.notYourTurnYet);
      return;
    }
    room.pick(selected, i);
  };

  const slotState = (i: number): SlotState => {
    if (!pitchTeam) return undefined;
    const filled = i === DRAFT_SS_SLOT ? pitchTeam.ss != null : pitchTeam.slots[i] != null;
    if (filled) return 'locked';
    if (pitchTeam !== me) return undefined;
    if (selected != null && i === suggestSlot) return 'selected';
    return myTurn && selected != null && !pending ? 'target' : undefined;
  };

  const suggestPos =
    suggestSlot != null && me ? (suggestSlot === DRAFT_SS_SLOT ? 'SS' : FORMATIONS[me.formation].slots[suggestSlot]?.pos) : null;

  const hint = !me ? null : myTurn ? (
    selectedMon ? (
      <>
        <strong>{t.game.pokemon(selectedMon)}</strong>
        {t.online.hintChosen}
        {suggestPos ? t.online.hintSuggestion(t.game.posName[suggestPos]) : null}
        {t.online.hintClickSlot}
      </>
    ) : (
      t.online.hintChoose
    )
  ) : selectedMon ? (
    <>
      <strong>{t.game.pokemon(selectedMon)}</strong>
      {t.online.hintQueued}
    </>
  ) : (
    t.online.hintWaiting(current ? teamLabel(current, t) : t.online.anotherTeam)
  );

  // Abwesendes Team am Zug: jedes Mitglied darf nach der Frist für es wählen (Server prüft dasselbe)
  const autoOpensAt = !readOnly && me && current && !current.cpu && current.id !== me.id ? autoPickOpensAt(asState(s)) : null;

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
        </div>
        <DraftCountdown
          deadline={s.deadline}
          pickSeconds={s.settings.pickSeconds}
          clockOffset={room.clockOffset}
          cpu={!!current?.cpu}
        />
        {lastPick && lastMon && (
          <p className="draft-turnbar__last">
            {t.online.lastPick} <strong>{t.game.pokemon(lastMon)}</strong> → {lastTeam && teamLabel(lastTeam, t)}
            {lastPick.auto && t.online.autoTag}
          </p>
        )}
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
          {me ? (
            <section aria-labelledby="draft-pool-title">
              <h2 id="draft-pool-title" className="section-title">
                {t.online.pool} <span className="muted">{t.online.poolFree(pool.length - owners.size)}</span>
              </h2>
              <p className={`hint ${myTurn || selectedMon ? 'hint--active' : ''}`}>{hint}</p>
              <div className="draft-pooltools">
                <button type="button" className="btn btn--small" onClick={suggest} disabled={!mySlots.length}>
                  {t.online.suggest}
                </button>
                <label className="draft-check">
                  <input type="checkbox" checked={showTaken} onChange={(e) => setShowTaken(e.target.checked)} />{' '}
                  {t.online.showTaken}
                </label>
              </div>
              <FilterBar
                filters={filters}
                onChange={setFilters}
                showRegion={s.settings.region === 0}
                // Die Trefferzahl ist eine Live-Region – ohne Filter änderte sie sich bei jedem Pick
                // (die freie Zahl steht ohnehin in der Überschrift)
                resultCount={filtering ? filtered.length : undefined}
              />
              <PokemonGrid
                items={filtered}
                resetKey={gridKey}
                sprite={sprite}
                selectedId={selected}
                onPick={choose}
                disabledReason={(p) => {
                  const owner = owners.get(p.id);
                  return owner ? t.online.takenBy(teamLabel(owner, t)) : null;
                }}
                className="pgrid-wrap--compact"
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
              />
              {pending && <p className="hint draft-pending">{t.online.pickSending}</p>}
            </>
          )}
        </div>
      </div>

      <DraftBoard state={s} byId={byId} currentId={current?.id ?? null} />
      <DraftPickFeed items={feed} you={s.you} />
    </div>
  );
}
