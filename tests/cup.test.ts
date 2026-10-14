/** KO-Turnier des Online-Drafts: Baum, Elfmeterschießen, Endklassement, gespeichertes Ergebnis. */
import { describe, expect, it } from 'vitest';
import { DRAFT_LIMITS } from '../src/lib/api/draftContract';
import {
  CUP_SIZE,
  cupPens,
  cupStageOf,
  cupStatus,
  cupWinner,
  penaltyShootout,
  seedOrder,
  simulateCup,
  storedCup,
} from '../src/lib/cup';
import { addCpuTeam, applyPick, autoPickChoice, createDraft, currentTeam, startDraft, upgradeSettings, withLeague } from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { draftShareText, storedLeague } from '../src/lib/leagueTimeline';
import { createRng } from '../src/lib/rng';
import type { LeagueTeam } from '../src/lib/season';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');
const teams16 = (): LeagueTeam[] => Array.from({ length: 16 }, (_, i) => ({ name: `T${i}`, rating: 400 + i * 30 }));

describe('simulateCup', () => {
  it('16 Teams: Achtel-, Viertel-, Halbfinale, Finale – Sieger kommen weiter, gesetzt nach Team-Score', () => {
    const teams = teams16();
    const r = simulateCup(teams, createRng(1));
    expect(r.cup.groups).toBeNull();
    expect(r.cup.rounds.map((x) => [x.stage, x.round, x.ties.length])).toEqual([
      ['r16', 1, 8],
      ['qf', 2, 4],
      ['sf', 3, 2],
      ['final', 4, 1],
    ]);
    expect(r.matches).toHaveLength(15);
    // Setzliste: das stärkste Team (T15) gegen das schwächste (T0) im ersten Spiel
    const order = seedOrder(teams);
    expect(order[0]).toBe(15);
    expect(r.cup.rounds[0].ties[0]).toMatchObject({ home: 15, away: 0 });
    // Jede Runde: Sieger der Paarungen 2i und 2i+1 treffen aufeinander
    for (let k = 1; k < r.cup.rounds.length; k++) {
      const prev = r.cup.rounds[k - 1].ties.map((x) => x.winner);
      expect(r.cup.rounds[k].ties.flatMap((x) => [x.home, x.away])).toEqual(prev);
    }
    // Ergebnis und Sieger passen zusammen, Remis nur mit Elfmeterschießen
    for (const round of r.cup.rounds) {
      for (const tie of round.ties) {
        const m = r.matches.find((x) => x.round === round.round && x.home === tie.home && x.away === tie.away)!;
        if (m.hg === m.ag) {
          expect(tie.pens).not.toBeNull();
          expect(tie.winner).toBe(tie.pens!.home > tie.pens!.away ? tie.home : tie.away);
        } else {
          expect(tie.pens).toBeNull();
          expect(tie.winner).toBe(m.hg > m.ag ? tie.home : tie.away);
        }
        expect(cupPens(r.cup, m)).toEqual(tie.pens);
      }
    }
    // Endklassement: Sieger, Finalist, Halbfinalisten, …
    const winner = cupWinner(r.cup)!;
    const final = r.cup.rounds[3].ties[0];
    expect(r.table[0].team).toBe(winner);
    expect(r.table[1].team).toBe(final.winner === final.home ? final.away : final.home);
    expect(r.table).toHaveLength(16);
    expect(cupStatus(r.cup, winner)).toBe('winner');
    expect(cupStatus(r.cup, r.table[1].team)).toBe('final');
    expect(cupStatus(r.cup, r.table[15].team)).toBe('r16');
    expect(cupStatus(r.cup, winner, 2)).toBe('alive');
    expect(cupStatus(r.cup, 99)).toBeNull();
    expect(cupStageOf(r.cup, 2)).toBe('qf');
    expect(cupStageOf(r.cup, 9)).toBeNull();
    // deterministisch
    expect(simulateCup(teams16(), createRng(1))).toEqual(r);
  });

  it('nur mit genau 16 Teams', () => {
    expect(() => simulateCup(teams16().slice(1), createRng(1))).toThrow();
  });

  it('Elfmeterschießen: nie unentschieden, plausible Ergebnisse', () => {
    const rng = createRng(5);
    const a = { name: 'A', rating: 600 };
    const b = { name: 'B', rating: 600 };
    for (let i = 0; i < 300; i++) {
      const p = penaltyShootout(rng, a, b);
      expect(p.home).not.toBe(p.away);
      expect(Math.max(p.home, p.away)).toBeGreaterThanOrEqual(1);
      // Innerhalb der fünf Schützen höchstens 5, danach im Sudden Death mit einem Tor Unterschied
      if (Math.max(p.home, p.away) > 5) expect(Math.abs(p.home - p.away)).toBe(1);
    }
  });
});

