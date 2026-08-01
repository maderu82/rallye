// Bold roadbook arrow (Dakar-style): a thick coloured arrow for the road you
// take, thinner grey lines for the other roads at the junction, and the road
// you came from as an ink stub pointing down. No ball — unlike the tulip glyph.

const ANG: Record<string, number> = {
  straight: 0, slight_left: -35, slight_right: 35, left: -90, right: 90,
  sharp_left: -135, sharp_right: 135, uturn: 165,
};

export default function RoadArrowGlyph({ dir, roads, take, size = 56 }: { dir: string; roads?: number[]; take?: number; size?: number }) {
  const takeCol = "#0F8B60", grey = "#B4BDB7", ink = "#18251F";
  const cx = 30, cy = 30, len = 23;
  const pt = (ang: number, l = len) => {
    const a = (ang * Math.PI) / 180;
    return [cx + l * Math.sin(a), cy - l * Math.cos(a)] as const;
  };
  const arrow = (ang: number, color: string, w: number) => {
    const [tx, ty] = pt(ang);
    const w1 = ((ang + 180 - 24) * Math.PI) / 180, w2 = ((ang + 180 + 24) * Math.PI) / 180;
    const wing = 9;
    return (
      <>
        <line x1={cx} y1={cy} x2={tx} y2={ty} stroke={color} strokeWidth={w} strokeLinecap="round" />
        <polyline
          points={`${tx + wing * Math.sin(w1)},${ty - wing * Math.cos(w1)} ${tx},${ty} ${tx + wing * Math.sin(w2)},${ty - wing * Math.cos(w2)}`}
          fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"
        />
      </>
    );
  };

  if (dir === "arrive") {
    return (
      <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
        <line x1="30" y1="56" x2="30" y2="24" stroke={takeCol} strokeWidth="7" strokeLinecap="round" />
        <circle cx="30" cy="17" r="10" fill="#1D9E75" />
        <path d="M25 17 h10 M30 12 v10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    );
  }

  // Real junction: draw every road; the taken one bold + coloured.
  if (roads && roads.length >= 2 && typeof take === "number") {
    return (
      <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
        {roads.map((ang, k) => {
          const isTake = Math.abs(((ang - take + 540) % 360) - 180) < 6;
          if (isTake) return null;
          const isCame = Math.abs(((ang - 180 + 540) % 360) - 180) < 8; // came-from (down)
          const [ex, ey] = pt(ang);
          return <line key={k} x1={cx} y1={cy} x2={ex} y2={ey} stroke={isCame ? ink : grey} strokeWidth={isCame ? 5 : 3.5} strokeLinecap="round" />;
        })}
        {arrow(take, takeCol, 7)}
      </svg>
    );
  }

  // Fallback: came-from stub down + a bold arrow in the chosen direction.
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden>
      <line x1="30" y1="55" x2="30" y2="30" stroke={ink} strokeWidth="5" strokeLinecap="round" />
      {arrow(ANG[dir] ?? 0, takeCol, 7)}
    </svg>
  );
}
