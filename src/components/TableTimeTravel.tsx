import { useId, useState } from 'react';
import { useT } from '../i18n';
import type { Matchday } from '../lib/leagueTimeline';

interface Props {
  days: Matchday[];
  you: number | null;
  nameOf: (team: number) => string;
}

/** Tabelle nach einem wählbaren Spieltag (Schieberegler) – Platz, Team, Spiele, Diff, Punkte. */
export function TableTimeTravel({ days, you, nameOf }: Props) {
  const t = useT();
  const c = t.draft.col;
  const id = useId();
  const [day, setDay] = useState(days.length);
  const d = days[Math.min(Math.max(day, 1), days.length) - 1];
  if (!d) return null;
  return (
    <div className="time-travel">
      <label className="time-travel__label" htmlFor={id}>
        {t.draft.results.timeTravelDay(d.round, days.length)}
      </label>
      <input
        id={id}
        type="range"
        className="time-travel__range"
        min={1}
        max={days.length}
        value={d.round}
        onChange={(e) => setDay(Number(e.target.value))}
      />
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
              <th scope="col" title={c.playedTitle}>
                {c.played}
              </th>
              <th scope="col" title={c.diffTitle}>
                {c.diff}
              </th>
              <th scope="col" title={c.ptsTitle}>
                {c.pts}
              </th>
            </tr>
          </thead>
          <tbody>
            {d.table.map((r, i) => (
              <tr key={r.team} className={r.team === you ? 'is-user' : ''}>
                <td>{i + 1}</td>
                <td className="left">{nameOf(r.team)}</td>
                <td>{r.played}</td>
                <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                <td>
                  <strong>{r.pts}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
