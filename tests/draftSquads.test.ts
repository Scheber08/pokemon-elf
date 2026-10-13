/**
 * Online-Draft nach dem letzten Pick: Vor dem Anpfiff der gemeinsamen Saison zeigt der Ticker die
 * fertigen Kader (eigenes Team zuerst, dann nach Team-Score) – danach nicht mehr.
 * Gerendert wird mit react-dom/client auf dem Mini-DOM (tests/miniDom.ts).
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftSnapshot } from '../src/lib/api/draftContract';
import type { DraftState } from '../src/lib/draftEngine';
import type { DraftRoom } from '../src/state/useDraftRoom';
import { ALL } from './helpers';
import { installMiniDom } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { DraftSeasonStage } = await import('../src/components/DraftSeasonStage');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { DRAFT_LIMITS } = await import('../src/lib/api/draftContract');
const { buildScale } = await import('../src/lib/fit');
const engine = await import('../src/lib/draftEngine');

const { act, createElement: h } = React;
const SCALE = buildScale(ALL, 'all');

const mounted: (() => Promise<void>)[] = [];

async function render(el: ReactElement) {
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(el));
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.parentNode?.removeChild(container);
  });
  return container;
}

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

const app = (child: ReactElement) =>
  h(MemoryRouter, null, h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, child))));

/** Host + zwei CPU-Teams, fertig gedraftet (nur Auto-Picks) */
function finishedDraft(): DraftState {
  let s = engine.createDraft({
    code: 'K7MPQ2',
    seed: 7,
    settings: { maxTeams: 4, order: 'host', pickSeconds: 0 },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Rocket FC', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  s = engine.addCpuTeam(s, 'dev-h', 'cpu1');
  s = engine.addCpuTeam(s, 'dev-h', 'cpu2');
  s = engine.startDraft(s, 'dev-h', 0, ALL);
  while (s.phase === 'drafting') {
    const team = engine.currentTeam(s)!;
    const c = engine.autoPickChoice(s, team.id, ALL, SCALE, false);
    s = engine.applyPick(s, team.id, c.pokemonId, c.slot, true, 1000, ALL);
  }
  return engine.withLeague(s, ALL, SCALE);
}

function roomAt(startsAt: number): DraftRoom {
  const s = finishedDraft();
  const snap: DraftSnapshot = engine.snapshotOf(s, 'h', Date.now());
  snap.season = { ...snap.season!, startsAt };
  return { state: snap, me: snap.teams.find((t) => t.id === 'h') ?? null, clockOffset: 0 } as unknown as DraftRoom;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('data/pokemon.json')
        ? new Response(JSON.stringify(ALL), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Kader vor dem Anpfiff', () => {
  it('der Vorlauf lässt Zeit, sich das Draft-Ergebnis anzusehen', () => {
    expect(DRAFT_LIMITS.seasonLeadMs).toBeGreaterThanOrEqual(20_000);
    expect(DRAFT_LIMITS.seasonStepMs).toBeGreaterThanOrEqual(3500);
  });

  it('vor dem Anpfiff: alle Kader, das eigene Team zuerst, dann nach Team-Score', async () => {
    const room = roomAt(Date.now() + 20_000);
    const container = await render(app(h(DraftSeasonStage, { room })));
    await settle();
    const squads = container.querySelector('.draft-squads');
    expect(squads).not.toBeNull();
    const cards = squads!.querySelectorAll('.draft-results__roster');
    expect(cards).toHaveLength(3);
    expect(cards[0].className).toContain('is-you');
    expect(cards[0].textContent).toContain('Rocket FC');
    const scores = cards.slice(1).map((c) => Number(c.querySelector('.draft-results__score')!.textContent));
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
    // Jeder Kader mit Spielfeld (11 Plätze)
    expect(cards[1].querySelectorAll('[data-slot-index]').length).toBe(11);
    expect(container.textContent).toContain('Anpfiff in');
  });

  it('nach dem Anpfiff keine Kader mehr im Ticker', async () => {
    const room = roomAt(Date.now() - 1000);
    const container = await render(app(h(DraftSeasonStage, { room })));
    await settle();
    expect(container.querySelector('.league-ticker')).not.toBeNull();
    expect(container.querySelector('.draft-squads')).toBeNull();
  });
});
