import { scrollBehavior } from '../lib/motion';
import { useMemo, useRef, useState } from 'react';
import { TypeBadge } from '../components/Badges';
import { LevelIcon } from '../components/LevelIcon';
import { Sprite } from '../components/Sprite';
import { compositeScore, profileFit } from '../lib/fit';
import { downloadBlob, nodeToPng } from '../lib/exportImage';
import { FACTORS, POSITIONS, PROFILES, PROFILE_GROUPS, type Level } from '../config/positions';
import { SCORING } from '../config/scoring';
import { SEASON } from '../config/season';
import { localeOf, useLang, useT } from '../i18n';
import { useOptionalPokemonData } from '../state/PokemonData';
import { useSettings } from '../state/Settings';
import { useToast } from '../state/Toast';
import type { ProfileKey } from '../types';

const LEVELS: Level[] = [3, 2, 1, 0];

/** Die drei bestpassenden Pokémon (aus den 1.025, Skala „alle“) je Profil – zeigt, wonach das Scouting sucht */
function TopCandidates({ onPick }: { onPick: (name: string) => void }) {
  const t = useT();
  const s = t.scouting;
  const data = useOptionalPokemonData();
  const { sprite } = useSettings();
  const [legends, setLegends] = useState(false);
  const top = useMemo(() => {
    if (!data) return null;
    const scale = data.scale('all');
    const pool = legends ? data.list : data.list.filter((p) => !p.leg && !p.myth);
    const out = {} as Record<ProfileKey, { p: (typeof data.list)[number]; fit: number }[]>;
    for (const g of PROFILE_GROUPS)
      for (const key of g.profiles)
        // Fit ist bei 100 gedeckelt – Gleichstand entscheidet der ungedeckelte Profilwert
        out[key] = pool
          .map((p) => ({ p, fit: profileFit(p, key, scale), raw: compositeScore(p, key, scale) }))
          .sort((a, b) => b.fit - a.fit || b.raw - a.raw || a.p.id - b.p.id)
          .slice(0, 3);
    return out;
  }, [data, legends]);
  if (!top) return null;
  return (
    <section className="card scouting__top" aria-labelledby="scouting-top">
      <h2 id="scouting-top" className="section-title">
        🏅 {s.topTitle}
      </h2>
      <p className="muted small">{s.topNote}</p>
      <label className="scouting__top-legends">
        <input type="checkbox" checked={legends} onChange={(e) => setLegends(e.target.checked)} /> ★ {s.topLegends}
      </label>
      <ul className="scouting__top-list">
        {PROFILE_GROUPS.flatMap((g) => g.profiles).map((key) => (
          <li key={key}>
            <span className="scouting__top-pos">
              <span className="scout-table__codes">{t.game.profileCodes[key]}</span> {t.game.profileTitle[key]}
            </span>
            <ol className="scouting__top-mons">
              {top[key].map(({ p, fit }) => (
                <li key={p.id}>
                  <Sprite pokemon={p} style={sprite} className="scouting__top-sprite" />
                  <button type="button" className="scouting__top-name scouting__top-pick" onClick={() => onPick(t.game.pokemon(p))} title={s.whereShow(t.game.pokemon(p))}>
                    {t.game.pokemon(p)}
                  </button>
                  <span className="scouting__top-fit">{Math.round(fit)}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 🔍 Wo spielt …? – ein Pokémon suchen, seine fünf besten Positionen mit Fit (Skala „alle“) */
function WherePlays({ query, setQuery }: { query: string; setQuery: (q: string) => void }) {
  const t = useT();
  const s = t.scouting;
  const data = useOptionalPokemonData();
  const { sprite } = useSettings();
  const hit = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data || q.length < 2) return null;
    // Genauer Name zuerst, sonst der erste Treffer nach Pokédex-Nummer
    return data.list.find((p) => p.de.toLowerCase() === q || p.en.toLowerCase() === q) ?? data.list.find((p) => p.de.toLowerCase().includes(q) || p.en.toLowerCase().includes(q)) ?? null;
  }, [data, query]);
  if (!data) return null;
  const scale = data.scale('all');
  const best = hit
    ? PROFILE_GROUPS.flatMap((g) => g.profiles)
        .map((key) => ({ key, fit: profileFit(hit, key, scale) }))
        .sort((a, b) => b.fit - a.fit)
        .slice(0, 5)
    : [];
  // Rang auf der besten Position unter allen Pokémon (1 = niemand passt besser)
  const rank = hit && best.length ? data.list.filter((p) => profileFit(p, best[0].key, scale) > best[0].fit).length + 1 : null;
  return (
    <section className="card scouting__where" aria-labelledby="scouting-where">
      <h2 id="scouting-where" className="section-title">
        🔍 {s.whereTitle}
      </h2>
      <input id="scouting-where-input" className="input scouting__where-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.wherePlaceholder} aria-label={s.whereTitle} />
      {query.trim().length >= 2 && !hit && <p className="muted small">{s.whereNone}</p>}
      {hit && (
        <div className="scouting__where-hit" aria-live="polite">
          <p className="scouting__where-name">
            <Sprite pokemon={hit} style={sprite} className="scouting__top-sprite" decorative /> <strong>{t.game.pokemon(hit)}</strong>
          </p>
          {rank != null && <p className="muted small scouting__where-rank">{s.whereRank(rank, data.list.length, t.game.profileTitle[best[0].key])}</p>}
          <ol className="scouting__top-mons">
            {best.map(({ key, fit }) => (
              <li key={key}>
                <span className="scout-table__codes">{t.game.profileCodes[key]}</span>
                <span className="scouting__top-name">{t.game.profileTitle[key]}</span>
                <span className="scouting__top-fit">{Math.round(fit)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

export function Scouting() {
  const t = useT();
  const lang = useLang();
  const s = t.scouting;
  const fmt = (n: number) => n.toLocaleString(localeOf(lang));
  const tableRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /** Suche „Wo spielt …?" – auch per Tipp auf ein Pokémon in „Top 3 je Position" gefüllt */
  const [where, setWhere] = useState('');

  const saveTable = async () => {
    if (!tableRef.current) return;
    setBusy(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      downloadBlob(await nodeToPng(tableRef.current, { scale: 2, background: bg }), 'pokemon-elf-scouting.png');
    } catch {
      toast(s.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page scouting">
      <header className="page-head">
        <h1 className="page-title">{s.title}</h1>
        <p className="page-lead">{s.lead}</p>
      </header>

      <div className="scouting__table card" ref={tableRef}>
        <div className="scouting__legend" role="group" aria-label={s.legendAria}>
          {LEVELS.map((l) => (
            <span key={l} className={`lvl lvl--${l}`}>
              <LevelIcon level={l} size={16} /> {t.game.level[l]}
            </span>
          ))}
        </div>
        {PROFILE_GROUPS.map((g) => (
          <section key={g.key} className="scouting__group">
            <h2 className="section-title">{s.groups[g.key]}</h2>
            <div className="table-scroll">
              <table className="scout-table">
                <thead>
                  <tr>
                    <th scope="col" className="left">
                      {s.colPosition}
                    </th>
                    {FACTORS.map((f) => (
                      <th scope="col" key={f}>
                        {t.game.factor[f]}
                      </th>
                    ))}
                    <th scope="col" className="left">
                      {s.colTypeBonus}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.profiles.map((key) => {
                    const pr = PROFILES[key];
                    const notes = t.game.profileNotes[key];
                    return (
                      <tr key={key}>
                        <th scope="row" className="left">
                          <span className="scout-table__codes">{t.game.profileCodes[key]}</span>
                          <span className="scout-table__title">{t.game.profileTitle[key]}</span>
                          <span className="scout-table__role">{t.game.profileRole[key]}</span>
                        </th>
                        {FACTORS.map((f) => {
                          const l = pr.weights[f];
                          const note = notes?.[f];
                          return (
                            <td key={f} className={`lvl lvl--${l}`} title={`${t.game.factor[f]}: ${t.game.level[l]}`}>
                              <LevelIcon level={l} />
                              {note && <small className="lvl__note">{note}</small>}
                            </td>
                          );
                        })}
                        <td className="left">
                          <span className="type-badges">
                            {pr.types.length ? pr.types.map((ty) => <TypeBadge key={ty} type={ty} small />) : '–'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="scouting__mark">{s.mark}</p>
      </div>
      <div className="actionbar">
        <button type="button" className="btn btn--primary" onClick={saveTable} disabled={busy}>
          {busy ? s.saving : s.saveTable}
        </button>
      </div>

      <TopCandidates
        onPick={(name) => {
          setWhere(name);
          // Zur Suche springen, damit man das Ergebnis sieht
          document.getElementById('scouting-where-input')?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'center' });
        }}
      />
      <WherePlays query={where} setQuery={setWhere} />

      <div className="prose-grid">
        <section className="card prose">
          <h2 className="section-title">{s.howTitle}</h2>
          <p>
            {s.howWeights({
              gk: fmt(POSITIONS.TW.teamWeight),
              cb: fmt(POSITIONS.IV.teamWeight),
              fb: fmt(POSITIONS.LV.teamWeight),
              dm: fmt(POSITIONS.DM.teamWeight),
              cm: fmt(POSITIONS.ZM.teamWeight),
              am: fmt(POSITIONS.OM.teamWeight),
              wide: fmt(POSITIONS.LF.teamWeight),
              st: fmt(POSITIONS.ST.teamWeight),
            })}
          </p>
          <p>{s.howWeakest(SCORING.team.weakestCount)}</p>
          <p>{s.howSeason(SEASON.opponents, SEASON.minRating, SEASON.maxRating)}</p>
        </section>
        <section className="card prose">
          <h2 className="section-title">{s.sizeTitle}</h2>
          <p>{s.sizeHeight(fmt(SCORING.height.cap))}</p>
          <p>{s.sizeWeight(fmt(SCORING.weight.capKg))}</p>
        </section>
        <section className="card prose">
          <h2 className="section-title">{s.specialTitle}</h2>
          <p>
            <strong>{t.game.factorLong.spa}</strong>
            {s.specialSpa}
          </p>
          <p>
            <strong>{t.game.factorLong.spd}</strong>
            {s.specialSpd}
          </p>
        </section>
        <section className="card prose">
          <h2 className="section-title">{s.typesTitle}</h2>
          <p>{s.typesText(t.game.type)}</p>
        </section>
      </div>

      <section className="card faq" aria-labelledby="faq-title">
        <h2 id="faq-title" className="section-title">
          {s.faqTitle}
        </h2>
        {s.faq.map((f) => (
          <details key={f.q} className="faq__item">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
