/**
 * Öffentliche Lobbys: Die Fakten-Zeile bricht auf dem Handy um. Die Trenner „·“ sitzen in der Lücke vor
 * jedem Eintrag und werden am Zeilenanfang abgeschnitten (overflow: hidden) – kein verwaister Trenner.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/draft.css', import.meta.url), 'utf8');
const rule = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  return i < 0 ? null : css.slice(i, css.indexOf('}', i));
};

describe('Lobby-Fakten: Trenner beim Umbruch', () => {
  it('Trenner in der Lücke (negativer Rand) und abgeschnitten am Zeilenanfang', () => {
    expect(rule('.draft-lobbies__facts')).toContain('overflow: hidden');
    const sep = rule('.draft-lobbies__facts > span::before')!;
    expect(sep).toContain("content: '·'");
    expect(sep).toContain('margin-left: -10px');
    // Der alte Trenner nach dem Vorgänger (verwaist am Zeilenanfang) ist weg
    expect(css).not.toContain('.draft-lobbies__facts span + span::before');
  });
});
