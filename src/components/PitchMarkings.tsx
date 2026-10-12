/**
 * Spielfeld als SVG (hochkant, eigenes Tor unten): gestreifter Rasen und weiße Linien –
 * Mittellinie, Mittelkreis, Strafräume, Torräume, Elfmeterpunkte, Teilkreise, Eckviertel.
 * viewBox 680 × 952 ≈ Seitenverhältnis 1 : 1,4.
 */
export const PITCH_W = 680;
export const PITCH_H = 952;

const STRIPES = 14;

export function PitchMarkings() {
  const stripeH = PITCH_H / STRIPES;
  return (
    <svg
      className="pitch__svg"
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: STRIPES }, (_, i) => (
        <rect key={i} x={0} y={i * stripeH} width={PITCH_W} height={stripeH + 0.5} fill={i % 2 ? '#2e7d32' : '#388e3c'} />
      ))}
      <g fill="none" stroke="#ffffff" strokeOpacity={0.88} strokeWidth={3}>
        {/* Außenlinien & Mittellinie */}
        <rect x={20} y={20} width={640} height={912} />
        <line x1={20} y1={476} x2={660} y2={476} />
        <circle cx={340} cy={476} r={82} />
        {/* Strafräume */}
        <rect x={150.3} y={20} width={379.4} height={143.3} />
        <rect x={150.3} y={788.7} width={379.4} height={143.3} />
        {/* Torräume */}
        <rect x={253.8} y={20} width={172.4} height={47.8} />
        <rect x={253.8} y={884.2} width={172.4} height={47.8} />
        {/* Teilkreise */}
        <path d="M 273.4 163.3 A 82 82 0 0 0 406.6 163.3" />
        <path d="M 273.4 788.7 A 82 82 0 0 1 406.6 788.7" />
        {/* Eckviertel */}
        <path d="M 29 20 A 9 9 0 0 1 20 29" />
        <path d="M 651 20 A 9 9 0 0 0 660 29" />
        <path d="M 20 923 A 9 9 0 0 1 29 932" />
        <path d="M 660 923 A 9 9 0 0 0 651 932" />
      </g>
      <g fill="#ffffff" fillOpacity={0.9}>
        <circle cx={340} cy={476} r={4.5} />
        <circle cx={340} cy={115.5} r={4} />
        <circle cx={340} cy={836.5} r={4} />
      </g>
      {/* Tore – das eigene Tor unten etwas betont */}
      <rect x={305.5} y={7} width={69} height={13} fill="rgba(255,255,255,0.18)" stroke="#fff" strokeWidth={2.5} />
      <rect x={300} y={932} width={80} height={16} fill="rgba(255,255,255,0.28)" stroke="#fff" strokeWidth={3} />
      <g stroke="rgba(255,255,255,0.45)" strokeWidth={1}>
        {[310, 320, 330, 340, 350, 360, 370].map((x) => (
          <line key={x} x1={x} y1={933} x2={x} y2={947} />
        ))}
        <line x1={301} y1={940} x2={379} y2={940} />
      </g>
    </svg>
  );
}
