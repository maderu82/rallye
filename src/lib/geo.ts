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
export interface Junction {
  roads: number[]; // screen angles (deg, 0 = straight ahead) of every road here
  take: number; // screen angle of the road to take
}

export async function fetchRoadRoute(
  waypoints: LL[],
): Promise<{ route: [number, number][]; legs: number[]; legGeoms: [number, number][][]; junctions: (Junction | null)[] } | null> {
  if (waypoints.length < 2) return null;
  // Give up after 7s so a slow/overloaded public OSRM never hangs the editor;
  // callers fall back to straight lines when this returns null.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    // steps=true gives per-leg geometry so we can read the *real* road angle at
    // each turn point (much better than the straight line between clicks).
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.routes?.[0];
    if (!r) return null;
    const route = (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
    type RawStep = { geometry?: { coordinates: [number, number][] }; intersections?: { bearings?: number[]; out?: number }[] };
    const rawLegs = (r.legs ?? []) as { distance: number; steps?: RawStep[] }[];
    const legs = rawLegs.map((l) => Math.round(l.distance));
    const legGeoms: [number, number][][] = rawLegs.map((l) => {
      const pts: [number, number][] = [];
      for (const s of l.steps ?? []) {
        for (const [lng, lat] of s.geometry?.coordinates ?? []) pts.push([lat, lng]);
      }
      return pts;
    });
    // Junction (tulip) per vertex after the start: all roads at that node,
    // rotated so the road you came from points down, with the taken road marked.
    const junctions: (Junction | null)[] = legGeoms.map((_, i) => {
      if (i === legGeoms.length - 1) return null; // arrive
      const inter = rawLegs[i + 1]?.steps?.[0]?.intersections?.[0];
      const inbound = bearingIntoEnd(legGeoms[i]);
      if (!inter?.bearings?.length || inbound == null) return null;
      const cameFrom = (inbound + 180) % 360;
      const roads = inter.bearings.map((b) => Math.round((b - cameFrom + 180 + 360) % 360));
      const outIdx = typeof inter.out === "number" ? inter.out : -1;
      const outB = bearingFromStart(legGeoms[i + 1]);
      const take = outIdx >= 0 && outIdx < roads.length ? roads[outIdx] : outB != null ? Math.round((outB - cameFrom + 180 + 360) % 360) : 0;
      return { roads, take };
    });
    return { route, legs, legGeoms, junctions };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Bearing of the last ~`meters` of a road-leg geometry (the approach heading). */
function bearingIntoEnd(coords: [number, number][], meters = 22): number | null {
  if (coords.length < 2) return null;
  const end = coords[coords.length - 1];
  let acc = 0;
  for (let i = coords.length - 1; i > 0; i--) {
    acc += haversine({ lat: coords[i][0], lng: coords[i][1] }, { lat: coords[i - 1][0], lng: coords[i - 1][1] });
    if (acc >= meters) return bearing({ lat: coords[i - 1][0], lng: coords[i - 1][1] }, { lat: end[0], lng: end[1] });
  }
  return bearing({ lat: coords[0][0], lng: coords[0][1] }, { lat: end[0], lng: end[1] });
}

/** Bearing of the first ~`meters` of a road-leg geometry (the departure heading). */
function bearingFromStart(coords: [number, number][], meters = 22): number | null {
  if (coords.length < 2) return null;
  const start = coords[0];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversine({ lat: coords[i - 1][0], lng: coords[i - 1][1] }, { lat: coords[i][0], lng: coords[i][1] });
    if (acc >= meters) return bearing({ lat: start[0], lng: start[1] }, { lat: coords[i][0], lng: coords[i][1] });
  }
  return bearing({ lat: start[0], lng: start[1] }, { lat: coords[coords.length - 1][0], lng: coords[coords.length - 1][1] });
}

/**
 * Suggest a roadbook direction per turn point from the actual road geometry:
 * the turn at vertex k = (heading leaving leg k) − (heading arriving leg k-1).
 * Returns one id per vertex after the start; the final one is "arrive".
 * Length equals legGeoms.length (one entry per leg).
 */
export function roadbookDirsFromGeom(legGeoms: [number, number][][]): string[] {
  const dirs: string[] = [];
  for (let i = 0; i < legGeoms.length; i++) {
    if (i === legGeoms.length - 1) {
      dirs.push("arrive");
      continue;
    }
    const inB = bearingIntoEnd(legGeoms[i]);
    const outB = bearingFromStart(legGeoms[i + 1]);
    dirs.push(inB == null || outB == null ? "straight" : classifyTurn(outB - inB));
  }
  return dirs;
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
