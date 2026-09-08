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

/** A roundabout hit at a turn point: which exit to take + its tulip angle. */
export interface RoundInfo {
  exit: number | null; // 1-based exit number (null = OSRM didn't say)
  take: number | null; // screen angle of the exit road (0 = straight through)
}

/** Ordinal for a roundabout exit: 1 → "1e", 2 → "2e", … */
function ordinal(n: number): string {
  return `${n}e`;
}

/** Build a Dutch routebook instruction from a direction + the road turned onto. */
export function routebookPhrase(dir: string, street: string | null, exit?: number): string {
  const road = street ? street.trim() : "";
  switch (dir) {
    case "straight": return road ? `Ga rechtdoor op de ${road}` : "Ga rechtdoor";
    case "slight_left": return road ? `Houd links aan, de ${road} op` : "Houd links aan";
    case "slight_right": return road ? `Houd rechts aan, de ${road} op` : "Houd rechts aan";
    case "left": return road ? `Sla linksaf, de ${road} in` : "Sla linksaf";
    case "right": return road ? `Sla rechtsaf, de ${road} in` : "Sla rechtsaf";
    case "sharp_left": return road ? `Scherp linksaf, de ${road} in` : "Scherp linksaf";
    case "sharp_right": return road ? `Scherp rechtsaf, de ${road} in` : "Scherp rechtsaf";
    case "uturn": return "Keer om";
    case "roundabout": {
      const nth = exit && exit > 0 ? `neem de ${ordinal(exit)} afslag` : null;
      if (nth && road) return `Op de rotonde ${nth}, de ${road} op`;
      if (nth) return `Op de rotonde ${nth}`;
      return road ? `Op de rotonde de ${road} op` : "Neem de rotonde";
    }
    case "arrive": return "Je bent op de bestemming";
    default: return road ? `Volg de ${road}` : "";
  }
}

/** Map an OSRM maneuver modifier to a roadbook direction id (null = not a turn). */
function modifierToDir(mod?: string): string | null {
  switch ((mod ?? "").toLowerCase()) {
    case "left": return "left";
    case "right": return "right";
    case "slight left": return "slight_left";
    case "slight right": return "slight_right";
    case "sharp left": return "sharp_left";
    case "sharp right": return "sharp_right";
    case "uturn": return "uturn";
    default: return null; // "straight" / unknown: no override
  }
}

/** Roadbook direction id from a tulip take-angle (0 = straight ahead, 90 = right). */
export function dirFromTakeAngle(take: number): string {
  const a = (((take % 360) + 360) % 360); // 0..360
  const s = a > 180 ? a - 360 : a; // -180..180, 0 = straight ahead
  const abs = Math.abs(s);
  if (abs <= 20) return "straight";
  if (abs >= 155) return "uturn";
  const right = s > 0;
  if (abs < 55) return right ? "slight_right" : "slight_left";
  if (abs < 120) return right ? "right" : "left";
  return right ? "sharp_right" : "sharp_left";
}

export type RouteProfile = "car" | "bike" | "foot" | "boat";
type RouteResult = { route: [number, number][]; legs: number[]; legGeoms: [number, number][][]; junctions: (Junction | null)[]; streets: (string | null)[]; roundabouts: (RoundInfo | null)[]; maneuvers: (string | null)[] };

// Straight lines between the waypoints — used for "varen" (no road/water routing
// network) and as the fallback when routing fails.
function straightRoute(waypoints: LL[]): RouteResult {
  const legsArr: number[] = [];
  const legGeoms: [number, number][][] = [];
  for (let i = 1; i < waypoints.length; i++) {
    legsArr.push(Math.round(haversine(waypoints[i - 1], waypoints[i])));
    legGeoms.push([[waypoints[i - 1].lat, waypoints[i - 1].lng], [waypoints[i].lat, waypoints[i].lng]]);
  }
  const n = Math.max(0, waypoints.length - 2);
  return {
    route: waypoints.map((w) => [w.lat, w.lng] as [number, number]),
    legs: legsArr,
    legGeoms,
    junctions: new Array(n).fill(null),
    streets: new Array(n).fill(null),
    roundabouts: new Array(n).fill(null),
    maneuvers: new Array(n).fill(null),
  };
}

