import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { useT } from '../i18n';
import type { FormationId } from '../types';
import '../styles/formation-mini.css';

/** Kleine Formations-Vorschau: Spielfeld mit einem Punkt je Position (Farben wie die Positions-Badges). */
export function FormationMini({ formation, small }: { formation: FormationId; small?: boolean }) {
  const t = useT();
  const slots = FORMATIONS[formation].slots;
  return (
    // Hochkant wie ein Spielfeld: 80 × 100, x-Koordinaten gestaucht
    <svg className={`formation-mini ${small ? 'formation-mini--sm' : ''}`} viewBox="0 0 80 100" role="img" aria-label={t.common.formationPreview(formation)}>
      <rect className="formation-mini__pitch" x="1" y="1" width="78" height="98" rx="5" />
      <line className="formation-mini__line" x1="1" y1="50" x2="79" y2="50" />
      <circle className="formation-mini__line" cx="40" cy="50" r="9" fill="none" />
      <rect className="formation-mini__line" x="24" y="85" width="32" height="14" fill="none" />
      {slots.map((d, i) => (
        <circle key={i} className={`formation-mini__dot formation-mini__dot--${POSITIONS[d.pos].line}`} cx={4 + d.x * 0.72} cy={d.y} r="5" />
      ))}
    </svg>
  );
}
