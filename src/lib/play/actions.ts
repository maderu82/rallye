"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { grade } from "@/lib/grading";
import { haversine } from "@/lib/geo";
import type { Assignment, Team } from "@/lib/types";
import { TEAM_COOKIE, NEXT_STEP_COST } from "./constants";

// ── helpers ─────────────────────────────────────────────────────────────────
async function currentTeam(): Promise<{ team: Team; db: ReturnType<typeof createAdminClient> } | null> {
  const token = (await cookies()).get(TEAM_COOKIE)?.value;
  if (!token) return null;
  const db = createAdminClient();
  const { data: team } = await db.from("teams").select("*").eq("session_token", token).maybeSingle();
  if (!team) return null;
  return { team: team as Team, db };
}

async function scoreOf(db: ReturnType<typeof createAdminClient>, teamId: string): Promise<number> {
  const { data } = await db.from("team_events").select("points_delta").eq("team_id", teamId);
  return (data ?? []).reduce((s, e) => s + e.points_delta, 0);
}

async function isCompleted(db: ReturnType<typeof createAdminClient>, teamId: string, assignmentId: string) {
  const { data } = await db
    .from("team_events")
    .select("id,detail")
    .eq("team_id", teamId)
    .eq("assignment_id", assignmentId);
  return (data ?? []).some((e) => (e.detail as { complete?: boolean } | null)?.complete === true);
}

export interface ActionResult {
  ok: boolean;
  complete: boolean;
  feedback: string;
  score: number;
  badge?: { name: string; icon: string };
  error?: string;
}

// ── join ────────────────────────────────────────────────────────────────────
export async function joinRally(formData: FormData) {
  // Normalize exactly like updateJoinCode stores it (upper-case, no internal
  // whitespace) so a code typed with spaces/lower-case still matches. Every
  // rally code starts with RLY-, so re-apply that prefix if a player typed only
  // the part after it.
  const raw = String(formData.get("joinCode") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const joinCode = raw && !raw.startsWith("RLY-") ? `RLY-${raw.replace(/^RLY-?/, "")}` : raw;
  const teamName = String(formData.get("teamName") ?? "").trim() || "Naamloos team";
  if (!joinCode) return { error: "Vul een teamcode in." };

  const db = createAdminClient();
  // Case-insensitive match as a safety net for any legacy codes stored in a
  // different case than the current normalization.
  const { data: rally } = await db
    .from("rallies")
    .select("id,published,deleted_at")
    .ilike("join_code", joinCode)
    .maybeSingle();
  if (!rally || rally.deleted_at) return { error: `Onbekende teamcode "${joinCode}". Controleer de exacte code in de rally (Ontwerp → teamcode) en of de rally gepubliceerd is.` };
  if (!rally.published) return { error: "Deze rally is nog niet gepubliceerd. Vraag de organisator om te publiceren." };

  // Find-or-create the team by name within this rally: rejoining with the same
  // team name resumes that team; a new name starts a new team.
  const escaped = teamName.replace(/[\\%_]/g, (m) => "\\" + m);
  const { data: existing } = await db
    .from("teams")
    .select("session_token")
    .eq("rally_id", rally.id)
    .ilike("name", escaped)
    .limit(1);

  let token = existing?.[0]?.session_token;
  if (!token) {
    const { data: team, error } = await db
      .from("teams")
      .insert({ rally_id: rally.id, name: teamName })
      .select("session_token")
      .single();
    if (error || !team) {
      const hint = error?.message ? ` (${error.message})` : "";
      return { error: `Kon het team niet aanmaken. Probeer opnieuw.${hint}` };
    }
    token = team.session_token;
  }

  (await cookies()).set(TEAM_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  redirect("/speel/rally");
}

export async function leaveTeam() {
  (await cookies()).delete(TEAM_COOKIE);
  redirect("/speel");
}

/** End an organizer test session: remove the test team and go back to the editor. */
export async function endTestPlay() {
  const token = (await cookies()).get(TEAM_COOKIE)?.value;
  if (token) {
    const db = createAdminClient();
    await db.from("teams").delete().eq("session_token", token);
  }
  (await cookies()).delete(TEAM_COOKIE);
  redirect("/ontwerp");
}

// ── submit an answer ─────────────────────────────────────────────────────────
export async function submitAnswer(
  assignmentId: string,
  submission: Record<string, unknown>,
): Promise<ActionResult> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, complete: false, feedback: "", score: 0, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: assignment } = await db.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
  if (!assignment || assignment.rally_id !== team.rally_id) {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Opdracht niet gevonden." };
  }
  const a = assignment as Assignment;

  if (await isCompleted(db, team.id, assignmentId)) {
    return { ok: true, complete: true, feedback: "Deze opdracht is al voltooid.", score: await scoreOf(db, team.id) };
  }

  const result = grade(a, submission);

  if (result.delta !== 0 || result.complete) {
    await db.from("team_events").insert({
      team_id: team.id,
      rally_id: team.rally_id,
      assignment_id: a.id,
      point_id: a.point_id,
      kind: result.kind,
      points_delta: result.delta,
      needs_review: result.needsReview ?? false,
      detail: { complete: result.complete, submission },
    });
  }

  if (result.badge) {
    await db.from("team_badges").insert({ team_id: team.id, name: result.badge.name, icon: result.badge.icon }).select();
  }

  if (result.complete) {
    const { data: pt } = await db.from("points").select("position").eq("id", a.point_id).single();
    if (pt) {
      await db.from("teams").update({ current_index: Math.max(team.current_index, pt.position) }).eq("id", team.id);
    }
  }

  return { ok: result.ok, complete: result.complete, feedback: result.feedback, score: await scoreOf(db, team.id), badge: result.badge };
}

