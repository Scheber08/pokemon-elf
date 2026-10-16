import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isMega } from '../config/categories';
import { DEFAULT_FORMATION, FORMATION_IDS, FORMATIONS } from '../config/formations';
import { REGIONS, regionPhrase } from '../config/regions';
import { Pitch, SS_INDEX } from '../components/Pitch';
import { PickerModal } from '../components/PickerModal';
import { RandomNameButton } from '../components/RandomNameButton';
import { SavedTeams } from '../components/SavedTeams';
import { Segmented } from '../components/Segmented';
import { TeamSheet } from '../components/TeamSheet';
import { useT } from '../i18n';
import { bestEleven } from '../lib/bestEleven';
import { copyText, downloadBlob } from '../lib/exportImage';
import { remapFormation } from '../lib/formation';
import { shuffle } from '../lib/rng';
import { lineupImage, slugify } from '../lib/lineupImage';
import { cleanJerseys, type Jerseys } from '../lib/jerseys';
import { CaptainPicker } from '../components/CaptainPicker';
import { JerseyEditor } from '../components/JerseyEditor';
import { KitPicker } from '../components/KitPicker';
import { cleanKit, type Kit } from '../lib/kits';
import { SPRITE_STYLE_LABEL } from '../lib/sprites';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { CAPTAIN_PARAM, decodeCaptain, decodeJerseys, decodeLineup, JERSEY_PARAM, shareUrl, URL_PARAM } from '../lib/urlState';
import { usePokemonData } from '../state/PokemonData';
import { TypeChips } from '../components/TypeChips';
import { useSettings } from '../state/Settings';
import { useToast } from '../state/Toast';
import type { FormationId, PosCode, Pokemon, RegionFilter, Slots, SpriteStyle } from '../types';
import { cleanCheer } from '../lib/cheer';
import { cleanCrest, type Crest as CrestData } from '../lib/crest';
import { Crest } from '../components/Crest';
import { CrestEditor } from '../components/CrestEditor';

interface BuilderState {
  formation: FormationId;
  slots: Slots;
  ss: number | null;
  region: RegionFilter;
  legends: boolean;
  /** Regional- und Sonderformen im Pool */
  forms: boolean;
  /** Höchstens so viele Megas in der Elf: 0 = keine, MEGAS_UNLIMITED = beliebig viele */
  megas: number;
  ssEnabled: boolean;
  teamName: string;
  /** Eigene Trikotnummern (Pokémon-ID → Nummer) */
  jerseys: Jerseys;
  /** Kapitän (Pokémon-ID aus der Elf) – null = keiner */
  captain: number | null;
  /** Trikotfarben (null = Standard) */
  kit: Kit | null;
  /** Torjubel ('' = keiner) */
  cheer: string;
  /** Vereinswappen (null = keins) */
  crest: CrestData | null;
}

/** So viele Schritte lassen sich rückgängig machen */
const UNDO_MAX = 30;

/** Mega-Limit „unbegrenzt" */
const MEGAS_UNLIMITED = 99;
const MEGA_OPTIONS = [0, 1, 2, 3, MEGAS_UNLIMITED];
const megaMax = (megas: number): number | null => (megas >= MEGAS_UNLIMITED ? null : megas);

/** Standard-Elf (4-3-3, alles Kanto, keine Legendären). */
const DEFAULT_ELF: Slots = [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135];

const DEFAULT_STATE: BuilderState = {
  formation: DEFAULT_FORMATION,
  slots: DEFAULT_ELF,
  ss: 59,
  region: 1,
  legends: false,
  forms: true,
  megas: 1,
  ssEnabled: false,
  teamName: '',
  jerseys: {},
  captain: null,
  kit: null,
  cheer: '',
  crest: null,
};

function normalize(s: Partial<BuilderState>): BuilderState {
  const merged = { ...DEFAULT_STATE, ...s };
  if (!FORMATIONS[merged.formation]) merged.formation = DEFAULT_FORMATION;
  const n = FORMATIONS[merged.formation].slots.length;
  merged.slots = Array.from({ length: n }, (_, i) => merged.slots?.[i] ?? null);
  if (!MEGA_OPTIONS.includes(merged.megas)) merged.megas = DEFAULT_STATE.megas;
  merged.forms = merged.forms !== false;
  merged.jerseys = cleanJerseys(merged.jerseys);
  merged.kit = cleanKit(merged.kit);
  merged.cheer = cleanCheer(merged.cheer);
  merged.crest = cleanCrest(merged.crest);
  merged.captain = typeof merged.captain === 'number' && merged.slots.includes(merged.captain) ? merged.captain : null;
  return merged;
}

