/** Geteilte Plätze in Torjäger- und Scorerlisten (gleicher Wert → gleicher Platz). */
import { describe, expect, it } from 'vitest';
import { sharedRanks } from '../src/lib/ranks';

describe('sharedRanks', () => {
  it('gleiche Werte teilen den Platz, danach geht es mit der Position weiter', () => {
    expect(sharedRanks([5, 5, 3, 2, 2, 2, 1])).toEqual([1, 1, 3, 4, 4, 4, 7]);
    expect(sharedRanks([9, 8, 7])).toEqual([1, 2, 3]);
    expect(sharedRanks([4, 4, 4])).toEqual([1, 1, 1]);
    expect(sharedRanks([])).toEqual([]);
  });
});
