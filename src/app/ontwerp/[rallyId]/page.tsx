import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Assignment, Leg, Point, Team, TeamEvent } from "@/lib/types";
import EditorClient from "./EditorClient";
import { haversine } from "@/lib/geo";

export const dynamic = "force-dynamic";

export type LegSpeed = {
  from: string;
  to: string;
  kmh: number;
  limit: number;
  over: boolean;
};

export type TeamTrail = {
  path: [number, number][];
  peakKmh: number | null;
  lastAcc: number | null;
  idleMin: number | null; // minutes stationary at the current spot
  recentKmh: number | null; // pace over the last ~2 min (for ETA)
};

export type ActivityItem = {
  eventId: string;
  label: string;
  answer: string;
  points: number;
  photoUrl: string | null;
  isVideo: boolean;
  when: string;
  // true when this row is a specific graded task (assignment / en-route
  // answer) whose score the game leader may correct in the back end.
  correctable: boolean;
};

const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogg|3gp)$/i;

function answerText(detail: Record<string, unknown>): string {
  if (detail.answer != null) return String(detail.answer);
  const s = (detail.submission ?? {}) as Record<string, unknown>;
  if (s.choice != null) return `Keuze ${s.choice}`;
  if (s.text != null) return String(s.text);
  if (s.code != null) return String(s.code);
  if (s.sign != null) return `Bordje ${s.sign}`;
  if (s.value != null) return String(s.value);
  if (s.selfScore != null) return `Eigen score ${s.selfScore}`;
  if (Array.isArray(s.order)) return (s.order as unknown[]).join(", ");
  if (s.media === "video") return "🎥 filmpje ingezonden";
  if (s.photo) return "📷 foto ingezonden";
  if (s.arrived || s.scanned) return "✔️ bevestigd";
  return "";
}

