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

/**
 * Snap a set of waypoints to the road network via the public OSRM server.
 * Returns the road geometry (as [lat,lng] pairs) and the per-leg road distance.
 * Returns null on any failure — callers fall back to straight lines.
 */
export async function fetchRoadRoute(
  waypoints: LL[],
): Promise<{ route: [number, number][]; legs: number[] } | null> {
  if (waypoints.length < 2) return null;
  try {
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.routes?.[0];
    if (!r) return null;
    const route = (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
    const legs = (r.legs as { distance: number }[]).map((l) => Math.round(l.distance));
    return { route, legs };
  } catch {
    return null;
  }
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
export function deriveRoadbook(path: LL[], prevNotes: string[] = [], legDistances?: number[]): DerivedStep[] {
  const steps: DerivedStep[] = [];
  for (let i = 1; i < path.length; i++) {
    const dist = legDistances?.[i - 1] != null ? Math.round(legDistances[i - 1]) : Math.round(haversine(path[i - 1], path[i]));
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
