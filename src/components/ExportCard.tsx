import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import type { FormationId, Pokemon, SpriteStyle } from '../types';
import { PitchMarkings } from './PitchMarkings';
import { PlayerToken } from './PlayerToken';
import { jerseyNumbers, type Jerseys } from '../lib/jerseys';
import type { SpriteSource } from './Sprite';
import { Crest } from './Crest';
import type { Crest as CrestData } from '../lib/crest';

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
  /** Eigene Trikotnummern */
  jerseys?: Jerseys;
  /** Kapitän (Pokémon-ID) – Binde „C“ */
  captain?: number | null;
  /** Vereinswappen neben dem Teamnamen */
  crest?: CrestData | null;
  /** Data-URL des Wappentiers */
  crestHref?: string;
}

export const EXPORT_W = 1200;
export const EXPORT_H = 1500;
const PITCH_W = 880;

/** Statisches 1200×1500-Bild (Spielfeld, Teamname, ggf. Saisonbilanz) für html2canvas. */
export function ExportCard({ formation, players, ss, sprite, images, teamName, subtitle, result, watermark, jerseys, captain = null, crest = null, crestHref }: Props) {
  const t = useT();
  const defs = FORMATIONS[formation].slots;
  // Trikotnummern wie auf dem Feld (eigene bzw. Vorgabe nach Position)
  const numbers = jerseyNumbers(
    [...defs.flatMap((d, i) => (players[i] ? [{ pokemonId: players[i]!.id, pos: d.pos }] : [])), ...(ss ? [{ pokemonId: ss.id, pos: 'SS' as const }] : [])],
    jerseys ?? {},
  );
  return (
    <div className="export-card" style={{ width: EXPORT_W, height: EXPORT_H }}>
      <div className="export-card__head">
        <div>
          <div className="export-card__kicker">Pokémon Elf{result ? ` · ${result.label}` : ''}</div>
          <div className="export-card__team">
            {crest && (
              <>
                <Crest crest={crest} size={64} spriteHref={crestHref} />{' '}
              </>
            )}
            {teamName || t.builder.exportCard.defaultTeam}
          </div>
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
                <PlayerToken pos={d.pos} pokemon={p} sprite={sprite} source={p ? images.get(p.id) : undefined} number={p ? numbers.get(p.id) : null} captain={p != null && p.id === captain} />
              </div>
            );
          })}
          {ss !== undefined && (
            <div className={`slot slot--export-ss ${ss ? 'slot--filled' : 'slot--empty'}`} style={{ left: '89%', top: '91%' }}>
              <PlayerToken pos="SS" pokemon={ss} sprite={sprite} source={ss ? images.get(ss.id) : undefined} number={ss ? numbers.get(ss.id) : null} />
            </div>
          )}
        </div>
      </div>
      <div className="export-card__watermark">{watermark}</div>
    </div>
  );
}