// ── video upload (direct-to-Storage via a signed URL) ────────────────────────
// Videos are too big for the 8 MB server-action limit, so the browser uploads
// straight to Storage using a short-lived signed URL, then calls submitMedia.
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v", "ogg", "3gp"]);

export async function createMediaUploadUrl(
  assignmentId: string,
  ext: string,
): Promise<{ ok: boolean; bucket?: string; path?: string; token?: string; error?: string }> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: assignment } = await db.from("assignments").select("id,rally_id").eq("id", assignmentId).maybeSingle();
  if (!assignment || assignment.rally_id !== team.rally_id) return { ok: false, error: "Opdracht niet gevonden." };

  const safeExt = VIDEO_EXTS.has(ext.toLowerCase()) ? ext.toLowerCase() : "mp4";
  const path = `${team.rally_id}/${team.id}-${assignmentId}/video-${crypto.randomUUID()}.${safeExt}`;
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Kon upload niet voorbereiden. Probeer opnieuw." };
  return { ok: true, bucket: PHOTO_BUCKET, path: data.path, token: data.token };
}

export async function submitMedia(assignmentId: string, path: string): Promise<ActionResult> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, complete: false, feedback: "", score: 0, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: assignment } = await db.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
  if (!assignment || assignment.rally_id !== team.rally_id) {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Opdracht niet gevonden." };
  }
  const a = assignment as Assignment;

  // Only accept a path this team was granted (prevents pointing at other uploads).
  if (!path.startsWith(`${team.rally_id}/${team.id}-${assignmentId}/`)) {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Ongeldige upload." };
  }

  if (await isCompleted(db, team.id, assignmentId)) {
    return { ok: true, complete: true, feedback: "Deze opdracht is al voltooid.", score: await scoreOf(db, team.id) };
  }

  const submission = { media: "video" as const };
  const result = grade(a, submission);

  await db.from("team_events").insert({
    team_id: team.id,
    rally_id: team.rally_id,
    assignment_id: a.id,
    point_id: a.point_id,
    kind: result.kind,
    points_delta: result.delta,
    needs_review: result.needsReview ?? false,
    photo_path: path,
    detail: { complete: result.complete, submission },
  });

  if (result.complete) {
    const { data: pt } = await db.from("points").select("position").eq("id", a.point_id).single();
    if (pt) await db.from("teams").update({ current_index: Math.max(team.current_index, pt.position) }).eq("id", team.id);
  }

  return { ok: result.ok, complete: result.complete, feedback: result.feedback, score: await scoreOf(db, team.id), badge: result.badge };
}

// ── submit with an (optional) proof photo ────────────────────────────────────
// Used by photo-search (required photo) and free-game (optional proof photo).
// Uploads to the private `proof-photos` bucket via the service role, then grades.
const PHOTO_BUCKET = "proof-photos";

