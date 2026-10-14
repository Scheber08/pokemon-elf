import { useT, type Messages } from '../i18n';
import type { CupInfo, CupStage } from '../lib/cup';
import type { Match } from '../lib/season';

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
