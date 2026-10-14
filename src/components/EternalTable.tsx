import { useMemo } from 'react';
import { localeOf, useLang, useT } from '../i18n';
import type { DraftHistoryEntry } from '../lib/api/draftContract';
import { eternalTable } from '../lib/draftEngine';

interface Props {
  /** Ligen der Gruppe (Verlauf, ggf. samt der aktuellen fertigen Liga) */
  entries: DraftHistoryEntry[];
  /** Eigenes Team (hervorgehoben) */
  youTeamId: string | null;
  /** Titel: „Ewige Tabelle" bzw. in der Lobby „Bisher in dieser Gruppe" */
  title?: string;
}

/** Ewige Tabelle einer Gruppe: alle Ligen der Revanche-Kette zusammengezählt. */
export function EternalTable({ entries, youTeamId, title }: Props) {
  const t = useT();
  const lang = useLang();
  const tx = t.draft.eternal;
  const c = t.draft.col;
  const rows = useMemo(() => eternalTable(entries), [entries]);
  if (!rows.length) return null;
  return (
    <section className="card eternal" aria-labelledby="eternal-title">
      <h2 id="eternal-title" className="section-title">
        {title ?? tx.title} <small className="muted">{tx.leagues(entries.length)}</small>
      </h2>
      <p className="muted small">{tx.note}</p>
      <div className="table-scroll">
        <table className="league-table">
          <thead>
            <tr>
              <th scope="col" title={c.placeTitle}>
                {c.place}
              </th>
              <th scope="col" className="left">
                {c.team}
              </th>
              <th scope="col" title={tx.leaguesTitle}>
                {tx.leaguesCol}
              </th>
              <th scope="col" title={tx.titlesTitle}>
                {tx.titlesCol}
              </th>
              <th scope="col" title={tx.avgTitle}>
                {tx.avgCol}
              </th>
              <th scope="col" title={c.playedTitle}>
                {c.played}
              </th>
              <th scope="col" title={c.wonTitle}>
                {c.won}
              </th>
              <th scope="col" title={c.drawnTitle}>
                {c.drawn}
              </th>
              <th scope="col" title={c.lostTitle}>
                {c.lost}
              </th>
              <th scope="col">{c.goals}</th>
              <th scope="col" title={c.ptsTitle}>
                {c.pts}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.teamId} className={r.teamId === youTeamId ? 'is-user' : ''}>
                <td>{i + 1}</td>
                <td className="left">
                  {/* Vereinsnamen der CPU-Teams erst bei der Anzeige übersetzen */}
                  {r.cpu ? t.game.club(r.name) : r.name}
                  {r.cpu && <span className="rating">{t.draft.cpu}</span>}
                </td>
                <td>{r.leagues}</td>
                <td>{r.titles || ''}</td>
                <td>{(r.rankSum / r.leagues).toLocaleString(localeOf(lang), { maximumFractionDigits: 1 })}</td>
                <td>{r.played}</td>
                <td>{r.w}</td>
                <td>{r.d}</td>
                <td>{r.l}</td>
                <td>
                  {r.gf}:{r.ga}
                </td>
                <td>
                  <strong>{r.pts}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