export async function submitAnswerWithPhoto(
  assignmentId: string,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, complete: false, feedback: "", score: 0, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: assignment } = await db.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
  if (!assignment || assignment.rally_id !== team.rally_id) {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Opdracht niet gevonden." };
  }
  const a = assignment as Assignment;

  if (await isCompleted(db, team.id, assignmentId)) {
    return { ok: true, complete: true, feedback: "Deze opdracht is al voltooid.", score: await scoreOf(db, team.id) };
  }

  // parse the JSON submission payload + optional file
  let submission: Record<string, unknown> = {};
  const raw = formData.get("submission");
  if (typeof raw === "string" && raw) {
    try {
      submission = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      submission = {};
    }
  }

  let photoPath: string | null = null;
  const file = formData.get("photo");
  if (file instanceof File && file.size > 0) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stamp = `${team.id}-${assignmentId}`;
    const path = `${team.rally_id}/${stamp}/${bytesToId(bytes.byteLength)}.jpg`;
    const { error: upErr } = await db.storage
      .from(PHOTO_BUCKET)
      .upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
    if (!upErr) photoPath = path;
    submission.photo = photoPath != null;
  }

  const result = grade(a, submission);

  await db.from("team_events").insert({
    team_id: team.id,
    rally_id: team.rally_id,
    assignment_id: a.id,
    point_id: a.point_id,
    kind: result.kind,
    points_delta: result.delta,
    needs_review: result.needsReview ?? false,
    photo_path: photoPath,
    detail: { complete: result.complete, submission },
  });

  if (result.badge) {
    await db.from("team_badges").insert({ team_id: team.id, name: result.badge.name, icon: result.badge.icon }).select();
  }
  if (result.complete) {
    const { data: pt } = await db.from("points").select("position").eq("id", a.point_id).single();
    if (pt) await db.from("teams").update({ current_index: Math.max(team.current_index, pt.position) }).eq("id", team.id);
  }

  return { ok: result.ok, complete: result.complete, feedback: result.feedback, score: await scoreOf(db, team.id), badge: result.badge };
}

