/** KO-Turnier des Online-Drafts: Baum, Elfmeterschießen, Endklassement, gespeichertes Ergebnis. */
import { describe, expect, it } from 'vitest';
import { DRAFT_LIMITS } from '../src/lib/api/draftContract';
import {
  CUP_SIZE,
  cupPath,
  cupPens,
  cupStageOf,
  cupStatus,
  cupWinner,
  groupTable,
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

describe('cupPath', () => {
  it('Sieger: vier KO-Spiele, jedes gewonnen (Tore oder Elfmeter), eigene Tore zuerst', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulateCup(teams16(), createRng(seed));
      const winner = cupWinner(r.cup)!;
      const path = cupPath(r.cup, r.matches, winner);
      expect(path.map((s) => s.stage)).toEqual(['r16', 'qf', 'sf', 'final']);
      for (const s of path) expect(s.gf > s.ga || (s.gf === s.ga && s.pens!.own > s.pens!.opp)).toBe(true);
      // Gegner im Finale = Verlierer der Final-Paarung
      const fin = r.cup.rounds[3].ties[0];
      expect(path[3].opponent).toBe(fin.home === winner ? fin.away : fin.home);
    }
    // Team, das im Achtelfinale ausscheidet: nur ein Spiel
    const r = simulateCup(teams16(), createRng(3));
    const tie = r.cup.rounds[0].ties[0];
    const loser = tie.winner === tie.home ? tie.away : tie.home;
    expect(cupPath(r.cup, r.matches, loser)).toHaveLength(1);
  });
});

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

describe('Gruppenphase', () => {
  it('4 Gruppen à 4 aus Lostöpfen, 6 Spieltage, die ersten zwei über Kreuz ins Viertelfinale', () => {
    const teams = teams16();
    const r = simulateCup(teams, createRng(9), { groups: true });
    const groups = r.cup.groups!;
    expect(groups).toHaveLength(4);
    expect(groups.flat().sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    // Topf k: die Plätze 4k..4k+3 der Setzliste – je Gruppe genau einer aus jedem Topf
    const order = seedOrder(teams);
    for (let k = 0; k < 4; k++) {
      expect(groups.map((g) => g[k]).sort((a, b) => a - b)).toEqual(order.slice(4 * k, 4 * k + 4).sort((a, b) => a - b));
    }
    const groupMatches = r.matches.filter((m) => m.round <= 6);
    expect(groupMatches).toHaveLength(48);
    for (const g of groups) {
      const table = groupTable(teams, r.matches, g);
      expect(table.every((row) => row.played === 6)).toBe(true);
    }
    expect(r.cup.rounds.map((x) => [x.stage, x.round])).toEqual([
      ['qf', 7],
      ['sf', 8],
      ['final', 9],
    ]);
    const [a, b, c, d] = groups.map((g) => groupTable(teams, r.matches, g).map((row) => row.team));
    expect(r.cup.rounds[0].ties.map((x) => [x.home, x.away])).toEqual([
      [a[0], b[1]],
      [c[0], d[1]],
      [b[0], a[1]],
      [d[0], c[1]],
    ]);
    // Endklassement: Gruppendritte vor -vierten, ganz hinten
    const thirds = [a[2], b[2], c[2], d[2]];
    const fourths = [a[3], b[3], c[3], d[3]];
    expect(r.table.slice(8, 12).map((x) => x.team).sort()).toEqual(thirds.sort());
    expect(r.table.slice(12).map((x) => x.team).sort()).toEqual(fourths.sort());
    expect(cupStageOf(r.cup, 3)).toBe('group');
    // Status: vor Ende der Gruppenphase noch dabei, danach ausgeschieden
    expect(cupStatus(r.cup, a[3], 5)).toBe('alive');
    expect(cupStatus(r.cup, a[3], 6)).toBe('group');
    expect(cupStatus(r.cup, a[0], 6)).toBe('alive');
    expect(simulateCup(teams16(), createRng(9), { groups: true })).toEqual(r);
  });
});

describe('Online-Draft im KO-Modus', () => {
  function finished(format: 'league' | 'cup', cupGroups = false) {
    let s = createDraft({
      code: 'CUP234',
      seed: 3,
      settings: { pickSeconds: 0, format, cupGroups },
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
    expect(upgradeSettings({}).cupGroups).toBe(true);
    expect(upgradeSettings({ cupGroups: false }).cupGroups).toBe(false);
  });

  it('mit Gruppenphase: Gruppen und 9 Spieltage gespeichert', () => {
    const s = finished('cup', true);
    const back = storedLeague(JSON.parse(JSON.stringify(s.league)), s.teams.length)!;
    expect(back.cup!.groups).toHaveLength(4);
    expect(Math.max(...back.matches.map((m) => m.round))).toBe(9);
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
