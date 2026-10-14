import { describe, expect, it } from 'vitest';
import { qrPath } from '../src/lib/qr';

describe('QR-Code des Liga-Links', () => {
  it('liefert ein quadratisches Modulraster als Pfad – deterministisch', async () => {
    const link = 'https://pokemon-elf.example/draft/K7MPQ2';
    const a = await qrPath(link);
    expect(a.size).toBeGreaterThanOrEqual(21);
    expect((a.size - 17) % 4).toBe(0);
    // Suchmuster oben links: erstes Modul dunkel
    expect(a.d.startsWith('M0 0h1v1h-1z')).toBe(true);
    expect(await qrPath(link)).toEqual(a);
    expect((await qrPath(`${link}X`)).d).not.toBe(a.d);
  });
});