export default async function EditorPage({ params }: { params: Promise<{ rallyId: string }> }) {
  const { rallyId } = await params;
  const db = await createClient();

  const { data: rally } = await db.from("rallies").select("*").eq("id", rallyId).maybeSingle();
  if (!rally) notFound();

  const [{ data: points }, { data: legs }, { data: assignments }, { data: teams }, { data: events }] =
    await Promise.all([
      db.from("points").select("*").eq("rally_id", rallyId).order("position"),
      db.from("legs").select("*").eq("rally_id", rallyId).order("position"),
      db.from("assignments").select("*").eq("rally_id", rallyId),
      db.from("teams").select("*").eq("rally_id", rallyId),
      db.from("team_events").select("*").eq("rally_id", rallyId).order("created_at"),
    ]);

  const evts = (events ?? []) as TeamEvent[];

  // Aggregate live team stats (score / hints) from events.
  const agg = new Map<string, { score: number; hints: number }>();
  for (const e of evts) {
    const cur = agg.get(e.team_id) ?? { score: 0, hints: 0 };
    cur.score += e.points_delta;
    if (e.is_hint) cur.hints += 1;
    agg.set(e.team_id, cur);
  }
  const liveTeams = ((teams ?? []) as Team[])
    .map((t) => ({
      id: t.id,
      name: t.name,
      current_index: t.current_index,
      finished: t.finished_at != null,
      score: agg.get(t.id)?.score ?? 0,
      hints: agg.get(t.id)?.hints ?? 0,
      created_at: t.created_at,
      last_lat: t.last_lat,
      last_lng: t.last_lng,
      last_gps_at: t.last_gps_at,
    }))
    .sort((a, b) => b.score - a.score);

  // Per-team activity: their answers + uploaded photos (signed URLs).
  const asgMap = new Map(((assignments ?? []) as Assignment[]).map((a) => [a.id, a]));
  const admin = createAdminClient();
  const teamActivity: Record<string, ActivityItem[]> = {};
  for (const e of evts) {
    if (!["assignment", "penalty", "enroute", "manual"].includes(e.kind)) continue;
    if ((e.detail as { seed?: boolean })?.seed) continue;
    const detail = e.detail as Record<string, unknown>;
    const a = e.assignment_id ? asgMap.get(e.assignment_id) : undefined;
    const answer = answerText(detail);
    let photoUrl: string | null = null;
    if (e.photo_path) {
      const { data } = await admin.storage.from("proof-photos").createSignedUrl(e.photo_path, 3600);
      photoUrl = data?.signedUrl ?? null;
    }
    if (!answer && !photoUrl && e.points_delta === 0) continue;
    const label = a?.prompt || (e.kind === "enroute" ? "Onderwegvraag" : e.kind === "manual" ? "Handmatig / correctie" : "Actie");
    (teamActivity[e.team_id] ??= []).push({
      eventId: e.id,
      label,
      answer,
      points: e.points_delta,
      photoUrl,
      isVideo: e.photo_path ? VIDEO_RE.test(e.photo_path) : false,
      when: new Date(e.created_at).toLocaleString("nl-NL"),
      // a specific task the leader can re-grade: a point assignment or an
      // en-route answer (not automatic penalties or manual corrections).
      correctable: !!e.assignment_id || e.kind === "enroute",
    });
  }

  // ── speed monitoring: estimated average speed per team, per leg ────────────
  // time(point) ≈ first event at that point; distance = drawn road distance
  // when available, else straight-line. Both make the estimate conservative
  // (it includes dwell time / underestimates distance), so a flag is reliable.
  const orderedPoints = ((points ?? []) as Point[]).slice().sort((a, b) => a.position - b.position);
  const legByPos = new Map(((legs ?? []) as Leg[]).map((l) => [l.position, l]));
  const rallyLimit = (rally as { speed_limit: number | null }).speed_limit;

  function legDistanceM(leg: Leg | undefined, a: Point, b: Point): number | null {
    const steps = Array.isArray(leg?.turn_steps) ? leg!.turn_steps : [];
    const road = steps.reduce((s, st) => s + (Number(st.dist) || 0), 0);
    if (road > 0) return road;
    if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
      return haversine({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    }
    return null;
  }

  // Expected length (m) of the leg leaving each point position — used by the
  // live view to judge "off course" against the real leg length, not a fixed km.
  const legExpectedM: Record<number, number> = {};
  for (let i = 0; i < orderedPoints.length - 1; i++) {
    const d = legDistanceM(legByPos.get(orderedPoints[i].position), orderedPoints[i], orderedPoints[i + 1]);
    if (d != null) legExpectedM[orderedPoints[i].position] = Math.round(d);
  }

  const teamSpeeds: Record<string, LegSpeed[]> = {};
  for (const t of (teams ?? []) as Team[]) {
    // earliest event timestamp per point for this team
    const arrival = new Map<string, number>();
    for (const e of evts) {
      if (e.team_id !== t.id || !e.point_id) continue;
      const ms = new Date(e.created_at).getTime();
      if (!arrival.has(e.point_id) || ms < arrival.get(e.point_id)!) arrival.set(e.point_id, ms);
    }
    const list: LegSpeed[] = [];
    for (let i = 0; i < orderedPoints.length - 1; i++) {
      const a = orderedPoints[i];
      const b = orderedPoints[i + 1];
      const leg = legByPos.get(a.position);
      const limit = leg?.speed_limit ?? rallyLimit;
      if (limit == null || limit <= 0) continue; // monitoring off for this leg
      const ta = arrival.get(a.id);
      const tb = arrival.get(b.id);
      if (ta == null || tb == null || tb <= ta) continue;
      const distM = legDistanceM(leg, a, b);
      if (distM == null || distM <= 0) continue;
      const kmh = (distM / ((tb - ta) / 1000)) * 3.6;
      list.push({ from: a.name, to: b.name, kmh: Math.round(kmh), limit, over: kmh > limit });
    }
    if (list.length) teamSpeeds[t.id] = list;
  }

  // Detect a database that hasn't had the latest setup.sql run yet: probing the
  // newest columns errors when they're missing, so we can warn the organizer.
  let schemaBehind = false;
  try {
    const probes = await Promise.all([
      admin.from("legs").select("photo_radius,photo_buy_cost,speed_limit,route_points,route_corridor,enroute_hint,enroute_hint_cost,route_profile").limit(1),
      admin.from("rallies").select("speed_limit,deleted_at,brand_color2,idle_limit").limit(1),
    ]);
    schemaBehind = probes.some((p) => p.error != null);
  } catch {
    schemaBehind = true;
  }

  // Breadcrumb trails + peak speed per team (safety monitoring / route replay),
  // plus stationary duration and recent pace for the live dashboard.
  const teamTrails: Record<string, TeamTrail> = {};
  const { data: positions } = await admin
    .from("team_positions")
    .select("team_id,lat,lng,speed,accuracy,created_at")
    .eq("rally_id", rallyId)
    .order("created_at")
    .limit(8000);
  type Pos = { lat: number; lng: number; speed: number | null; accuracy: number | null; t: number };
  const posByTeam: Record<string, Pos[]> = {};
  for (const p of (positions ?? []) as { team_id: string; lat: number; lng: number; speed: number | null; accuracy: number | null; created_at: string }[]) {
    (posByTeam[p.team_id] ??= []).push({ lat: p.lat, lng: p.lng, speed: p.speed, accuracy: p.accuracy, t: new Date(p.created_at).getTime() });
  }
  for (const [teamId, arr] of Object.entries(posByTeam)) {
    let peak: number | null = null;
    for (const p of arr) if (p.speed != null) { const k = p.speed * 3.6; if (peak == null || k > peak) peak = k; }
    const last = arr[arr.length - 1];
    // stationary: walk back while still within 40 m of the latest fix
    let clusterStart = last.t;
    for (let i = arr.length - 2; i >= 0; i--) {
      if (haversine({ lat: arr[i].lat, lng: arr[i].lng }, { lat: last.lat, lng: last.lng }) <= 40) clusterStart = arr[i].t;
      else break;
    }
    // recent pace over the last ~2 min from breadcrumb distance
    const cutoff = last.t - 120000;
    let dist = 0, firstIdx = arr.length - 1;
    for (let i = arr.length - 1; i > 0 && arr[i].t >= cutoff; i--) { dist += haversine({ lat: arr[i - 1].lat, lng: arr[i - 1].lng }, { lat: arr[i].lat, lng: arr[i].lng }); firstIdx = i - 1; }
    const dtSec = (last.t - arr[firstIdx].t) / 1000;
    teamTrails[teamId] = {
      path: arr.map((p) => [p.lat, p.lng] as [number, number]),
      peakKmh: peak != null ? Math.round(peak) : null,
      lastAcc: last.accuracy != null ? Math.round(last.accuracy) : null,
      idleMin: Math.round((last.t - clusterStart) / 60000),
      recentKmh: dtSec > 15 ? Math.round((dist / dtSec) * 3.6) : null,
    };
  }

  return (
    <EditorClient
      rally={rally}
      points={(points ?? []) as Point[]}
      legs={(legs ?? []) as Leg[]}
      assignments={(assignments ?? []) as Assignment[]}
      liveTeams={liveTeams}
      teamActivity={teamActivity}
      teamSpeeds={teamSpeeds}
      teamTrails={teamTrails}
      legExpected={legExpectedM}
      schemaBehind={schemaBehind}
    />
  );
}
