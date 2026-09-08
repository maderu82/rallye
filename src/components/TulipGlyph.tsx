// Schematic "tulip" glyph for a roadbook step: a ball at your position with the
// incoming road (from the bottom) and the outgoing road at the turn angle —
// like a real rally book. Shared by the player app and the designer preview.

const TULIP_ANGLE: Record<string, number> = {
  straight: 0, slight_left: -35, slight_right: 35, left: -90, right: 90,
  sharp_left: -135, sharp_right: 135, uturn: 165,
};

export default function TulipGlyph({ dir, roads, take, exit, size = 52 }: { dir: string; roads?: number[]; take?: number; exit?: number; size?: number }) {
  const purple = "#534AB7", ball = "#D85A30", grey = "#B7B7C9";

  // Real junction: draw every road (grey), highlight the one to take (purple).
  if (roads && roads.length >= 2 && typeof take === "number") {
    const cx = 30, cy = 30, len = 22;
    const pt = (ang: number, l = len) => {
      const a = (ang * Math.PI) / 180;
      return [cx + l * Math.sin(a), cy - l * Math.cos(a)] as const;
    };
    const [tx, ty] = pt(take);
    const w1 = (take + 180 - 26) * Math.PI / 180, w2 = (take + 180 + 26) * Math.PI / 180;
    const wing = 8;
    return (
      <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
        {roads.map((ang, k) => {
          const [ex, ey] = pt(ang);
          const isTake = Math.abs(((ang - take + 540) % 360) - 180) < 6;
          if (isTake) return null;
          return <line key={k} x1={cx} y1={cy} x2={ex} y2={ey} stroke={grey} strokeWidth="3" strokeLinecap="round" />;
        })}
        <line x1={cx} y1={cy} x2={tx} y2={ty} stroke={purple} strokeWidth="4" strokeLinecap="round" />
        <polyline
          points={`${tx + wing * Math.sin(w1)},${ty - wing * Math.cos(w1)} ${tx},${ty} ${tx + wing * Math.sin(w2)},${ty - wing * Math.cos(w2)}`}
          fill="none" stroke={purple} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
        />
        <circle cx={cx} cy={cy} r="5" fill={ball} />
      </svg>
    );
  }

  if (dir === "roundabout") {
    // Circle at (cx,cy); enter from the bottom; leave along the real exit angle
    // (take: 0 = straight through / up, +90 = right, −90/270 = left).
    const cx = 30, cy = 26, r = 11;
    const a = (((typeof take === "number" ? take : 0) * Math.PI) / 180);
    const edge = (l: number) => [cx + l * Math.sin(a), cy - l * Math.cos(a)] as const;
    const [sx, sy] = edge(r);        // where the exit leaves the ring
    const [ex, ey] = edge(r + 11);   // arrow tip
    const wing = 5, w1 = a + Math.PI - 0.5, w2 = a + Math.PI + 0.5;
    return (
      <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
        {/* entry spoke from the bottom into the ring */}
        <line x1="30" y1="58" x2={cx} y2={cy + r} stroke={purple} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={purple} strokeWidth="3.5" />
        {/* exit spoke at the true angle, with an arrowhead */}
        <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={purple} strokeWidth="3.5" strokeLinecap="round" />
        <polyline
          points={`${ex + wing * Math.sin(w1)},${ey - wing * Math.cos(w1)} ${ex},${ey} ${ex + wing * Math.sin(w2)},${ey - wing * Math.cos(w2)}`}
          fill="none" stroke={purple} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
        />
        <circle cx={cx} cy={cy + r + 4} r="4.5" fill={ball} />
        {exit && exit > 0 ? (
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill={purple}>{exit}</text>
        ) : null}
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
