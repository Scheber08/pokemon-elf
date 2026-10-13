/**
 * Raum-Hook des Online-Drafts (src/state/useDraftRoom.ts), reine Teile: Sperren laufender
 * Aktionen (nur die passende Bestätigung löst sie), wann die öffentliche Vorschau gezeigt wird,
 * Ansage pro Pick, Wiederholung der Existenzprüfung und der Schlüssel der vergebenen Pokémon.
 * Dazu die Live-Regionen von Verlauf und Timer (statisch gerendert).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DraftPickFeed } from '../src/components/DraftBoard';
import { DraftCountdown } from '../src/components/DraftCountdown';
import type { DraftSettingsPatch, DraftSnapshot } from '../src/lib/api/draftContract';
import {
  addCpuTeam,
  applyPick,
  applyReroll,
  autoPickChoice,
  createDraft,
  currentTeam,
  joinDraft,
  setOnline,
  snapshotOf,
  startDraft,
  type DraftState,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import {
  actionSettled,
  checkRetryDelay,
  CHECK_RETRY_MAX_MS,
  DRAFT_ACTION_TIMEOUT_MS,
  draftedKey,
  draftRoomReady,
  draftRoomView,
  expireInFlight,
  inFlightOf,
  pickAnnouncement,
  pickFeed,
  releaseInFlight,
  settleInFlight,
  type InFlightMap,
} from '../src/state/useDraftRoom';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');
const byId = new Map(ALL.map((p) => [p.id, p]));

function lobby(teams = 2, settings: DraftSettingsPatch = { region: 1, maxTeams: 4 }): DraftState {
  let s = createDraft({
    code: 'ABC234',
    seed: 42,
    settings,
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Host FC', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  for (let i = 1; i < teams; i++) {
    s = joinDraft(s, { teamId: `t${i}`, deviceId: `dev-${i}`, name: `Team ${i}`, formation: '4-4-2' });
  }
  return s;
}

function autoPick(s: DraftState, now = 1000): DraftState {
  const team = currentTeam(s)!;
  const c = autoPickChoice(s, team.id, ALL, SCALE, false);
  return applyPick(s, team.id, c.pokemonId, c.slot, true, now, ALL);
}

const snap = (s: DraftState, you: string | null = 'h'): DraftSnapshot => snapshotOf(s, you, 0);

// ---------------------------------------------------------------- CLIENT-5 / CLIENT-3

describe('laufende Aktionen', () => {
  it('Pick: ein fremder Schnappschuss (Online-Wechsel) löst die Sperre nicht – erst der nächste Pick', () => {
    const s = startDraft(lobby(2), 'dev-h', 0, ALL);
    const f = inFlightOf(snap(s), 0);
    const other = s.teams.find((t) => t.id !== 'h')!;
    expect(actionSettled('pick', f, snap(setOnline(s, other.id, false)))).toBe(false);
    expect(actionSettled('pick', f, snap(autoPick(s)))).toBe(true);
    // auto-pick (Host für ein Team) genauso
    expect(actionSettled('auto-pick', f, snap(setOnline(s, other.id, true)))).toBe(false);
    expect(actionSettled('auto-pick', f, snap(autoPick(s)))).toBe(true);
  });

  it('Start: nur der Phasenwechsel', () => {
    const s = lobby(2);
    const f = inFlightOf(snap(s), 0);
    expect(actionSettled('start', f, snap(setOnline(s, 't1', true)))).toBe(false);
    expect(actionSettled('start', f, snap(joinDraft(s, { teamId: 't2', deviceId: 'dev-2', name: 'Neu', formation: '4-4-2' })))).toBe(false);
    expect(actionSettled('start', f, snap(startDraft(s, 'dev-h', 0, ALL)))).toBe(true);
  });

  it('Beitreten: erst wenn der Schnappschuss das eigene Team nennt', () => {
    const s = lobby(2);
    const f = inFlightOf(snap(s, null), 0);
    expect(actionSettled('join', f, snap(setOnline(s, 't1', true), null))).toBe(false);
    const joined = joinDraft(s, { teamId: 't9', deviceId: 'dev-9', name: 'Ich', formation: '4-4-2' });
    expect(actionSettled('join', f, snap(joined, 't9'))).toBe(true);
  });

  it('CPU hinzufügen: ein Mensch, der gleichzeitig beitritt, zählt nicht', () => {
    const s = lobby(2);
    const f = inFlightOf(snap(s), 0);
    const human = joinDraft(s, { teamId: 't2', deviceId: 'dev-2', name: 'Neu', formation: '4-4-2' });
    expect(actionSettled('add-cpu', f, snap(human))).toBe(false);
    expect(actionSettled('add-cpu', f, snap(addCpuTeam(s, 'dev-h', 'cpu1')))).toBe(true);
  });

  it('Einstellungen: übernommen oder vom Server angepasst – nicht durch fremde Änderungen', () => {
    const s = snap(lobby(2));
    const f = inFlightOf(s, 0, { roll: 'pick' });
    expect(actionSettled('settings', f, { ...s, teams: s.teams.slice(0, 1) })).toBe(false);
    expect(actionSettled('settings', f, { ...s, settings: { ...s.settings, name: 'Liga' } })).toBe(false);
    expect(actionSettled('settings', f, { ...s, settings: { ...s.settings, roll: 'pick' } })).toBe(true);
    expect(actionSettled('settings', f, { ...s, settings: { ...s.settings, roll: 'round' } })).toBe(true);
  });

  it('Einstellungen mit Listen (Generationen, Typen, Rerolls): inhaltlich verglichen, nicht per Objekt', () => {
    const s = snap(lobby(2));
    const f = inFlightOf(s, 0, { gens: [1, 2], rerolls: { type: 2, region: 1 } });
    // Neuer Schnappschuss mit neuen (aber gleichen) Listen des alten Stands → noch nicht bestätigt
    expect(actionSettled('settings', f, { ...s, settings: { ...s.settings, gens: [...s.settings.gens], rerolls: { ...s.settings.rerolls } } })).toBe(false);
    // Übernommen (neue Objekte mit gleichem Inhalt)
    expect(actionSettled('settings', f, { ...s, settings: { ...s.settings, gens: [1, 2], rerolls: { type: 2, region: 1 } } })).toBe(true);
    // Vom Server anders angepasst
    expect(actionSettled('settings', f, { ...s, settings: { ...s.settings, gens: [3] } })).toBe(true);
  });

  it('Reroll: bestätigt durch einen neuen Wurf oder den nächsten Pick – nicht durch fremde Schnappschüsse', () => {
    const s = startDraft(lobby(2, { region: 0, maxTeams: 4, order: 'host', roll: 'pick' }), 'dev-h', 0, ALL);
    expect(s.roll).toBeTruthy();
    const f = inFlightOf(snap(s), 0);
    expect(f.roll).toEqual(s.roll);
    const other = s.teams.find((t) => t.id !== 'h')!;
    expect(actionSettled('reroll', f, snap(setOnline(s, other.id, true)))).toBe(false);
    // Gleicher Wurf in einem neuen Objekt: noch nicht
    expect(actionSettled('reroll', f, { ...snap(s), roll: { ...s.roll! } })).toBe(false);
    expect(actionSettled('reroll', f, snap(applyReroll(s, 'h', 'type', ALL)))).toBe(true);
    expect(actionSettled('reroll', f, snap(autoPick(s)))).toBe(true);
    // Fehler zum Reroll löst nur dessen Sperre
    const map: InFlightMap = { pick: inFlightOf(snap(s), 0), reroll: f };
    expect(Object.keys(releaseInFlight(map, 'reroll'))).toEqual(['pick']);
  });

  it('settleInFlight trägt nur Bestätigtes aus und behält sonst das Objekt', () => {
    const s = startDraft(lobby(2), 'dev-h', 0, ALL);
    const map: InFlightMap = { pick: inFlightOf(snap(s), 0), 'auto-pick': inFlightOf(snap(s), 0) };
    const other = s.teams.find((t) => t.id !== 'h')!;
    expect(settleInFlight(map, snap(setOnline(s, other.id, false)))).toBe(map);
    expect(settleInFlight(map, snap(autoPick(s)))).toEqual({});
  });

  it('ohne Antwort: nach DRAFT_ACTION_TIMEOUT_MS wieder frei', () => {
    const s = snap(lobby(2));
    const map: InFlightMap = { start: inFlightOf(s, 1000), join: inFlightOf(s, 5000) };
    expect(expireInFlight(map, 1000 + DRAFT_ACTION_TIMEOUT_MS - 1)).toEqual({ map, expired: [] });
    const { map: rest, expired } = expireInFlight(map, 1000 + DRAFT_ACTION_TIMEOUT_MS);
    expect(expired).toEqual(['start']);
    expect(Object.keys(rest)).toEqual(['join']);
  });

  it('Fehler lösen nur die Sperre der abgelehnten Aktion – ohne Zuordnung alle', () => {
    const s = snap(lobby(2));
    const map: InFlightMap = { pick: inFlightOf(s, 0), settings: inFlightOf(s, 0) };
    // Fremder Fehler (z. B. Lobby-Änderung abgelehnt) gibt den laufenden Pick nicht frei
    expect(Object.keys(releaseInFlight(map, 'settings'))).toEqual(['pick']);
    expect(releaseInFlight(map, 'leave')).toBe(map);
    expect(releaseInFlight(map, 'constructor')).toBe(map);
    expect(releaseInFlight(map)).toEqual({});
    const none: InFlightMap = {};
    expect(releaseInFlight(none)).toBe(none);
  });
});

// ---------------------------------------------------------------- Reihenfolge ohne Snake

describe('draftRoomView ohne Snake', () => {
  it('Runde 2 beginnt wieder beim ersten Team (Anzeige wie Engine)', () => {
    let s = startDraft(lobby(3, { region: 0, maxTeams: 4, order: 'host', snake: false }), 'dev-h', 0, ALL);
    for (let i = 0; i < 3; i++) s = autoPick(s, 1000 + i);
    const v = draftRoomView(snap(s, 'h'));
    expect(v.round).toBe(2);
    expect(v.currentIndex).toBe(0);
    expect(v.current?.id).toBe(s.teams[0].id);
    expect(v.myTurn).toBe(true);
    // Mit Snake wäre das letzte Team aus Runde 1 noch einmal dran
    let snake = startDraft(lobby(3, { region: 0, maxTeams: 4, order: 'host' }), 'dev-h', 0, ALL);
    for (let i = 0; i < 3; i++) snake = autoPick(snake, 1000 + i);
    expect(draftRoomView(snap(snake, 'h')).currentIndex).toBe(2);
  });
});

// ---------------------------------------------------------------- CLIENT-7 / SEASON-3 / CLIENT-2

describe('öffentliche Vorschau', () => {
  const s = snap(lobby(2), null);
  it('beim ersten Aufbau kurz warten (keine Zuschauer-Ansicht für Mitspieler)', () => {
    expect(draftRoomReady({ state: s, live: false, status: 'connecting', authError: null })).toBe(false);
    expect(draftRoomReady({ state: null, live: false, status: 'reconnecting', authError: null })).toBe(false);
  });

  it('klappt der Aufbau nicht (Neuversuch, Anmeldung abgelehnt, getrennt): Vorschau statt Endlos-Spinner', () => {
    expect(draftRoomReady({ state: s, live: false, status: 'reconnecting', authError: null })).toBe(true);
    expect(draftRoomReady({ state: s, live: false, status: 'connecting', authError: 'Zu viele neue Geräte' })).toBe(true);
    expect(draftRoomReady({ state: s, live: false, status: 'closed', authError: null })).toBe(true);
  });

  it('eigener Schnappschuss: immer', () => {
    expect(draftRoomReady({ state: s, live: true, status: 'connecting', authError: null })).toBe(true);
  });
});

// ---------------------------------------------------------------- CLIENT-8

describe('Existenzprüfung', () => {
  it('wiederholt sich nach Fehlern mit wachsender Pause (2 s … 30 s)', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map((n) => checkRetryDelay(n))).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    expect(checkRetryDelay(-1)).toBe(2000);
    expect(CHECK_RETRY_MAX_MS).toBe(30_000);
  });
});

// ---------------------------------------------------------------- CLIENT-1

describe('Schlüssel der vergebenen Pokémon', () => {
  it('bleibt bei Online-Wechseln gleich, ändert sich mit jedem Pick', () => {
    const s = startDraft(lobby(2), 'dev-h', 0, ALL);
    const key = draftedKey(snap(s));
    const other = s.teams.find((t) => t.id !== 'h')!;
    expect(draftedKey(snap(setOnline(s, other.id, false)))).toBe(key);
    expect(draftedKey(snap(autoPick(s)))).not.toBe(key);
  });
});

// ---------------------------------------------------------------- CLIENT-9

describe('Ansage pro Pick', () => {
  it('eine kurze Ansage: Pick, Pokémon, Team, wer jetzt dran ist', () => {
    let s = startDraft(addCpuTeam(lobby(2), 'dev-h', 'cpu1'), 'dev-h', 0, ALL);
    expect(pickAnnouncement(snap(s, null), byId)).toBe('');
    s = autoPick(s);
    const last = s.picks[0];
    const team = s.teams.find((t) => t.id === last.teamId)!;
    const next = currentTeam(s)!;
    expect(pickAnnouncement(snap(s, null), byId)).toBe(
      `Pick 1: ${byId.get(last.pokemonId)!.de} an ${team.name} (automatisch). Am Zug: ${next.name}.`,
    );
    // Eigener Pick → „an dich"; selbst dran → kein „Am Zug" (das meldet „Du bist dran!")
    expect(pickAnnouncement(snap(s, team.id), byId)).toContain(' an dich (automatisch).');
    expect(pickAnnouncement(snap(s, next.id), byId)).not.toContain('Am Zug');
  });

  it('Verlauf und Timer sind keine Live-Regionen mehr', () => {
    let s = startDraft(lobby(2), 'dev-h', 0, ALL);
    s = autoPick(autoPick(s));
    const feed = renderToStaticMarkup(createElement(DraftPickFeed, { items: pickFeed(snap(s), byId), you: 'h' }));
    expect(feed).toContain('Letzte Picks');
    expect(feed).not.toMatch(/aria-live|role="status"/);
    for (const cpu of [true, false]) {
      const timer = renderToStaticMarkup(createElement(DraftCountdown, { deadline: null, pickSeconds: 0, clockOffset: 0, cpu }));
      expect(timer).not.toMatch(/aria-live|role="status"/);
    }
  });
});
