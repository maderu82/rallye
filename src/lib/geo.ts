// Small geo helpers shared by the roadbook composer.

export type LL = { lat: number; lng: number };

export function haversine(a: LL, b: LL): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Bearing 0..360 (0 = north) from a to b. */
export function bearing(a: LL, b: LL): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

/** Classify a turn (angle in degrees, + = right) to a roadbook direction id. */
export function classifyTurn(angle: number): string {
  const a = ((angle + 540) % 360) - 180; // normalise to [-180, 180]
  const abs = Math.abs(a);
  if (abs < 20) return "straight";
  if (abs < 45) return a > 0 ? "slight_right" : "slight_left";
  if (abs < 120) return a > 0 ? "right" : "left";
  if (abs < 160) return a > 0 ? "sharp_right" : "sharp_left";
  return "uturn";
}

export interface DerivedStep {
  dist: number;
  dir: string;
  note: string;
}

/**
 * Derive roadbook steps from an ordered path (start … turn points … end).
 * Each vertex after the start becomes a step: distance from the previous vertex
 * and the turn direction there (the final vertex = "arrive"). Notes are kept by
 * index from prevNotes where possible.
 */
export function deriveRoadbook(path: LL[], prevNotes: string[] = []): DerivedStep[] {
  const steps: DerivedStep[] = [];
  for (let i = 1; i < path.length; i++) {
    const dist = Math.round(haversine(path[i - 1], path[i]));
    let dir: string;
    if (i === path.length - 1) {
      dir = "arrive";
    } else {
      const inB = bearing(path[i - 1], path[i]);
      const outB = bearing(path[i], path[i + 1]);
      dir = classifyTurn(outB - inB);
    }
    steps.push({ dist, dir, note: prevNotes[i - 1] ?? "" });
  }
  return steps;
}