export async function fetchRoadRoute(
  waypoints: LL[],
  profile: RouteProfile = "car",
): Promise<RouteResult | null> {
  if (waypoints.length < 2) return null;
  // No road/water routing network for boats — draw straight lines instead.
  if (profile === "boat") return straightRoute(waypoints);
  // The public OSRM demo only has the car profile; FOSSGIS hosts foot & bike.
  const host =
    profile === "bike" ? "https://routing.openstreetmap.de/routed-bike"
    : profile === "foot" ? "https://routing.openstreetmap.de/routed-foot"
    : "https://router.project-osrm.org";
  // Give up after 7s so a slow/overloaded public OSRM never hangs the editor;
  // callers fall back to straight lines when this returns null.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    // steps=true gives per-leg geometry so we can read the *real* road angle at
    // each turn point (much better than the straight line between clicks).
    const url = `${host}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.routes?.[0];
    if (!r) return null;
    const route = (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
    type RawInter = { location?: [number, number]; bearings?: number[]; in?: number; out?: number };
    type RawManeuver = { type?: string; modifier?: string; exit?: number; location?: [number, number]; bearing_before?: number; bearing_after?: number };
    type RawStep = { geometry?: { coordinates: [number, number][] }; intersections?: RawInter[]; name?: string; maneuver?: RawManeuver; exit?: number };
    const rawLegs = (r.legs ?? []) as { distance: number; steps?: RawStep[] }[];
    const legs = rawLegs.map((l) => Math.round(l.distance));
    const legGeoms: [number, number][][] = rawLegs.map((l) => {
      const pts: [number, number][] = [];
      for (const s of l.steps ?? []) {
        for (const [lng, lat] of s.geometry?.coordinates ?? []) pts.push([lat, lng]);
      }
      return pts;
    });

    // Collect EVERY intersection along the whole route with its real position,
    // the roads that meet there, and which road the route enters/exits by. A
    // clicked turn point rarely lands exactly on a junction node — OSRM snaps it
    // mid-road — so instead of trusting the waypoint's own snap we look along the
    // route for the actual junction nearest each turn point.
    type Node = { lat: number; lng: number; bearings: number[]; in: number; out: number };
    const nodes: Node[] = [];
    for (const l of rawLegs) {
      for (const s of l.steps ?? []) {
        for (const it of s.intersections ?? []) {
          if (!it.location || !it.bearings?.length) continue;
          if (typeof it.in !== "number" || typeof it.out !== "number") continue;
          nodes.push({ lat: it.location[1], lng: it.location[0], bearings: it.bearings, in: it.in, out: it.out });
        }
      }
    }
    // Roundabouts along the route: every roundabout/rotary maneuver with its
    // entry location and the exit number to take (OSRM puts the exit count on the
    // step, or on the maneuver in some builds). We match these to turn points so a
    // clicked point on a roundabout becomes a real "take the Nth exit" step
    // instead of an angle-guessed slight turn.
    type Round = { lat: number; lng: number; exit: number | null; take: number | null };
    const rounds: Round[] = [];
    for (const l of rawLegs) {
      for (const s of l.steps ?? []) {
        const t = s.maneuver?.type ?? "";
        if (!/roundabout|rotary/i.test(t)) continue;
        const loc = s.maneuver?.location;
        if (!loc) continue;
        const exit = typeof s.exit === "number" ? s.exit : typeof s.maneuver?.exit === "number" ? s.maneuver.exit : null;
        // OSRM gives the true entry/exit travel headings for a roundabout step;
        // take = (exit heading − entry heading), 0 = straight through, +90 = right.
        const bb = s.maneuver?.bearing_before, ba = s.maneuver?.bearing_after;
        const take = typeof bb === "number" && typeof ba === "number" ? (((ba - bb) % 360) + 360) % 360 : null;
        rounds.push({ lat: loc[1], lng: loc[0], exit, take });
      }
    }
    // Directional turn maneuvers (turn/fork/end-of-road/…) OSRM emits. We use
    // these to rescue a turn the junction geometry misreads as "straight" — e.g.
    // crossing a parallel/frontage road just before turning onto the main road,
    // where the nearest junction node is the straight crossing.
    type Turn = { lat: number; lng: number; dir: string };
    const turns: Turn[] = [];
    for (const l of rawLegs) {
      for (const s of l.steps ?? []) {
        const t = (s.maneuver?.type ?? "").toLowerCase();
        if (/roundabout|rotary|depart|arrive/.test(t)) continue;
        const dir = modifierToDir(s.maneuver?.modifier);
        const loc = s.maneuver?.location;
        if (!dir || !loc) continue;
        turns.push({ lat: loc[1], lng: loc[0], dir });
      }
    }

    // OSRM's snapped waypoint locations (used as the search anchor per turn point).
    const snapped = ((data.waypoints ?? []) as { location?: [number, number] }[]).map((w) => w.location);

    // One junction per turn point = waypoints 1..n-2 of the full [start,…,end]
    // list, plus the name of the road the route turns ONTO there (for the
    // routebook: "sla links af de <straat> in").
    const junctions: (Junction | null)[] = [];
    const streets: (string | null)[] = [];
    const roundabouts: (RoundInfo | null)[] = [];
    const maneuvers: (string | null)[] = [];
    for (let wi = 1; wi < waypoints.length - 1; wi++) {
      // the road entered after this waypoint = first step of the leg leaving it
      const nm = rawLegs[wi]?.steps?.find((s) => s.name && s.name.trim())?.name?.trim() || null;
      streets.push(nm);
      const loc = snapped[wi];
      const target: LL = loc ? { lat: loc[1], lng: loc[0] } : waypoints[wi];
      // Nearest junction within 70 m, preferring real junctions (more roads).
      let best: Node | null = null;
      let bestScore = -Infinity;
      let bestDist = Infinity;
      for (const n of nodes) {
        const d = haversine(target, { lat: n.lat, lng: n.lng });
        if (d > 70) continue;
        const score = n.bearings.length * 1000 - d; // more roads wins; then nearer
        if (score > bestScore) { bestScore = score; best = n; bestDist = d; }
      }
      // Is this turn point on a roundabout? Nearest roundabout entry within 45 m.
      // Only let it win when it's at least as close as the plain junction — a real
      // junction right at the point (e.g. a normal left turn) must not be swallowed
      // by a roundabout a bit further along the route.
      let rbBest: Round | null = null;
      let rbDist = Infinity;
      for (const r of rounds) {
        const d = haversine(target, { lat: r.lat, lng: r.lng });
        if (d <= 45 && d < rbDist) { rbDist = d; rbBest = r; }
      }
      const isRound = rbBest != null && rbDist <= bestDist + 8;
      if (isRound && rbBest) {
        // Prefer OSRM's real entry/exit headings. Fall back to the route geometry
        // around this point when the maneuver lacks bearings (heading arriving at
        // wi vs heading leaving wi). 0 = straight through, +90 = right, 270 = left.
        let take = rbBest.take;
        if (take == null) {
          const inB = bearingIntoEnd(legGeoms[wi - 1] ?? []);
          const outB = bearingFromStart(legGeoms[wi] ?? []);
          take = inB != null && outB != null ? (((outB - inB) % 360) + 360) % 360 : null;
        }
        roundabouts.push({ exit: rbBest.exit, take });
      } else {
        roundabouts.push(null);
      }
      // Nearest directional turn maneuver within 30 m of the point (for rescuing
      // a misread "straight" at a parallel-road crossing).
      let mvBest: string | null = null;
      let mvDist = Infinity;
      for (const t of turns) {
        const d = haversine(target, { lat: t.lat, lng: t.lng });
        if (d <= 30 && d < mvDist) { mvDist = d; mvBest = t.dir; }
      }
      maneuvers.push(isRound ? null : mvBest);
      if (!best || best.in < 0 || best.out < 0) { junctions.push(null); continue; }
      // Rotate so the road we came in on points down (180°); mark the exit road.
      const inB = best.bearings[best.in];
      const rot = (b: number) => Math.round((((b - inB + 180) % 360) + 360) % 360);
      junctions.push({ roads: best.bearings.map(rot), take: rot(best.bearings[best.out]) });
    }
    return { route, legs, legGeoms, junctions, streets, roundabouts, maneuvers };
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
