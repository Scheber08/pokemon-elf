import { useT } from '../i18n';

interface Props {
  /** Platz je Spieltag (1-basiert), Spieltag 1 zuerst */
  places: number[];
  /** Zahl der Teams (unterster Platz) */
  teams: number;
}

const W = 600;
const H = 180;
const PAD = { left: 34, right: 12, top: 12, bottom: 26 };

/** Platzverlauf als Linie (Platz 1 oben) mit Achsen für Platz und Spieltag. */
export function PlaceChart({ places, teams }: Props) {
  const t = useT();
  if (places.length < 2 || teams < 2) return null;
  const x = (i: number) => PAD.left + (i / (places.length - 1)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + ((p - 1) / (teams - 1)) * (H - PAD.top - PAD.bottom);
  const points = places.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const best = Math.min(...places);
  const last = places[places.length - 1];
  const ticks = [1, Math.ceil(teams / 2), teams];
  return (
    <figure className="place-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t.draft.results.placeChartAria(places.length, best, last)}
      >
        {ticks.map((p) => (
          <g key={p}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} className="place-chart__grid" />
            <text x={PAD.left - 8} y={y(p) + 5} className="place-chart__label" textAnchor="end">
              {p}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 4} className="place-chart__label">
          1
        </text>
        <text x={W - PAD.right} y={H - 4} className="place-chart__label" textAnchor="end">
          {places.length}
        </text>
        <polyline points={points} className="place-chart__line" />
        <circle cx={x(places.length - 1)} cy={y(last)} r={4} className="place-chart__dot" />
      </svg>
      <figcaption className="muted small">{t.draft.results.placeChartCaption(best, last)}</figcaption>
    </figure>
  );
}
