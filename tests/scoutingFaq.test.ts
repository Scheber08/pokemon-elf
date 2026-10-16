/** Scouting-Guide: FAQ in beiden Sprachen gleich lang, Symbol-Erklärung für die Challenges. */
import { describe, expect, it } from 'vitest';
import de from '../src/i18n/de/scouting';
import en from '../src/i18n/en/scouting';

describe('Scouting-FAQ', () => {
  it('gleich viele Fragen in DE und EN, Challenge-Symbole direkt nach den Draft-Symbolen', () => {
    expect(en.faq).toHaveLength(de.faq.length);
    const i = de.faq.findIndex((f) => f.q.startsWith('Was bedeuten ⚡'));
    expect(de.faq[i + 1].q).toBe('Was bedeuten 🏁, 🏅, 💯, 🛡️ und 🏆 in den Challenges?');
    expect(en.faq[i + 1].q).toBe('What do 🏁, 🏅, 💯, 🛡️ and 🏆 mean in the challenges?');
    for (const sym of ['🏁', '🏅', '💯', '🛡️', '🏆']) {
      expect(de.faq[i + 1].a).toContain(sym);
      expect(en.faq[i + 1].a).toContain(sym);
    }
  });
});
