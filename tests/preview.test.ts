/** Link-Vorschau einer Online-Liga: Pfad → Code, Meta-Angaben je Phase. */
import { describe, expect, it } from 'vitest';
import { draftPageCode, draftPageMeta, profilePageId, profilePageMeta } from '../server/preview';

const row = (phase: string, name = 'Pokal') => ({ name, host_name: 'Ash', teams: 3, max_teams: 6, phase });

describe('Liga-Vorschau', () => {
  it('erkennt nur gültige Liga-Pfade', () => {
    expect(draftPageCode('/draft/ABC234')).toBe('ABC234');
    expect(draftPageCode('/draft/abc234/')).toBe('ABC234');
    for (const p of ['/draft', '/draft/', '/draft/ABC23', '/draft/ABC2340', '/draft/ABC0O1', '/draft/ABC234/x', '/api/drafts/ABC234']) {
      expect(draftPageCode(p), p).toBeNull();
    }
  });

  it('Lobby, Draft, fertig, unbekannt – mit absoluten Adressen', () => {
    const o = 'https://elf.example';
    const lobby = draftPageMeta('ABC234', row('lobby'), o);
    expect(lobby.title).toBe('Online-Liga „Pokal“ · Pokémon Elf');
    expect(lobby.description).toContain('Ash lädt dich zum Fantasy-Draft ein – 3/6 Teams');
    expect(lobby.url).toBe('https://elf.example/draft/ABC234');
    expect(lobby.image).toBe('https://elf.example/og.png');
    expect(draftPageMeta('ABC234', row('drafting'), o).description).toContain('Der Draft läuft');
    expect(draftPageMeta('ABC234', row('done'), o).description).toContain('Saison beendet');
    expect(draftPageMeta('ABC234', row('lobby', ' '), o).title).toBe('Online-Liga ABC234 · Pokémon Elf');
    expect(draftPageMeta('ABC234', null, o).title).toBe('Online-Liga ABC234 · Pokémon Elf');
    expect(draftPageMeta('ABC234', row('closed'), o).description).not.toContain('Ash');
  });
});

describe('Profil-Vorschau', () => {
  const id = '0f8c6a3e-1b2d-4c5e-8f90-123456789abc';
  it('erkennt nur Profil-Pfade mit gültiger Eintrags-ID', () => {
    expect(profilePageId(`/spieler/${id}`)).toBe(id);
    expect(profilePageId(`/spieler/${id}/`)).toBe(id);
    for (const p of ['/spieler', '/spieler/', '/spieler/abc', `/spieler/${id}/x`, `/api/entries/${id}/player`]) {
      expect(profilePageId(p), p).toBeNull();
    }
  });

  it('Name, Runs und bester Platz – ohne Profil allgemein', () => {
    const o = 'https://elf.example';
    const m = profilePageMeta(id, { player: 'Misty', runs: 1, best: null }, o);
    expect(m.title).toBe('Profil von Misty · Pokémon Elf');
    expect(m.description.startsWith('1 gewerteter Run. ')).toBe(true);
    expect(m.url).toBe(`${o}/spieler/${id}`);
    const g = profilePageMeta(id, null, o);
    expect(g.title).toBe('Spielerprofil · Pokémon Elf');
  });
});
