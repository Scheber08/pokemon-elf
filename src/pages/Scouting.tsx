import { useRef, useState } from 'react';
import { TypeBadge } from '../components/Badges';
import { LevelIcon } from '../components/LevelIcon';
import { downloadBlob, nodeToPng } from '../lib/exportImage';
import { FACTORS, POSITIONS, PROFILES, PROFILE_GROUPS, type Level } from '../config/positions';
import { SCORING } from '../config/scoring';
import { SEASON } from '../config/season';
import { localeOf, useLang, useT } from '../i18n';
import { useToast } from '../state/Toast';

const LEVELS: Level[] = [3, 2, 1, 0];

export function Scouting() {
  const t = useT();
  const lang = useLang();
  const s = t.scouting;
  const fmt = (n: number) => n.toLocaleString(localeOf(lang));
  const tableRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

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
        <div className="scouting__legend" aria-label={s.legendAria}>
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
