import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dexId, isMega, isUltraBeast } from '../config/categories';
import { LEVEL_SYMBOL, POSITIONS, PROFILES, type Level } from '../config/positions';
import { fmtNumber, localeOf, messages, useLang, useT } from '../i18n';
import type { FactorKey, PosCode, Pokemon, StatKey } from '../types';
import '../styles/tips.css';
import { PosBadge, TypeBadge, TypeBadges } from './Badges';
import { LevelIcon } from './LevelIcon';

const STATS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** Zahl im Format der aktiven Sprache (de: 1,5 · en: 1.5). */
export const fmtNum = (n: number, digits = 1) => fmtNumber(n, digits);

/** Nationaldex-Nummer in der aktiven Sprache („Nr. 0025" bzw. „#0025"). */
export function dexNo(id: number) {
  return messages().game.dexNo(id);
}

/** Gewichtung eines Faktors auf einer Position (Schlüssel 3 … Zählt nicht 0). */
const levelAt = (pos: PosCode, f: FactorKey): Level => PROFILES[POSITIONS[pos].profile].weights[f];

/** Basiswerte als Balken; mit `pos` markiert ein Symbol, wie wichtig jeder Wert dort ist. */
export function StatBars({ pokemon, pos }: { pokemon: Pokemon; pos?: PosCode }) {
  const t = useT();
  return (
    <dl className={`statbars ${pos ? 'statbars--pos' : ''}`}>
      {STATS.map((k) => (
        <div className={`statbars__row ${pos && levelAt(pos, k) === 0 ? 'statbars__row--muted' : ''}`} key={k}>
          <dt>
            {pos && (
              <span className={`lvl lvl--${levelAt(pos, k)}`}>
                <LevelIcon level={levelAt(pos, k)} size={12} />
              </span>
            )}
            {t.game.factorLong[k]}
          </dt>
          <dd>
            <span className="statbars__val">{pokemon[k]}</span>
            <span className="statbars__track">
              <span
                className={`statbars__fill statbars__fill--${pokemon[k] >= 100 ? 'hi' : pokemon[k] >= 70 ? 'mid' : 'lo'}`}
                style={{ width: `${Math.min(100, (pokemon[k] / 200) * 100)}%` }}
              />
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Schwebendes Feld neben dem Anker (rechts, sonst links, auf schmalen Bildschirmen darüber/darunter). */
function FloatingTip({ anchor, className, children }: { anchor: DOMRect; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    let left: number;
    let top: number;
    if (anchor.right + margin + width <= vw - margin) {
      left = anchor.right + margin; // rechts daneben
      top = anchor.top + anchor.height / 2 - height / 2;
    } else if (anchor.left - margin - width >= margin) {
      left = anchor.left - margin - width; // links daneben
      top = anchor.top + anchor.height / 2 - height / 2;
    } else {
      // schmaler Bildschirm: darüber bzw. darunter, horizontal zentriert
      left = anchor.left + anchor.width / 2 - width / 2;
      top = anchor.top - height - margin;
      if (top < margin) top = anchor.bottom + margin;
    }
    setPos({
      left: clamp(left, margin, vw - width - margin),
      top: clamp(top, margin, vh - height - margin),
    });
  }, [anchor, children]);

  return createPortal(
    <div
      ref={ref}
      className={className}
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Typ-Bonus der Position; Typen, die das Pokémon hat, werden hervorgehoben. */
function TypeBonusLine({ pos, pokemon }: { pos: PosCode; pokemon?: Pokemon }) {
  const t = useT();
  const types = PROFILES[POSITIONS[pos].profile].types;
  if (!types.length) return <p className="pos-tip__types muted small">{t.builder.statTip.noTypeBonus}</p>;
  return (
    <p className="pos-tip__types">
      <span className="pos-tip__label">{t.builder.statTip.typeBonus}</span>
      <span className="type-badges">
        {types.map((type) => (
          <span key={type} className={pokemon && !pokemon.types.includes(type) ? 'pos-tip__type--off' : ''}>
            <TypeBadge type={type} small />
          </span>
        ))}
      </span>
    </p>
  );
}

/**
 * Werte-Tooltip (Hover am Desktop, Long-Press am Handy) – bewusst ohne Fit-Bewertung.
 * Mit `pos` zeigt er zusätzlich, welche Werte auf dieser Position zählen.
 */
export function StatTooltip({ pokemon, anchor, pos }: { pokemon: Pokemon; anchor: DOMRect; pos?: PosCode }) {
  const t = useT();
  const lang = useLang();
  // Auf Deutsch zusätzlich der englische Name (sofern er sich unterscheidet)
  const altName = lang === 'de' && pokemon.de !== pokemon.en ? pokemon.en : null;
  const legend = ([3, 2, 1, 0] as Level[]).map((l) => `${LEVEL_SYMBOL[l]} ${t.game.level[l]}`).join(' · ');
  return (
    <FloatingTip anchor={anchor} className="stat-tip">
      <div className="stat-tip__head">
        <span className="stat-tip__no">{t.game.dexNo(dexId(pokemon))}</span>
        <strong className="stat-tip__name">{t.game.pokemon(pokemon)}</strong>
        {altName && <span className="stat-tip__en">{altName}</span>}
      </div>
      <div className="stat-tip__types">
        <TypeBadges types={pokemon.types} small />
        {(pokemon.leg || pokemon.myth) ? (
          <span className="legend-chip">{pokemon.myth ? t.game.mythical : t.game.legendary}</span>
        ) : null}
        {isMega(pokemon) ? (
          <span className="legend-chip legend-chip--mega">{t.game.mega}</span>
        ) : isUltraBeast(pokemon) ? (
          <span className="legend-chip legend-chip--ub">{t.game.ultraBeast}</span>
        ) : null}
      </div>
      {pos && (
        <p className="pos-tip__as" title={legend}>
          <PosBadge pos={pos} /> {t.builder.statTip.importantAs(t.game.posName[pos])}
        </p>
      )}
      <StatBars pokemon={pokemon} pos={pos} />
      <div className="stat-tip__meta">
        <span>
          {pos && (
            <span className={`lvl lvl--${levelAt(pos, 'height')}`}>
              <LevelIcon level={levelAt(pos, 'height')} size={11} />
            </span>
          )}
          {t.builder.statTip.height(fmtNumber(pokemon.h, 1, lang))}
        </span>
        <span>
          {pos && (
            <span className={`lvl lvl--${levelAt(pos, 'weight')}`}>
              <LevelIcon level={levelAt(pos, 'weight')} size={11} />
            </span>
          )}
          {t.builder.statTip.weight(fmtNumber(pokemon.w, 1, lang))}
        </span>
        <span>{t.game.region[pokemon.gen] ?? '?'}</span>
      </div>
      {pos && <TypeBonusLine pos={pos} pokemon={pokemon} />}
    </FloatingTip>
  );
}

const LEVEL_GROUPS: Level[] = [3, 2, 1];

/** Kurzfassung in einer Zeile: welche Werte auf der Position zählen (wichtigste zuerst). */
export function PositionKeys({ pos }: { pos: PosCode }) {
  const t = useT();
  const profile = PROFILES[POSITIONS[pos].profile];
  const factors = (Object.keys(profile.weights) as FactorKey[])
    .filter((f) => profile.weights[f] > 0)
    .sort((a, b) => profile.weights[b] - profile.weights[a]);
  return (
    <p className="pos-keys">
      <span className="pos-keys__label">{t.builder.statTip.countsHere}</span>
      {factors.map((f) => (
        <span key={f} className={`pos-keys__factor lvl--${profile.weights[f]}`} title={`${t.game.factorLong[f]}: ${t.game.level[profile.weights[f]]}`}>
          <LevelIcon level={profile.weights[f]} size={11} />
          {t.game.factor[f]}
        </span>
      ))}
    </p>
  );
}

/** Was auf einer Position zählt – für leere Slots (z. B. beim Draften). */
export function PositionTooltip({ pos, anchor }: { pos: PosCode; anchor: DOMRect }) {
  const t = useT();
  const lang = useLang();
  const def = POSITIONS[pos];
  const notes = t.game.profileNotes[def.profile];
  const profile = PROFILES[def.profile];
  const factorsAt = (level: Level) => (Object.keys(profile.weights) as FactorKey[]).filter((f) => profile.weights[f] === level);
  return (
    <FloatingTip anchor={anchor} className="stat-tip pos-tip">
      <div className="pos-tip__head">
        <PosBadge pos={pos} />
        <strong className="stat-tip__name">{t.game.posName[pos]}</strong>
      </div>
      <p className="pos-tip__role">{t.game.profileRole[def.profile]}</p>
      <dl className="pos-tip__groups">
        {LEVEL_GROUPS.map((level) => {
          const factors = factorsAt(level);
          if (!factors.length) return null;
          return (
            <div key={level} className="pos-tip__group">
              <dt className={`lvl lvl--${level}`}>
                <LevelIcon level={level} size={13} /> {t.game.level[level]}
              </dt>
              <dd>
                {factors.map((f) => (
                  <span key={f} className="pos-tip__factor" title={t.game.factorLong[f]}>
                    {t.game.factor[f]}
                    {notes?.[f] && <small> ({notes[f]})</small>}
                  </span>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
      <TypeBonusLine pos={pos} />
      {pos !== 'SS' && (
        <p className="pos-tip__weight muted small">
          {t.builder.statTip.teamWeight(def.teamWeight.toLocaleString(localeOf(lang)))}
        </p>
      )}
    </FloatingTip>
  );
}
