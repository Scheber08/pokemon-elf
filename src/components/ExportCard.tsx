import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import type { FormationId, Pokemon, SpriteStyle } from '../types';
import { PitchMarkings } from './PitchMarkings';
import { PlayerToken } from './PlayerToken';
import type { SpriteSource } from './Sprite';

export interface ExportResult {
  record: string;
  points: number;
  score: number;
  position: number;
  label: string;
}

interface Props {
  formation: FormationId;
  players: (Pokemon | null | undefined)[];
  /** undefined = kein SS */
  ss?: Pokemon | null;
  sprite: SpriteStyle;
  images: Map<number, SpriteSource>;
  teamName: string;
  subtitle?: string;
  result?: ExportResult;
  watermark: string;
}

export const EXPORT_W = 1200;
export const EXPORT_H = 1500;
const PITCH_W = 880;

/** Statisches 1200×1500-Bild (Spielfeld, Teamname, ggf. Saisonbilanz) für html2canvas. */
export function ExportCard({ formation, players, ss, sprite, images, teamName, subtitle, result, watermark }: Props) {
  const t = useT();
  const defs = FORMATIONS[formation].slots;
  return (
    <div className="export-card" style={{ width: EXPORT_W, height: EXPORT_H }}>
      <div className="export-card__head">
        <div>
          <div className="export-card__kicker">Pokémon Elf{result ? ` · ${result.label}` : ''}</div>
          <div className="export-card__team">{teamName || t.builder.exportCard.defaultTeam}</div>
          <div className="export-card__sub">{subtitle ?? formation}</div>
        </div>
        {result && (
          <div className="export-card__result">
            <div className="export-card__record">{result.record}</div>
            <div className="export-card__stats">
              {t.builder.exportCard.stats(result.points, result.score, result.position)}
            </div>
          </div>
        )}
      </div>
      <div
        className="pitch-wrap pitch-wrap--export"
        style={{ ['--pw' as string]: `${PITCH_W}px`, ['--ps' as string]: PITCH_W / 560, width: PITCH_W }}
      >
        <div className="pitch">
          <PitchMarkings />
          {defs.map((d, i) => {
            const p = players[i] ?? null;
            return (
              <div key={i} className={`slot ${p ? 'slot--filled' : 'slot--empty'}`} style={{ left: `${d.x}%`, top: `${d.y}%`, zIndex: Math.round(d.y) }}>
                <PlayerToken pos={d.pos} pokemon={p} sprite={sprite} source={p ? images.get(p.id) : undefined} />
              </div>
            );
          })}
          {ss !== undefined && (
            <div className={`slot slot--export-ss ${ss ? 'slot--filled' : 'slot--empty'}`} style={{ left: '89%', top: '91%' }}>
              <PlayerToken pos="SS" pokemon={ss} sprite={sprite} source={ss ? images.get(ss.id) : undefined} />
            </div>
          )}
        </div>
      </div>
      <div className="export-card__watermark">{watermark}</div>
    </div>
  );
}
