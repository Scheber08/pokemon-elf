/** Spielerprofil: Platz je Wertung und „Profil teilen" (Zwischenablage, wenn kein Teilen-Menü da ist). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerProfile } from '../src/lib/api/contract';
import { installMiniDom, type MiniNode } from './miniDom';

const doc = installMiniDom();
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Route, Routes } = await import('react-router-dom');
const { Profile } = await import('../src/pages/Profile');
const { ToastProvider } = await import('../src/state/Toast');
const { act, createElement: h } = React;

const PROFILE: PlayerProfile = {
  player: 'Ash',
  since: '2026-10-01T10:00:00.000Z',
  runs: 4,
  challenges: [
    { challenge: 'c340', runs: 3, perfect: 0, place: 4, players: 57, best: null },
    {
      challenge: 'c151',
      runs: 1,
      perfect: 0,
      best: { entryId: 'e1', teamName: 'Kanto', formation: '4-3-3', day: '2026-10-02', record: { w: 30, d: 2, l: 2 }, points: 92, score: 800 },
    },
  ],
  recent: [
    { challenge: 'c151', day: '2026-10-02', teamName: 'Kanto', record: { w: 30, d: 2, l: 2 }, points: 92, score: 800, createdAt: '2026-10-02T10:00:00.000Z' },
    { challenge: 'c151', day: '2026-10-01', teamName: 'Kanto', record: { w: 20, d: 2, l: 12 }, points: 62, score: 780, createdAt: '2026-10-01T10:00:00.000Z' },
    { challenge: 'c340', day: '2026-09-30', teamName: 'Johto', record: { w: 18, d: 16, l: 0 }, points: 58, score: 700, createdAt: '2026-09-30T10:00:00.000Z' },
  ],
};

const text = (n: MiniNode): string => n.textContent;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Spielerprofil', () => {
  it('zeigt den Allzeit-Platz und kopiert den Profil-Link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(PROFILE), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    vi.stubGlobal('location', { href: 'https://elf.example/spieler/abc' });
    const written: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (s: string) => void written.push(s) } });
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () =>
      root.render(
        h(
          ToastProvider,
          null,
          h(MemoryRouter, { initialEntries: ['/spieler/abc'] }, h(Routes, null, h(Route, { path: '/spieler/:entryId', element: h(Profile) }))),
        ),
      ),
    );
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(text(container)).toContain('Platz 4 von 57');
    // Top n % (ab 10 Spielern, aufgerundet): 4 von 57 → Top 8 %
    expect(container.querySelector('.profile__top-pct')!.textContent).toBe(' · Top 8 %');
    // „zuletzt aktiv …“ aus dem neuesten Run
    {
      const { ago } = await import('../src/lib/ago');
      const { messages } = await import('../src/i18n');
      expect(container.querySelector('.profile__active')!.textContent).toBe(` · zuletzt aktiv ${ago(Date.parse(PROFILE.recent[0].createdAt), messages('de'))}`);
    }
    // ⭐ Lieblings-Challenge (meiste Runs, eindeutig)
    expect(container.querySelector('.profile__fav')!.textContent).toBe('⭐ Lieblings-Challenge: 34–0 Challenge (3 Runs)');
    // 🏅 nur am Run, der der Bestwert seiner Wertung ist
    expect(container.querySelectorAll('.profile__best').length).toBe(1);
    // … auch für Screenreader benannt (wie 🏆/🛡️)
    expect(container.querySelector('.profile__best')!.getAttribute('role')).toBe('img');
    expect(container.querySelector('.profile__best')!.getAttribute('aria-label')).toBe('Bestwert dieser Wertung');
    // 🛡️ an Runs ohne Niederlage
    const unbeaten = container.querySelectorAll('.profile__unbeaten');
    expect(unbeaten.length).toBe(1);
    expect(unbeaten[0].getAttribute('aria-label')).toBe('Ungeschlagen – keine Niederlage in der Saison');
    // 🏆 statt 🛡️ bei einer perfekten Saison (nur Siege) – im Fixture keine
    expect(container.querySelector('.profile__perfect-run')).toBeNull();
    // Filter „Letzte Runs“ nach Wertung (Runs aus zwei Wertungen)
    const chips = container.querySelectorAll('.profile__filter button');
    expect(chips.map((b) => b.textContent)).toEqual(['Alle', '151 Challenge', '34–0 Challenge']);
    const recentRows = () => container.querySelectorAll('section')[1].querySelectorAll('tr').length;
    expect(recentRows()).toBe(3);
    // Ø Punkte der gezeigten Runs mit dem besten (ab zwei; Trend erst ab sechs)
    expect(container.querySelector('.profile__avg')!.textContent).toBe('Ø 71 Pkt aus 3 Runs · 🔝 Bester: 92 Pkt');
    await act(async () => chips[1].click());
    expect(container.querySelector('.profile__avg')!.textContent).toBe('Ø 77 Pkt aus 2 Runs · 🔝 Bester: 92 Pkt');
    await act(async () => container.querySelectorAll('.profile__filter button')[2].click());
    expect(recentRows()).toBe(1);
    expect(container.querySelector('.profile__avg')).toBeNull();
    await act(async () => container.querySelectorAll('.profile__filter button')[0].click());
    expect(recentRows()).toBe(3);
    const btn = container.querySelectorAll('button').find((b) => b.textContent === 'Profil teilen')!;
    await act(async () => btn.click());
    for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(written).toEqual(['https://elf.example/spieler/abc']);
    expect(text(doc.body)).toContain('Link zum Profil kopiert');
    await act(async () => root.unmount());
  });

  it('🏆 an Runs mit perfekter Saison (statt 🛡️)', async () => {
    const recent = [
      { ...PROFILE.recent[0], record: { w: 34, d: 0, l: 0 }, points: 102 },
      { ...PROFILE.recent[2], record: { w: 18, d: 16, l: 0 } },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...PROFILE, recent }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () =>
      root.render(h(ToastProvider, null, h(MemoryRouter, { initialEntries: ['/spieler/abc'] }, h(Routes, null, h(Route, { path: '/spieler/:entryId', element: h(Profile) }))))),
    );
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    const perfect = container.querySelectorAll('.profile__perfect-run');
    expect(perfect).toHaveLength(1);
    expect(perfect[0].getAttribute('aria-label')).toBe('Perfekte Saison – nur Siege');
    expect(container.querySelectorAll('.profile__unbeaten')).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('Trend der letzten 3 Runs gegenüber den älteren (ab sechs Runs)', async () => {
    const run = (points: number, i: number) => ({ ...PROFILE.recent[0], day: `2026-10-0${9 - i}`, createdAt: `2026-10-0${9 - i}T10:00:00.000Z`, points });
    const recent = [90, 80, 70, 60, 50, 40].map(run);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...PROFILE, recent }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () =>
      root.render(h(ToastProvider, null, h(MemoryRouter, { initialEntries: ['/spieler/abc'] }, h(Routes, null, h(Route, { path: '/spieler/:entryId', element: h(Profile) }))))),
    );
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(container.querySelector('.profile__avg')!.textContent).toBe('Ø 65 Pkt aus 6 Runs · 🔝 Bester: 90 Pkt · ▲ +30 Pkt in den letzten 3 Runs gegenüber davor');
    expect(container.querySelector('.profile__trend')!.className).toContain('is-up');
    await act(async () => root.unmount());
  });
});