describe('Online-Draft im KO-Modus', () => {
  function finished(format: 'league' | 'cup') {
    let s = createDraft({
      code: 'CUP234',
      seed: 3,
      settings: { pickSeconds: 0, format },
      host: { teamId: 'h', deviceId: 'dev-h', name: 'Host-Elf', formation: '4-3-3' },
      now: 0,
      list: ALL,
    });
    s = addCpuTeam(s, 'dev-h', 'c1');
    s = startDraft(s, 'dev-h', 0, ALL);
    while (s.phase === 'drafting') {
      const cur = currentTeam(s)!;
      const c = autoPickChoice(s, cur.id, ALL, SCALE, cur.cpu);
      s = applyPick(s, cur.id, c.pokemonId, c.slot, true, 1, ALL);
    }
    return withLeague(s, ALL, SCALE);
  }

  it('Einstellung format: Standard Liga, ältere Ligen ohne das Feld ebenfalls', () => {
    expect(upgradeSettings({}).format).toBe('league');
    expect(upgradeSettings({ format: 'cup' }).format).toBe('cup');
    expect(upgradeSettings({ format: 'quatsch' }).format).toBe('league');
  });

  it('KO-Modus: 16 Teams (aufgefüllt), Baum gespeichert und aus dem Schnappschuss lesbar', () => {
    const s = finished('cup');
    const league = s.league!;
    expect(league.teams).toHaveLength(CUP_SIZE);
    expect(league.cup!.rounds).toHaveLength(4);
    const back = storedLeague(JSON.parse(JSON.stringify(league)), s.teams.length)!;
    expect(back.cup).toEqual(league.cup);
    expect(back.table).toEqual(league.table);
    // Kaputter Baum → nicht übernommen
    expect(storedLeague({ ...JSON.parse(JSON.stringify(league)), cup: { rounds: [{ stage: 'x' }] } }, s.teams.length)).toBeNull();
    expect(storedCup({ groups: null, rounds: [{ stage: 'final', round: 1, ties: [{ home: 0, away: 1, winner: 5, pens: null }] }] }, 16)).toBeNull();
    // Liga bleibt Liga
    expect(finished('league').league!.teams).toHaveLength(DRAFT_LIMITS.leagueSize);
    expect(finished('league').league!.cup).toBeUndefined();
  });

  it('Teilen-Text im KO-Modus: Turniersieger und eigenes Abschneiden', () => {
    const text = draftShareText({
      code: 'CUP234',
      championName: 'Host-Elf',
      championPts: 12,
      tieNote: null,
      own: { name: 'Host-Elf', place: 1 },
      url: 'https://elf.example/draft/CUP234',
      cup: { ownStatus: 'Turniersieger' },
    });
    expect(text).toBe('Pokémon Elf – Online-Draft CUP234: Host-Elf gewinnt das KO-Turnier. Mein Team Host-Elf: Turniersieger.\nhttps://elf.example/draft/CUP234');
  });
});
