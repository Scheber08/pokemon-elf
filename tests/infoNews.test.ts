/** „Was ist neu?“: Deutsch und Englisch mit gleich vielen Einträgen (Arrays prüft TypeScript nicht auf Länge). */
import { describe, expect, it } from 'vitest';
import de from '../src/i18n/de/info';
import en from '../src/i18n/en/info';

describe('Neuigkeiten', () => {
  it('gleich viele Einträge in beiden Sprachen, neueste zuerst', () => {
    expect(en.about.news).toHaveLength(de.about.news.length);
    expect(de.about.news[0]).toContain('Frühaufsteher');
    expect(de.about.news[1]).toContain('Draft-Legende');
    expect(en.about.news[0]).toContain('Early riser');
    expect(en.about.news[1]).toContain('Draft legend');
    expect(de.about.news.every((n) => n.trim().length > 0)).toBe(true);
  });
});
