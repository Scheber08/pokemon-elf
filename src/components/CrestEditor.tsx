import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { CREST_ICONS, CREST_PATTERNS, CREST_SHAPES, DEFAULT_CREST, randomCrest, type Crest as CrestData } from '../lib/crest';
import { KIT_COLORS } from '../lib/kits';
import { usePokemonData } from '../state/PokemonData';
import { Crest } from './Crest';

interface Props {
  /** null = noch kein eigenes Wappen (Vorschau zeigt den Standard) */
  crest: CrestData | null;
  onChange: (crest: CrestData | null) => void;
  /** Pokémon des Teams – wählbar als Wappentier */
  pokemon?: readonly number[];
  disabled?: boolean;
}

/** Wappen gestalten: Form, Muster, zwei Farben, Symbol bzw. Wappentier aus dem eigenen Team. */
export function CrestEditor({ crest, onChange, pokemon = [], disabled = false }: Props) {
  const t = useT();
  const tx = t.crest;
  const { byId } = usePokemonData();
  const cur = crest ?? DEFAULT_CREST;
  const set = (patch: Partial<CrestData>) => onChange({ ...cur, ...patch });
  const option = (key: string, active: boolean, label: string, onClick: () => void, content: ReactNode) => (
    <button
      key={key}
      type="button"
      className={`crest-editor__option ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  );
  const swatches = (field: 'primary' | 'secondary') =>
    KIT_COLORS.map((c) =>
      option(
        `${field}-${c.id}`,
        cur[field] === c.id,
        `${tx[field]}: ${t.kit.colors[c.id] ?? c.id}`,
        () => set({ [field]: c.id }),
        <span className="crest-editor__swatch" style={{ background: c.fill, boxShadow: `inset 0 0 0 2px ${c.stroke}` }} />,
      ),
    );
  const mons = [...new Set(pokemon)].filter((id) => byId.has(id)).slice(0, 18);
  return (
    <details className="card details crest-editor">
      <summary>
        {tx.title}
        <Crest crest={cur} size={20} className="crest-editor__summary" />
      </summary>
      <div className="crest-editor__body">
        <Crest crest={cur} size={84} label={tx.preview} className="crest-editor__preview" />
        <div className="crest-editor__fields">
          <fieldset className="crest-editor__group">
            <legend className="field__label">{tx.shape}</legend>
            {CREST_SHAPES.map((shape) =>
              option(shape, cur.shape === shape, tx.shapes[shape], () => set({ shape }), <Crest crest={{ ...cur, shape }} size={22} />),
            )}
          </fieldset>
          <fieldset className="crest-editor__group">
            <legend className="field__label">{tx.pattern}</legend>
            {CREST_PATTERNS.map((pattern) =>
              option(pattern, cur.pattern === pattern, tx.patterns[pattern], () => set({ pattern }), <Crest crest={{ ...cur, pattern }} size={22} />),
            )}
          </fieldset>
          <fieldset className="crest-editor__group">
            <legend className="field__label">{tx.primary}</legend>
            {swatches('primary')}
          </fieldset>
          <fieldset className="crest-editor__group">
            <legend className="field__label">{tx.secondary}</legend>
            {swatches('secondary')}
          </fieldset>
          <fieldset className="crest-editor__group">
            <legend className="field__label">{tx.symbol}</legend>
            {CREST_ICONS.map((icon) =>
              option(icon, cur.symbol === icon, tx.icons[icon], () => set({ symbol: icon }), <Crest crest={{ ...cur, symbol: icon }} size={22} />),
            )}
            {mons.map((id) => {
              const symbol = `p:${id}`;
              const mon = byId.get(id)!;
              return option(symbol, cur.symbol === symbol, tx.mascot(t.game.pokemon(mon)), () => set({ symbol }), <Crest crest={{ ...cur, symbol }} size={22} />);
            })}
          </fieldset>
        </div>
      </div>
      <div className="jersey-editor__actions">
        <button type="button" className="btn btn--small" disabled={disabled} onClick={() => onChange(randomCrest(Math.random, mons))}>
          🎲 {tx.random}
        </button>
        {crest && (
          <button type="button" className="btn btn--small btn--ghost" disabled={disabled} onClick={() => onChange(null)}>
            {tx.reset}
          </button>
        )}
      </div>
    </details>
  );
}
