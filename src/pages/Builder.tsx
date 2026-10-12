import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEFAULT_FORMATION, FORMATION_IDS, FORMATIONS } from '../config/formations';
import { REGIONS, regionPhrase } from '../config/regions';
import { Pitch, SS_INDEX } from '../components/Pitch';
import { PickerModal } from '../components/PickerModal';
import { Segmented } from '../components/Segmented';
import { TeamSheet } from '../components/TeamSheet';
import { copyText, downloadBlob } from '../lib/exportImage';
import { remapFormation } from '../lib/formation';
import { shuffle } from '../lib/rng';
import { lineupImage, slugify } from '../lib/lineupImage';
import { SPRITE_STYLE_LABEL } from '../lib/sprites';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { decodeLineup, shareUrl, URL_PARAM } from '../lib/urlState';
import { usePokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { useToast } from '../state/Toast';
import type { FormationId, PosCode, RegionFilter, Slots, SpriteStyle } from '../types';

interface BuilderState {
  formation: FormationId;
  slots: Slots;
  ss: number | null;
  region: RegionFilter;
  legends: boolean;
  ssEnabled: boolean;
  teamName: string;
}

/** Standard-Elf (4-3-3, alles Kanto, keine Legendären). */
const DEFAULT_ELF: Slots = [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135];

const DEFAULT_STATE: BuilderState = {
  formation: DEFAULT_FORMATION,
  slots: DEFAULT_ELF,
  ss: 59,
  region: 1,
  legends: false,
  ssEnabled: false,
  teamName: '',
};

function normalize(s: Partial<BuilderState>): BuilderState {
  const merged = { ...DEFAULT_STATE, ...s };
  if (!FORMATIONS[merged.formation]) merged.formation = DEFAULT_FORMATION;
  const n = FORMATIONS[merged.formation].slots.length;
  merged.slots = Array.from({ length: n }, (_, i) => merged.slots?.[i] ?? null);
  return merged;
}

export function Builder() {
  const { list, byId } = usePokemonData();
  const { sprite, setSprite } = useSettings();
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
    const shared = decodeLineup(code, list.length);
    if (shared) {
      setState(normalize({ ...shared }));
      setSprite(shared.sprite);
      toast('Geteilte Aufstellung geladen');
    } else {
      toast('Der Link konnte nicht gelesen werden');
    }
    navigate('/', { replace: true });
  }, [params, list.length, navigate, setSprite, toast]);

  useEffect(() => save(STORAGE_KEYS.lineup, state), [state]);

  const formationDef = FORMATIONS[state.formation];
  const pool = useMemo(() => list.filter((p) => state.legends || (!p.leg && !p.myth)), [list, state.legends]);
  const regionPool = useMemo(
    () => pool.filter((p) => state.region === 0 || p.gen === state.region),
    [pool, state.region],
  );

  const idAt = (s: BuilderState, i: number) => (i === SS_INDEX ? s.ss : s.slots[i] ?? null);
  const withSlot = (s: BuilderState, i: number, id: number | null): BuilderState =>
    i === SS_INDEX ? { ...s, ss: id } : { ...s, slots: s.slots.map((v, j) => (j === i ? id : v)) };

  const swap = (a: number, b: number) =>
    setState((s) => {
      const ida = idAt(s, a);
      const idb = idAt(s, b);
      return withSlot(withSlot(s, a, idb), b, ida);
    });

  const pick = (index: number, id: number | null) => {
    setState((s) => {
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
    const shuffled = shuffle(Math.random, source);
    setState((s) => ({
      ...s,
      slots: s.slots.map((_, i) => shuffled[i]?.id ?? null),
      ss: s.ssEnabled ? shuffled[s.slots.length]?.id ?? null : s.ss,
    }));
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
        subtitle: `${state.formation} · ${state.region ? REGIONS[state.region - 1].name : 'Alle Regionen'}`,
      });
      downloadBlob(blob, `${slugify(state.teamName || 'pokemon-elf')}.png`);
      toast('Bild gespeichert');
    } catch (e) {
      console.error(e);
      toast('Bild konnte nicht erstellt werden');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const url = shareUrl({ ...state, sprite, ss: state.ssEnabled ? state.ss : null });
    toast((await copyText(url)) ? 'Link kopiert!' : 'Kopieren nicht möglich');
  };

  const description = `Aufstellung ${regionPhrase(state.region)}, ${state.legends ? 'mit Legendären und Mysteriösen' : 'ohne Legendäre'}.`;
  const pickingPos: PosCode | null =
    picking == null ? null : picking === SS_INDEX ? 'SS' : formationDef.slots[picking]?.pos ?? null;

  return (
    <div className="page builder">
      <div className="builder__main">
        <p className="hint hint--pitch">
          <span className="only-fine">
            Klicke auf einen Spieler, um ihn auszutauschen, oder fahre darüber für seine Werte. Zieh einen Spieler auf
            einen anderen, um die Plätze zu tauschen.
          </span>
          <span className="only-coarse">
            Tippe auf einen Spieler, um ihn auszutauschen, oder halte gedrückt für seine Werte.
          </span>
        </p>
        {state.teamName && <h1 className="team-title">{state.teamName}</h1>}
        <Pitch
          formation={state.formation}
          slots={state.slots}
          ss={state.ssEnabled ? state.ss : undefined}
          sprite={sprite}
          onSlotClick={setPicking}
          onSwap={swap}
          ariaLabel={`Spielfeld, Formation ${state.formation}`}
        />
        <div className="actionbar" role="toolbar" aria-label="Aktionen">
          <button type="button" className="btn btn--primary" onClick={saveImage} disabled={busy}>
            {busy ? 'Erstelle Bild …' : 'Bild speichern'}
          </button>
          <button type="button" className="btn" onClick={copyLink}>
            Link kopieren
          </button>
          <button type="button" className="btn" onClick={randomize}>
            Zufällig
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setState((s) => ({ ...s, formation: DEFAULT_FORMATION, slots: DEFAULT_ELF, ss: DEFAULT_STATE.ss }))}
          >
            Zurücksetzen
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setState((s) => ({ ...s, slots: s.slots.map(() => null), ss: null }))}
          >
            Alles leeren
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
        />

        <section className="card settings" aria-labelledby="settings-title">
          <h2 id="settings-title" className="section-title">
            Einstellungen
          </h2>
          <Segmented
            label="Region"
            wrap
            value={state.region}
            onChange={(region) => setState((s) => ({ ...s, region }))}
            options={[
              ...REGIONS.map((r) => ({ value: r.gen as RegionFilter, label: r.name, title: `Gen ${r.gen}` })),
              { value: 0 as RegionFilter, label: 'Alle', title: 'Gen 1–9' },
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
          <p className="settings__desc">{description}</p>
          <Segmented
            label="Formation"
            wrap
            value={state.formation}
            onChange={(formation) =>
              setState((s) => ({ ...s, formation, slots: remapFormation(s.formation, formation, s.slots) }))
            }
            options={FORMATION_IDS.map((f) => ({ value: f, label: f }))}
          />
          <Segmented
            label="Standardschütze"
            value={state.ssEnabled}
            onChange={(ssEnabled) => setState((s) => ({ ...s, ssEnabled }))}
            options={[
              { value: false, label: 'Aus' },
              { value: true, label: 'An' },
            ]}
          />
          <Segmented
            label="Sprites"
            value={sprite}
            onChange={setSprite}
            options={(Object.keys(SPRITE_STYLE_LABEL) as SpriteStyle[]).map((s) => ({ value: s, label: SPRITE_STYLE_LABEL[s] }))}
          />
          <div className="field">
            <label className="field__label" htmlFor="team-name">
              Teamname <small>(optional, erscheint im Bild)</small>
            </label>
            <input
              id="team-name"
              className="input"
              maxLength={32}
              placeholder="z. B. Rot-Weiß Alabastia"
              value={state.teamName}
              onChange={(e) => setState((s) => ({ ...s, teamName: e.target.value }))}
            />
          </div>
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
        />
      )}
    </div>
  );
}
