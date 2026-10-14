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
  runs: 3,
  challenges: [{ challenge: 'c340', runs: 3, perfect: 0, place: 4, players: 57, best: null }],
  recent: [],
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
    const btn = container.querySelectorAll('button').find((b) => b.textContent === 'Profil teilen')!;
    await act(async () => btn.click());
    for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(written).toEqual(['https://elf.example/spieler/abc']);
    expect(text(doc.body)).toContain('Link zum Profil kopiert');
    await act(async () => root.unmount());
  });
});
