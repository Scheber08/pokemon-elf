/** Teilen-Text der Challenge-Saison: Bilanz, Platz, Punkte, Challenge und Score. */
import { describe, expect, it } from 'vitest';
import { messages } from '../src/i18n';

describe('Teilen-Text', () => {
  it('Deutsch und Englisch', () => {
    expect(messages('de').result.shareText('30–2–2', 731, 1, 92, '34–0 Challenge')).toBe(
      'Ich bin mit meiner Pokémon-Elf 30–2–2 gegangen – Platz 1 mit 92 Punkten (34–0 Challenge)! Score 731',
    );
    expect(messages('en').result.shareText('30–2–2', 731, 2, 92, 'Daily XI')).toBe('My Pokémon XI went 30–2–2 – 2nd place with 92 points (Daily XI)! Score 731');
    // Bei neuem Bestwert hängt das Ergebnis „🏅 Neuer Bestwert!“ an
    expect(messages('de').result.shareText('30–2–2', 731, 1, 92, '34–0 Challenge') + messages('de').result.shareNewBest).toMatch(/Score 731 🏅 Neuer Bestwert!$/);
    expect(messages('en').result.shareNewBest).toBe(' 🏅 New personal best!');
  });
});
