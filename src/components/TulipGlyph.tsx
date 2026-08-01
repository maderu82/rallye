// Schematic "tulip" glyph for a roadbook step: a ball at your position with the
// incoming road (from the bottom) and the outgoing road at the turn angle —
// like a real rally book. Shared by the player app and the designer preview.

const TULIP_ANGLE: Record<string, number> = {
  straight: 0, slight_left: -35, slight_right: 35, left: -90, right: 90,
  sharp_left: -135, sharp_right: 135, uturn: 165,
};

export default function TulipGlyph({ dir, size = 52 }: { dir: string; size?: number }) {
  const purple = "#534AB7", ball = "#D85A30";
  if (dir === "roundabout") {
    return (
      <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
        <line x1="30" y1="58" x2="30" y2="42" stroke={purple} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="30" cy="27" r="12" fill="none" stroke={purple} strokeWidth="3.5" />
        <path d="M42 22 l6 -3 l-2 7 z" fill={purple} />
        <circle cx="30" cy="42" r="5" fill={ball} />
      </svg>
    );
  }
  if (dir === "arrive") {
    return (
      <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
        <line x1="30" y1="58" x2="30" y2="28" stroke={purple} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="30" cy="21" r="10" fill="#1D9E75" />
        <path d="M25 21 h10 M30 16 v10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  const a = ((TULIP_ANGLE[dir] ?? 0) * Math.PI) / 180;
  const cx = 30, cy = 33, len = 22;
  const ex = cx + len * Math.sin(a), ey = cy - len * Math.cos(a);
  const wing = 8;
  const w1 = a + Math.PI - 0.45, w2 = a + Math.PI + 0.45;
  const p1x = ex + wing * Math.sin(w1), p1y = ey - wing * Math.cos(w1);
  const p2x = ex + wing * Math.sin(w2), p2y = ey - wing * Math.cos(w2);
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
      <line x1="30" y1="58" x2={cx} y2={cy} stroke={purple} strokeWidth="3.5" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={purple} strokeWidth="3.5" strokeLinecap="round" />
      <polyline points={`${p1x},${p1y} ${ex},${ey} ${p2x},${p2y}`} fill="none" stroke={purple} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={cx} cy={cy} r="5" fill={ball} />
    </svg>
  );
}