/** Megas auf dem Feld (Standardschütze nur, wenn er an ist), ohne den Platz `except`. */
function megasOnField(s: BuilderState, byId: Map<number, Pokemon>, except?: number): number {
  const ids = [...s.slots.map((id, i) => (i === except ? null : id)), s.ssEnabled && except !== SS_INDEX ? s.ss : null];
  return ids.filter((id) => {
    const p = id != null ? byId.get(id) : undefined;
    return !!p && isMega(p);
  }).length;
}

export function Builder() {
  const { all, byId, scale } = usePokemonData();
  const undoRef = useRef<HTMLButtonElement>(null);
  const redoRef = useRef<HTMLButtonElement>(null);
  const { sprite, setSprite } = useSettings();
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState<BuilderState>(() => normalize(load(STORAGE_KEYS.lineup, DEFAULT_STATE)));
  const [picking, setPicking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Geteilten Link übernehmen (?elf=…) und Parameter danach entfernen.
  useEffect(() => {
    const code = params.get(URL_PARAM);
    if (!code) return;
    const shared = decodeLineup(code, (id) => byId.has(id));
    if (shared) {
      const ids = [...shared.slots, shared.ssEnabled ? shared.ss : null];
      const mons = ids.flatMap((id) => (id != null && byId.has(id) ? [byId.get(id)!] : []));
      const megas = mons.filter(isMega).length;
      // Formen und Megas aus dem Link sollen wählbar bleiben
      setState((s) =>
        normalize({
          ...shared,
          jerseys: decodeJerseys(params.get(JERSEY_PARAM) ?? '', shared.slots, shared.ssEnabled ? shared.ss : null),
          captain: decodeCaptain(params.get(CAPTAIN_PARAM), shared.slots),
          forms: s.forms || mons.some((p) => p.form && !isMega(p)),
          megas: megas > (megaMax(s.megas) ?? Infinity) ? (megas <= 3 ? megas : MEGAS_UNLIMITED) : s.megas,
        }),
      );
      setSprite(shared.sprite);
      toast(t.builder.sharedLoaded);
    } else {
      toast(t.builder.linkUnreadable);
    }
    navigate('/', { replace: true });
  }, [params, byId, navigate, setSprite, toast, t]);

  useEffect(() => save(STORAGE_KEYS.lineup, state), [state]);

  const formationDef = FORMATIONS[state.formation];
  const pool = useMemo(
    () =>
      all.filter(
        (p) =>
          (state.legends || (!p.leg && !p.myth)) && (!p.form || (isMega(p) ? state.megas > 0 : state.forms)),
      ),
    [all, state.legends, state.forms, state.megas],
  );
  const regionPool = useMemo(
    () => pool.filter((p) => state.region === 0 || p.gen === state.region),
    [pool, state.region],
  );

  // Rückgängig: Änderungen an der Aufstellung (nicht an Einstellungen oder Teamnamen) merken
  const stateRef = useRef(state);
  stateRef.current = state;
  const [history, setHistory] = useState<BuilderState[]>([]);
  /** Wiederholen: zurückgenommene Stände (neuester zuletzt) – jede neue Änderung leert sie */
  const [future, setFuture] = useState<BuilderState[]>([]);
  const change = (fn: (s: BuilderState) => BuilderState) => {
    const prev = stateRef.current;
    const next = fn(prev);
    if (next === prev) return;
    setHistory((h) => [...h.slice(-(UNDO_MAX - 1)), prev]);
    setFuture([]);
    stateRef.current = next;
    setState(next);
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    const cur = stateRef.current;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [...f.slice(-(UNDO_MAX - 1)), cur]);
    stateRef.current = prev;
    setState(prev);
  };
  const redo = () => {
    const next = future[future.length - 1];
    if (!next) return;
    const cur = stateRef.current;
    setFuture((f) => f.slice(0, -1));
    setHistory((h) => [...h.slice(-(UNDO_MAX - 1)), cur]);
    stateRef.current = next;
    setState(next);
  };
  // Strg/Cmd+Z, Strg/Cmd+Umschalt+Z bzw. Strg+Y – nicht in Eingabefeldern (dort gilt der Browser)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
      if (!isUndo && !isRedo) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, [contenteditable="true"]') || picking != null) return;
      e.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const idAt = (s: BuilderState, i: number) => (i === SS_INDEX ? s.ss : s.slots[i] ?? null);
  const withSlot = (s: BuilderState, i: number, id: number | null): BuilderState =>
    i === SS_INDEX ? { ...s, ss: id } : { ...s, slots: s.slots.map((v, j) => (j === i ? id : v)) };

  const swap = (a: number, b: number) =>
    change((s) => {
      const ida = idAt(s, a);
      const idb = idAt(s, b);
      return withSlot(withSlot(s, a, idb), b, ida);
    });

  const pick = (index: number, id: number | null) => {
    change((s) => {
      if (id == null) return withSlot(s, index, null);
      const indices = [...s.slots.keys(), ...(s.ssEnabled ? [SS_INDEX] : [])];
      const other = indices.find((i) => i !== index && idAt(s, i) === id);
      if (other != null) {
        const current = idAt(s, index);
        return withSlot(withSlot(s, index, id), other, current);
      }
      return withSlot(s, index, id);
    });
    setPicking(null);
  };

  const onField = useMemo(() => {
    const m = new Map<number, PosCode>();
    state.slots.forEach((id, i) => id != null && m.set(id, formationDef.slots[i].pos));
    if (state.ssEnabled && state.ss != null) m.set(state.ss, 'SS');
    return m;
  }, [state.slots, state.ss, state.ssEnabled, formationDef]);

  const randomize = () => {
    const source = regionPool.length >= 12 ? regionPool : pool;
    // Mega-Limit: überzählige Megas fallen aus der Ziehung
    const max = megaMax(state.megas) ?? Infinity;
    let megas = 0;
    const shuffled = shuffle(Math.random, source).filter((p) => !isMega(p) || ++megas <= max);
    change((s) => ({
      ...s,
      slots: s.slots.map((_, i) => shuffled[i]?.id ?? null),
      ss: s.ssEnabled ? shuffled[s.slots.length]?.id ?? null : s.ss,
    }));
  };

  /** Stärkste Elf aus dem aktuellen Pool (Region, Legendäre, Formen, Mega-Limit) */
  const autoBest = () => {
    const source = regionPool.length >= 12 ? regionPool : pool;
    const best = bestEleven(state.formation, source, scale('all'), { megaMax: megaMax(state.megas), setPiece: state.ssEnabled });
    change((s) => ({ ...s, slots: best.slots, ss: s.ssEnabled ? best.ss : s.ss }));
  };

  const saveImage = async () => {
    setBusy(true);
    try {
      const blob = await lineupImage({
        formation: state.formation,
        slots: state.slots,
        ss: state.ssEnabled ? state.ss : undefined,
        sprite,
        byId,
        teamName: state.teamName,
        subtitle: `${state.formation} · ${state.region ? t.game.region[state.region] : t.common.allRegions}`,
        jerseys: state.jerseys,
        captain,
        crest: state.crest,
      });
      downloadBlob(blob, `${slugify(state.teamName || 'pokemon-elf')}.png`);
      toast(t.builder.imageSaved);
    } catch (e) {
      console.error(e);
      toast(t.builder.imageFailed);
    } finally {
      setBusy(false);
    }
  };

  /** Aufstellung als Text (für Chats): Kopfzeile, je Position ein Spieler, Kapitän markiert, Link am Ende */
  const copyLineupText = async () => {
    const line = (pos: string, id: number | null | undefined) => {
      const p = id != null ? byId.get(id) : undefined;
      return p ? `${pos} ${t.game.pokemon(p)}${id === captain ? t.builder.textCaptain : ''}` : null;
    };
    const rows = formationDef.slots.map((d, i) => line(t.game.posShort[d.pos], state.slots[i]));
    if (state.ssEnabled) rows.push(line(t.game.posShort.SS, state.ss));
    const url = shareUrl({ ...state, sprite, ss: state.ssEnabled ? state.ss : null, captain });
    const text = [t.builder.textHeader(state.teamName.trim(), formationDef.label), ...rows.filter((x): x is string => !!x), url].join('\n');
    toast((await copyText(text)) ? t.builder.textCopied : t.common.copyFailed);
  };

  const copyLink = async () => {
    const url = shareUrl({ ...state, sprite, ss: state.ssEnabled ? state.ss : null, captain });
    toast((await copyText(url)) ? t.common.linkCopied : t.common.copyFailed);
  };

  // Kapitän nur, solange er auf dem Feld steht (nach Tauschen/Entfernen sonst keiner)
  const captain = state.captain != null && state.slots.includes(state.captain) ? state.captain : null;

  const description = t.builder.description(regionPhrase(state.region, t), state.legends);
  const pickingPos: PosCode | null =
    picking == null ? null : picking === SS_INDEX ? 'SS' : formationDef.slots[picking]?.pos ?? null;

  return (
    <div className="page builder">
      <div className="builder__main">
        <p className="hint hint--pitch">
          <span className="only-fine">{t.builder.hintFine}</span>
          <span className="only-coarse">{t.builder.hintCoarse}</span>
        </p>
        {/* Ohne Teamnamen trotzdem eine Hauptüberschrift (für Screenreader) */}
        {!(state.teamName || state.crest) && <h1 className="sr-only">{t.builder.pageTitle}</h1>}
        {(state.teamName || state.crest) && (
          <h1 className="team-title">
            {state.crest && (
              <>
                <Crest crest={state.crest} size={26} />{' '}
              </>
            )}
            {state.teamName}
          </h1>
        )}
        <TypeChips pokemon={state.slots.flatMap((id) => (id != null && byId.has(id) ? [byId.get(id)!] : []))} size />
        <Pitch
          formation={state.formation}
          slots={state.slots}
          ss={state.ssEnabled ? state.ss : undefined}
          sprite={sprite}
          onSlotClick={setPicking}
          onSwap={swap}
          ariaLabel={t.builder.pitchAria(state.formation)}
          jerseys={state.jerseys}
          captain={captain}
        />
        <div className="actionbar" role="toolbar" aria-label={t.builder.actions}>
          <button type="button" className="btn btn--primary" onClick={saveImage} disabled={busy}>
            {busy ? t.builder.savingImage : t.builder.saveImage}
          </button>
          <button type="button" className="btn" onClick={copyLink}>
            {t.common.copyLink}
          </button>
          <button type="button" className="btn" onClick={copyLineupText} disabled={!state.slots.some((id) => id != null)}>
            {t.builder.copyText}
          </button>
          <button type="button" className="btn" onClick={randomize}>
            {t.builder.random}
          </button>
          <button type="button" className="btn" onClick={autoBest} title={t.builder.bestTitle}>
            {t.builder.best}
          </button>
          <button
            ref={undoRef}
            type="button"
            className="btn"
            onClick={() => {
              // Letzter Schritt zurück: Der Knopf wird gleich deaktiviert – Fokus zu „Wiederholen“ statt an den Seitenanfang
              const last = history.length === 1;
              undo();
              if (last) window.setTimeout(() => redoRef.current?.focus(), 0);
            }}
            disabled={!history.length}
            title={t.builder.undoTitle}
          >
            {t.builder.undo}
          </button>
          <button
            ref={redoRef}
            type="button"
            className="btn"
            onClick={() => {
              const last = future.length === 1;
              redo();
              if (last) window.setTimeout(() => undoRef.current?.focus(), 0);
            }}
            disabled={!future.length}
            title={t.builder.redoTitle}
          >
            {t.builder.redo}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => change((s) => ({ ...s, formation: DEFAULT_FORMATION, slots: DEFAULT_ELF, ss: DEFAULT_STATE.ss }))}
          >
            {t.builder.reset}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => change((s) => ({ ...s, slots: s.slots.map(() => null), ss: null }))}
          >
            {t.builder.clearAll}
          </button>
        </div>
      </div>

      <aside className="builder__side">
        <TeamSheet
          formation={state.formation}
          slots={state.slots}
          ss={state.ssEnabled ? state.ss : undefined}
          sprite={sprite}
          onRowClick={setPicking}
          fitScale={scale('all')}
        />

        <section className="card">
          <CaptainPicker
            formation={state.formation}
            slots={state.slots}
            captain={captain}
            onChange={(c) => change((s) => ({ ...s, captain: c }))}
          />
        </section>

        <KitPicker
          kit={state.kit}
          onChange={(kit) => change((s) => ({ ...s, kit }))}
          cheer={state.cheer}
          onCheer={(cheer) => change((s) => ({ ...s, cheer }))}
        />

        <CrestEditor
          crest={state.crest}
          onChange={(crest) => change((s) => ({ ...s, crest }))}
          pokemon={[...state.slots, state.ssEnabled ? state.ss : null].filter((x): x is number => x != null)}
        />

        <JerseyEditor
          formation={state.formation}
          slots={state.slots}
          ss={state.ssEnabled ? state.ss : null}
          jerseys={state.jerseys}
          onChange={(jerseys) => change((s) => ({ ...s, jerseys }))}
        />

        <section className="card settings" aria-labelledby="settings-title">
          <h2 id="settings-title" className="section-title">
            {t.common.settings}
          </h2>
          <Segmented
            label={t.builder.region}
            wrap
            value={state.region}
            onChange={(region) => setState((s) => ({ ...s, region }))}
            options={[
              ...REGIONS.map((r) => ({
                value: r.gen as RegionFilter,
                label: t.game.region[r.gen],
                title: t.builder.gen(r.gen),
              })),
              { value: 0 as RegionFilter, label: t.game.allRegions, title: t.builder.allGens },
            ]}
          />
          <Segmented
            label={t.builder.pool}
            value={state.legends}
            onChange={(legends) => setState((s) => ({ ...s, legends }))}
            options={[
              { value: false, label: t.builder.poolPokemon },
              { value: true, label: t.builder.poolLegends },
            ]}
          />
          <p className="settings__desc">{description}</p>
          <Segmented
            label={t.builder.forms}
            value={state.forms}
            onChange={(forms) => setState((s) => ({ ...s, forms }))}
            options={[
              { value: false, label: t.common.off },
              { value: true, label: t.common.on },
            ]}
          />
          <p className="settings__desc">{t.builder.formsNote}</p>
          <Segmented
            label={t.builder.megas}
            value={state.megas}
            onChange={(megas) => setState((s) => ({ ...s, megas }))}
            options={MEGA_OPTIONS.map((n) =>
              n === 0
                ? { value: n, label: t.common.off }
                : n === MEGAS_UNLIMITED
                  ? { value: n, label: '∞', title: t.builder.megasUnlimited }
                  : { value: n, label: String(n) },
            )}
          />
          <p className="settings__desc">{t.builder.megasNote(megaMax(state.megas))}</p>
          <Segmented
            label={t.builder.formation}
            wrap
            value={state.formation}
            onChange={(formation) =>
              change((s) => ({ ...s, formation, slots: remapFormation(s.formation, formation, s.slots) }))
            }
            options={FORMATION_IDS.map((f) => ({ value: f, label: f }))}
          />
          <Segmented
            label={t.game.posName.SS}
            value={state.ssEnabled}
            onChange={(ssEnabled) => setState((s) => ({ ...s, ssEnabled }))}
            options={[
              { value: false, label: t.common.off },
              { value: true, label: t.common.on },
            ]}
          />
          <Segmented
            label={t.builder.sprites}
            value={sprite}
            onChange={setSprite}
            options={(Object.keys(SPRITE_STYLE_LABEL) as SpriteStyle[]).map((s) => ({ value: s, label: SPRITE_STYLE_LABEL[s] }))}
          />
          <div className="field">
            <label className="field__label" htmlFor="team-name">
              {t.builder.teamName} <small>{t.builder.teamNameNote}</small>
            </label>
            <div className="input-row">
              <input
                id="team-name"
                className="input"
                maxLength={32}
                placeholder={t.builder.teamNamePlaceholder}
                value={state.teamName}
                onChange={(e) => setState((s) => ({ ...s, teamName: e.target.value }))}
              />
              <RandomNameButton current={state.teamName} onPick={(teamName) => setState((s) => ({ ...s, teamName: teamName.slice(0, 32) }))} />
            </div>
          </div>
          <SavedTeams current={state} onLoad={(saved) => change(() => normalize(saved))} />
        </section>
      </aside>

      {picking != null && pickingPos && (
        <PickerModal
          pos={pickingPos}
          pool={pool}
          initialRegion={state.region}
          sprite={sprite}
          currentId={idAt(state, picking)}
          onField={onField}
          onPick={(id) => pick(picking, id)}
          onClose={() => setPicking(null)}
          disabledReason={(p) => {
            const max = megaMax(state.megas);
            // Wer schon auf dem Feld steht, tauscht nur den Platz – das ändert die Zahl nicht
            if (max == null || !isMega(p) || onField.has(p.id)) return null;
            return megasOnField(state, byId, picking) >= max ? t.builder.picker.megaLimit(max) : null;
          }}
        />
      )}
    </div>
  );
}