// deterministic-ish object id from a length + a counter is not needed; use a
// short unique-enough suffix derived from timestamp is unavailable in some
// runtimes, so derive from crypto.
function bytesToId(seedLen: number): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${seedLen}-${Math.round(seedLen * 2654435761) % 1e9}`;
  return rnd.replace(/-/g, "").slice(0, 16);
}

// ── use a hint ────────────────────────────────────────────────────────────────
export async function useHint(assignmentId: string): Promise<ActionResult & { hintText?: string }> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, complete: false, feedback: "", score: 0, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: assignment } = await db.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
  if (!assignment || assignment.rally_id !== team.rally_id) {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Opdracht niet gevonden." };
  }
  const a = assignment as Assignment;
  if (a.hint_mode === "off") {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Geen hint beschikbaar." };
  }

  const { data: existing } = await db
    .from("team_events")
    .select("id")
    .eq("team_id", team.id)
    .eq("assignment_id", assignmentId)
    .eq("kind", "hint");
  if (!existing?.length) {
    const cost = a.hint_mode === "cost" ? a.hint_cost : 0;
    await db.from("team_events").insert({
      team_id: team.id,
      rally_id: team.rally_id,
      assignment_id: a.id,
      point_id: a.point_id,
      kind: "hint",
      points_delta: -cost,
      is_hint: true,
      detail: {},
    });
  }

  return {
    ok: true,
    complete: false,
    feedback: "💡 Hint onthuld.",
    score: await scoreOf(db, team.id),
    hintText: a.hint_text ?? "",
  };
}

// ── buy a code-breaker digit (only after the hint, §3.3) ─────────────────────
export async function buyDigit(assignmentId: string): Promise<ActionResult & { revealed?: string }> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, complete: false, feedback: "", score: 0, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: assignment } = await db.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
  if (!assignment || assignment.rally_id !== team.rally_id || assignment.type !== "code_breaker") {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Niet beschikbaar." };
  }
  const a = assignment as Assignment;

  // Rule: the hint must be used before digits can be bought.
  const { data: hintEv } = await db
    .from("team_events")
    .select("id")
    .eq("team_id", team.id)
    .eq("assignment_id", assignmentId)
    .eq("kind", "hint");
  if (!hintEv?.length) {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Gebruik eerst de hint." };
  }

  const code = String((a.solution as { code?: string }).code ?? "");
  const digitCost = Number((a.solution as { digitCost?: number }).digitCost ?? 10);

  const { data: bought } = await db
    .from("team_events")
    .select("id")
    .eq("team_id", team.id)
    .eq("assignment_id", assignmentId)
    .eq("kind", "digit");
  const already = bought?.length ?? 0;
  if (already >= code.length) {
    return { ok: false, complete: false, feedback: "Alle cijfers zijn al gekocht.", score: await scoreOf(db, team.id) };
  }

  // Digits are point deductions, NOT counted as hints (§3.3).
  await db.from("team_events").insert({
    team_id: team.id,
    rally_id: team.rally_id,
    assignment_id: a.id,
    point_id: a.point_id,
    kind: "digit",
    points_delta: -digitCost,
    is_hint: false,
    detail: { index: already },
  });

  const revealed = code
    .split("")
    .map((c, i) => (i <= already ? c : "•"))
    .join(" ");
  return { ok: true, complete: false, feedback: `🔢 Cijfer ${already + 1} gekocht.`, score: await scoreOf(db, team.id), revealed };
}

// ── report the team's live GPS position (for the organizer's live view) ──────
// Updates the team's last position AND appends a breadcrumb (with speed) so the
// organizer can see the driven route and monitor speed for safety.
export async function reportPosition(
  lat: number,
  lng: number,
  speed?: number | null,
  accuracy?: number | null,
): Promise<void> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const ctx = await currentTeam();
  if (!ctx) return;
  const { team, db } = ctx;
  const spd = typeof speed === "number" && Number.isFinite(speed) && speed >= 0 ? speed : null;
  const acc = typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null;
  await Promise.all([
    db.from("teams").update({ last_lat: lat, last_lng: lng, last_gps_at: new Date().toISOString() }).eq("id", team.id),
    db.from("team_positions").insert({ team_id: team.id, rally_id: team.rally_id, lat, lng, speed: spd, accuracy: acc }),
  ]);
}

// ── buy the next photo/waypoint (foto-navigatie) for a fixed point cost ───────
export async function buyNextStep(legId: string): Promise<{ ok: boolean; score: number; error?: string }> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, score: 0, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: leg } = await db.from("legs").select("id,rally_id,photo_buy_cost").eq("id", legId).maybeSingle();
  if (!leg || leg.rally_id !== team.rally_id) return { ok: false, score: await scoreOf(db, team.id), error: "Traject niet gevonden." };

  const cost = leg.photo_buy_cost != null && leg.photo_buy_cost > 0 ? leg.photo_buy_cost : NEXT_STEP_COST;
  const score = await scoreOf(db, team.id);
  if (score < cost) {
    return { ok: false, score, error: `Niet genoeg punten om af te kopen (je hebt er ${score}, nodig: ${cost}).` };
  }

  await db.from("team_events").insert({
    team_id: team.id,
    rally_id: team.rally_id,
    point_id: null,
    assignment_id: null,
    kind: "penalty",
    points_delta: -cost,
    is_hint: false,
    detail: { boughtNextPhoto: true, leg_id: legId },
  });

  return { ok: true, score: await scoreOf(db, team.id) };
}

// ── de harde lijn: score how well the team followed the drawn route ──────────
// The organizer draws a route line; the GPS does NOT guide the team during play.
// Afterwards we score coverage: what fraction of the drawn route the team's
// breadcrumb trail passed within `route_corridor` metres of. Deviating from the
// line lowers the covered fraction. Points = round(coverage × route_points).
// Awarded once per leg.
function projectXY(ref: { lat: number; lng: number }, p: { lat: number; lng: number }): [number, number] {
  const R = 6371000;
  const x = ((p.lng - ref.lng) * Math.PI) / 180 * R * Math.cos((ref.lat * Math.PI) / 180);
  const y = ((p.lat - ref.lat) * Math.PI) / 180 * R;
  return [x, y];
}

function distToSeg(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function routeCoverage(route: [number, number][], trail: { lat: number; lng: number }[], corridor: number): number {
  if (route.length < 2 || trail.length === 0) return 0;
  const ref = { lat: route[0][0], lng: route[0][1] };
  const trailXY = trail.map((t) => projectXY(ref, t));
  const step = Math.max(10, corridor / 2);
  let total = 0, covered = 0;
  for (let i = 1; i < route.length; i++) {
    const a = { lat: route[i - 1][0], lng: route[i - 1][1] };
    const b = { lat: route[i][0], lng: route[i][1] };
    const segLen = haversine(a, b);
    const n = Math.max(1, Math.ceil(segLen / step));
    const ax = projectXY(ref, a), bx = projectXY(ref, b);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const sx: [number, number] = [ax[0] + (bx[0] - ax[0]) * t, ax[1] + (bx[1] - ax[1]) * t];
      total++;
      let best = Infinity;
      if (trailXY.length === 1) {
        best = Math.hypot(sx[0] - trailXY[0][0], sx[1] - trailXY[0][1]);
      } else {
        for (let j = 1; j < trailXY.length; j++) {
          const d = distToSeg(sx, trailXY[j - 1], trailXY[j]);
          if (d < best) best = d;
          if (best <= corridor) break;
        }
      }
      if (best <= corridor) covered++;
    }
  }
  return total > 0 ? covered / total : 0;
}

export async function scoreRoute(
  legId: string,
): Promise<{
  ok: boolean;
  coverage: number;
  awarded: number;
  maxPoints: number;
  score: number;
  already: boolean;
  route: [number, number][];
  trail: [number, number][];
  error?: string;
}> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, coverage: 0, awarded: 0, maxPoints: 0, score: 0, already: false, route: [], trail: [], error: "Geen actief team." };
  const { team, db } = ctx;

  const empty = { route: [] as [number, number][], trail: [] as [number, number][] };

  const { data: leg } = await db
    .from("legs")
    .select("id,rally_id,nav_mode,turn_route,route_points,route_corridor")
    .eq("id", legId)
    .maybeSingle();
  if (!leg || leg.rally_id !== team.rally_id) {
    return { ok: false, coverage: 0, awarded: 0, maxPoints: 0, score: await scoreOf(db, team.id), already: false, ...empty, error: "Traject niet gevonden." };
  }

  // route_points drives the score; for "de harde lijn" fall back to a sensible
  // default so a never-touched line still awards points.
  const maxPts =
    leg.route_points != null && leg.route_points > 0 ? leg.route_points : leg.nav_mode === "line" ? 20 : 0;
  const corridor = leg.route_corridor != null && leg.route_corridor > 0 ? leg.route_corridor : 40;
  const route = (leg.turn_route ?? []) as [number, number][];

  // The team's driven trail — always returned so the feedback map can show it.
  const { data: pos } = await db
    .from("team_positions")
    .select("lat,lng")
    .eq("team_id", team.id)
    .order("created_at", { ascending: true });
  const trailPts = (pos ?? []).map((p) => ({ lat: p.lat as number, lng: p.lng as number }));
  const trail = trailPts.map((p) => [p.lat, p.lng] as [number, number]);

  // award once — return the earlier result if already scored
  const { data: prev } = await db
    .from("team_events")
    .select("id,points_delta,detail")
    .eq("team_id", team.id)
    .eq("kind", "assignment");
  const done = (prev ?? []).find(
    (e) => (e.detail as { route?: boolean; leg_id?: string } | null)?.route && (e.detail as { leg_id?: string }).leg_id === legId,
  );
  if (done) {
    const cov = Number((done.detail as { coverage?: number }).coverage ?? 0);
    return { ok: true, coverage: cov, awarded: done.points_delta, maxPoints: maxPts, score: await scoreOf(db, team.id), already: true, route, trail };
  }

  if (route.length < 2) {
    return { ok: false, coverage: 0, awarded: 0, maxPoints: maxPts, score: await scoreOf(db, team.id), already: false, route, trail, error: "Deze route heeft geen lijn om te scoren." };
  }

  const coverage = routeCoverage(route, trailPts, corridor);
  const awarded = Math.round(coverage * maxPts);

  await db.from("team_events").insert({
    team_id: team.id,
    rally_id: team.rally_id,
    assignment_id: null,
    point_id: null,
    kind: "assignment",
    points_delta: awarded,
    is_hint: false,
    detail: { route: true, leg_id: legId, coverage, corridor, maxPoints: maxPts },
  });

  return { ok: true, coverage, awarded, maxPoints: maxPts, score: await scoreOf(db, team.id), already: false, route, trail };
}

// ── en-route question ─────────────────────────────────────────────────────────
// enroute_points > 0 → AUTO-graded against the stored answer.
// enroute_points = 0 → "get to know each other" question: no right/wrong.
export async function answerEnroute(
  legId: string,
  text: string,
): Promise<ActionResult> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, complete: false, feedback: "", score: 0, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: leg } = await db.from("legs").select("*").eq("id", legId).maybeSingle();
  if (!leg || leg.rally_id !== team.rally_id || !leg.enroute_enabled) {
    return { ok: false, complete: false, feedback: "", score: await scoreOf(db, team.id), error: "Vraag niet gevonden." };
  }

  // already answered?
  const { data: prev } = await db
    .from("team_events")
    .select("id,detail")
    .eq("team_id", team.id)
    .eq("kind", "enroute");
  if ((prev ?? []).some((e) => (e.detail as { leg_id?: string; complete?: boolean })?.leg_id === legId && (e.detail as { complete?: boolean })?.complete)) {
    return { ok: true, complete: true, feedback: "Al beantwoord.", score: await scoreOf(db, team.id) };
  }

  const pts = Number(leg.enroute_points ?? 0);
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  // social question (0 points): always accepted, no grading
  if (pts <= 0) {
    await db.from("team_events").insert({
      team_id: team.id,
      rally_id: team.rally_id,
      kind: "enroute",
      points_delta: 0,
      detail: { leg_id: legId, complete: true, social: true, answer: text },
    });
    return { ok: true, complete: true, feedback: "💚 Leuk — bedankt voor het delen!", score: await scoreOf(db, team.id) };
  }

  // graded question
  const correct = norm(text) === norm(leg.enroute_answer);
  if (!correct) {
    return { ok: false, complete: false, feedback: "❌ Dat is niet het juiste antwoord. Probeer opnieuw!", score: await scoreOf(db, team.id) };
  }
  await db.from("team_events").insert({
    team_id: team.id,
    rally_id: team.rally_id,
    kind: "enroute",
    points_delta: pts,
    detail: { leg_id: legId, complete: true, answer: text },
  });
  return { ok: true, complete: true, feedback: `✅ Goed! +${pts} punten.`, score: await scoreOf(db, team.id) };
}

// ── en-route question hint (optional, may cost points) ───────────────────────
export async function useEnrouteHint(
  legId: string,
): Promise<{ ok: boolean; score: number; hintText?: string; error?: string }> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false, score: 0, error: "Geen actief team." };
  const { team, db } = ctx;

  const { data: leg } = await db.from("legs").select("*").eq("id", legId).maybeSingle();
  if (!leg || leg.rally_id !== team.rally_id || !leg.enroute_enabled || !leg.enroute_hint) {
    return { ok: false, score: await scoreOf(db, team.id), error: "Geen hint beschikbaar." };
  }

  // Charge only the first time this leg's hint is used.
  const { data: prev } = await db
    .from("team_events")
    .select("id,detail")
    .eq("team_id", team.id)
    .eq("kind", "hint");
  const already = (prev ?? []).some((e) => {
    const d = e.detail as { leg_id?: string; enroute?: boolean } | null;
    return d?.enroute === true && d?.leg_id === legId;
  });
  if (!already) {
    const cost = leg.enroute_hint_cost != null && leg.enroute_hint_cost > 0 ? leg.enroute_hint_cost : 0;
    await db.from("team_events").insert({
      team_id: team.id,
      rally_id: team.rally_id,
      kind: "hint",
      points_delta: -cost,
      is_hint: true,
      detail: { leg_id: legId, enroute: true },
    });
  }

  return { ok: true, score: await scoreOf(db, team.id), hintText: String(leg.enroute_hint) };
}

// ── finish ────────────────────────────────────────────────────────────────────
export async function finishRally(): Promise<{ ok: boolean }> {
  const ctx = await currentTeam();
  if (!ctx) return { ok: false };
  const { team, db } = ctx;
  if (!team.finished_at) {
    await db.from("teams").update({ finished_at: new Date().toISOString() }).eq("id", team.id);
  }
  return { ok: true };
}
