import { useT, type Messages } from '../i18n';
import { groupTable, type CupInfo, type CupStage } from '../lib/cup';
import type { LeagueTeam, Match } from '../lib/season';

/** Status eines Teams im Turnier als Text („Noch dabei", „Aus im Viertelfinale", …). */
export function cupStatusText(t: Messages, status: CupStage | 'group' | 'winner' | 'alive' | null): string {
  const c = t.draft.cup;
  if (status === 'winner') return c.winner;
  if (status === 'alive' || status == null) return c.alive;
  if (status === 'group') return c.outGroup;
  if (status === 'final') return c.outFinal;
  return c.out(c.stage[status]);
}

interface Props {
  cup: CupInfo;
  matches: Match[];
  /** Nur Runden bis einschließlich dieses Spieltags zeigen (Ticker) */
  upTo?: number;
  you: number | null;
  nameOf: (team: number) => string;
}

/** KO-Runden als Liste: je Runde die Paarungen mit Ergebnis (Sieger fett, ggf. Elfmeterschießen). */
export function CupBracket({ cup, matches, upTo = Infinity, you, nameOf }: Props) {
  const t = useT();
  const c = t.draft.cup;
  const rounds = cup.rounds.filter((r) => r.round <= upTo);
  if (!rounds.length) return null;
  return (
    <ol className="cup-bracket">
      {rounds.map((r) => (
        <li key={r.round} className="cup-bracket__round">
          <h4 className="cup-bracket__stage">{c.stage[r.stage]}</h4>
          <ul className="cup-bracket__ties">
            {r.ties.map((tie) => {
              const m = matches.find((x) => x.round === r.round && x.home === tie.home && x.away === tie.away);
              const own = you != null && (tie.home === you || tie.away === you);
              return (
                <li key={`${tie.home}-${tie.away}`} className={`cup-bracket__tie ${own ? 'is-own' : ''}`}>
                  <span className={`cup-bracket__team ${tie.winner === tie.home ? 'is-winner' : ''}`}>{nameOf(tie.home)}</span>
                  <span className="cup-bracket__score">
                    {m ? `${m.hg}:${m.ag}` : '–:–'}
                    {tie.pens && (
                      <small className="cup-bracket__pens" title={c.pensTitle}>
                        {c.pens(tie.pens.home, tie.pens.away)}
                      </small>
                    )}
                  </span>
                  <span className={`cup-bracket__team cup-bracket__team--away ${tie.winner === tie.away ? 'is-winner' : ''}`}>
                    {nameOf(tie.away)}
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

interface GroupsProps {
  teams: LeagueTeam[];
  matches: Match[];
  groups: number[][];
  /** Tabellen nach diesem Spieltag (Ticker); ohne: Endstand */
  upTo?: number;
  you: number | null;
  nameOf: (team: number) => string;
}

/** Gruppentabellen (A–D): Platz, Team, Spiele, Tordifferenz, Punkte – die ersten zwei markiert. */
export function CupGroups({ teams, matches, groups, upTo = Infinity, you, nameOf }: GroupsProps) {
  const t = useT();
  const c = t.draft.col;
  return (
    <div className="cup-groups">
      {groups.map((members, g) => {
        const table = groupTable(teams, matches, members, upTo);
        const letter = String.fromCharCode(65 + g);
        return (
          <section key={letter} className="cup-group" aria-label={t.draft.cup.group(letter)}>
            <h4 className="cup-bracket__stage">{t.draft.cup.group(letter)}</h4>
            <table className="league-table cup-group__table">
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
                {table.map((r, i) => (
                  <tr key={r.team} className={`${r.team === you ? 'is-user' : ''} ${i < 2 ? 'cup-group__through' : ''}`}>
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
          </section>
        );
      })}
    </div>
  );
}
