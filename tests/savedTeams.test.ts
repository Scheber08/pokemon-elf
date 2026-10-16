/** Builder „Meine Teams": Liste speichern/ersetzen/begrenzen, kaputte Daten aussortieren. */
import { beforeEach, describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

installMiniDom();
const { droppedBy, loadSavedTeams, SAVED_TEAMS_MAX, withSavedTeam } = await import('../src/components/SavedTeams');
const { save, STORAGE_KEYS } = await import('../src/lib/storage');

const entry = (name: string, at = 1) => ({ id: `${name}-${at}`, name, formation: '4-3-3', at, state: { teamName: name, formation: '4-3-3' } });

beforeEach(() => localStorage.clear());

describe('Meine Teams', () => {
  it('neue nach vorn, gleicher Name ersetzt, höchstens SAVED_TEAMS_MAX', () => {
    let list = [entry('A'), entry('B')];
    list = withSavedTeam(list, entry('a', 2));
    expect(list.map((x) => x.id)).toEqual(['a-2', 'B-1']);
    for (let i = 0; i < 10; i++) list = withSavedTeam(list, entry(`T${i}`, 3 + i));
    expect(list).toHaveLength(SAVED_TEAMS_MAX);
    expect(list[0].name).toBe('T9');
  });

  it('volle Liste: neuer Name verdrängt die älteste, gleicher Name ersetzt nur', async () => {
    const list = Array.from({ length: SAVED_TEAMS_MAX }, (_, i) => entry(`T${i}`, 10 - i));
    expect(droppedBy(list.slice(1), 'Neu')).toBeNull();
    expect(droppedBy(list, 'Neu')!.name).toBe(`T${SAVED_TEAMS_MAX - 1}`);
    // Ohne Namen speichert der Builder als „Elf n“ – auch das verdrängt
    expect(droppedBy(list, '  ')!.name).toBe(`T${SAVED_TEAMS_MAX - 1}`);
    expect(droppedBy(list, ' t2 ')).toBeNull();
    const { messages } = await import('../src/i18n');
    expect(messages('de').builder.saved.full('T4')).toBe('Liste voll – beim Speichern fällt die älteste weg: „T4“');
  });

  it('liest nur gültige Einträge', () => {
    save(STORAGE_KEYS.savedTeams, [entry('Gut'), { name: 3 }, null, 'x']);
    expect(loadSavedTeams().map((x) => x.name)).toEqual(['Gut']);
    save(STORAGE_KEYS.savedTeams, { kaputt: true });
    expect(loadSavedTeams()).toEqual([]);
  });
});
