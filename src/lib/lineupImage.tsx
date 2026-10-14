import { ExportCard, type ExportResult } from '../components/ExportCard';
import type { FormationId, Pokemon, Slots, SpriteStyle } from '../types';
import type { Jerseys } from './jerseys';
import { renderToPng, spriteDataUrls } from './exportImage';

interface Options {
  formation: FormationId;
  slots: Slots;
  /** undefined = kein SS-Slot */
  ss?: number | null;
  sprite: SpriteStyle;
  byId: Map<number, Pokemon>;
  teamName: string;
  subtitle?: string;
  result?: ExportResult;
  /** Eigene Trikotnummern */
  jerseys?: Jerseys;
}

/** Erzeugt das 1200×1500-PNG einer Aufstellung (optional mit Saisonbilanz). */
export async function lineupImage(o: Options): Promise<Blob> {
  const players = o.slots.map((id) => (id != null ? o.byId.get(id) ?? null : null));
  const ss = o.ss === undefined ? undefined : o.ss != null ? o.byId.get(o.ss) ?? null : null;
  const images = await spriteDataUrls([...players, ss], o.sprite);
  const watermark = `${window.location.host}${import.meta.env.BASE_URL}`.replace(/\/$/, '');
  return renderToPng(
    <ExportCard
      formation={o.formation}
      players={players}
      ss={ss}
      sprite={o.sprite}
      images={images}
      teamName={o.teamName}
      subtitle={o.subtitle}
      result={o.result}
      watermark={watermark}
      jerseys={o.jerseys}
    />,
  );
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'pokemon-elf'
  );
}
