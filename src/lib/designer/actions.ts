"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEAM_COOKIE } from "@/lib/play/constants";
import type { BlockType, HintMode, NavMode } from "@/lib/blocks";

// ============================================================================
// Designer portal mutations. All run through the RLS-enforced server client,
// so an organizer can only ever touch their own rallies.
// ============================================================================

type DB = Awaited<ReturnType<typeof createClient>>;

function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `RLY-${s}`;
}

async function requireUser(db: DB) {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/ontwerp/login");
  return user;
}

/** Two-phase resequence to avoid clashing the unique(rally_id, position) index. */
async function resequence(db: DB, table: "points" | "legs", orderedIds: string[]) {
  for (let k = 0; k < orderedIds.length; k++) {
    await db.from(table).update({ position: 100000 + k }).eq("id", orderedIds[k]);
  }
  for (let k = 0; k < orderedIds.length; k++) {
    await db.from(table).update({ position: k }).eq("id", orderedIds[k]);
  }
}

// ── rally-level ──────────────────────────────────────────────────────────────
export async function createRally(formData: FormData) {
  const db = await createClient();
  const user = await requireUser(db);
  const name = String(formData.get("name") ?? "").trim() || "Naamloze rally";

  const { data: rally, error } = await db
    .from("rallies")
    .insert({ owner_id: user.id, name, join_code: genCode(), published: false })
    .select("id")
    .single();
  if (error || !rally) throw new Error(error?.message ?? "Kon rally niet aanmaken");

  // Start empty: the organizer places points on the map. The first point
  // placed becomes the start, the last the finish (kinds are derived from order).
  redirect(`/ontwerp/${rally.id}`);
}

/** Point kinds are derived from order: first = start, last = finish, rest = waypoint. */
async function recomputeKinds(db: DB, rallyId: string) {
  const { data: pts } = await db.from("points").select("id").eq("rally_id", rallyId).order("position");
  const n = pts?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const kind = i === 0 ? "start" : i === n - 1 ? "finish" : "waypoint";
    await db.from("points").update({ kind }).eq("id", pts![i].id);
  }
}

export async function renameRally(rallyId: string, name: string) {
  const db = await createClient();
  await requireUser(db);
  await db.from("rallies").update({ name }).eq("id", rallyId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function updateJoinCode(rallyId: string, code: string): Promise<{ error?: string } | void> {
  const db = await createClient();
  await requireUser(db);
  const clean = code.trim().toUpperCase().replace(/\s+/g, "");
  // Every rally code starts with RLY-. Strip whatever prefix the organizer typed
  // (RLY, RLY-, or none) and re-apply exactly one, so the part after it is theirs.
  const body = clean.replace(/^RLY-?/, "");
  if (body.length < 2) return { error: "De teamcode moet minstens 2 tekens na 'RLY-' hebben." };
  if (!/^[A-Z0-9-]+$/.test(body)) return { error: "Alleen letters, cijfers en streepjes zijn toegestaan." };
  const finalCode = `RLY-${body}`;
  const { error } = await db.from("rallies").update({ join_code: finalCode }).eq("id", rallyId);
  if (error) {
    return { error: /duplicate|unique/i.test(error.message) ? "Deze teamcode is al in gebruik. Kies een andere." : error.message };
  }
  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function updateRallyBranding(
  rallyId: string,
  fields: { brand_color?: string | null; brand_logo?: string | null },
): Promise<{ error?: string } | void> {
  const db = await createClient();
  await requireUser(db);
  const { error } = await db.from("rallies").update(fields).eq("id", rallyId);
  if (error) return { error: error.message };
  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function togglePublish(rallyId: string, published: boolean) {
  const db = await createClient();
  await requireUser(db);
  await db.from("rallies").update({ published }).eq("id", rallyId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function updateRallySpeedLimit(rallyId: string, speedLimit: number | null) {
  const db = await createClient();
  await requireUser(db);
  const { error } = await db.from("rallies").update({ speed_limit: speedLimit }).eq("id", rallyId);
  if (error) throw new Error(error.message);
  revalidatePath(`/ontwerp/${rallyId}`);
}

// ── team management (organizer) ──────────────────────────────────────────────
async function requireOwner(rallyId: string) {
  const db = await createClient();
  const user = await requireUser(db);
  const { data: rally } = await db.from("rallies").select("id,owner_id").eq("id", rallyId).maybeSingle();
  if (!rally || rally.owner_id !== user.id) throw new Error("Geen toegang tot deze rally.");
}

/** Remove one team (its events/badges/scores cascade). */
export async function deleteTeam(rallyId: string, teamId: string) {
  await requireOwner(rallyId);
  const admin = createAdminClient();
  await admin.from("teams").delete().eq("id", teamId).eq("rally_id", rallyId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

/** Wipe all teams of a rally clean (fresh start). */
export async function clearTeams(rallyId: string) {
  await requireOwner(rallyId);
  const admin = createAdminClient();
  await admin.from("teams").delete().eq("rally_id", rallyId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function deleteRally(rallyId: string) {
  await requireOwner(rallyId);
  const admin = createAdminClient();
  // Delete this rally's teams first — that cascades their events, badges,
  // positions and scores — then the rally itself, which cascades its points,
  // legs and assignments. Explicit team deletion guarantees no orphaned scores
  // remain even if a cascade foreign key is missing in an older database.
  await admin.from("teams").delete().eq("rally_id", rallyId);
  await admin.from("rallies").delete().eq("id", rallyId);
  redirect("/ontwerp");
}

/** Start a test play session (organizer only) — opens the player app in test
 * mode, where the "simulate location reached" helper is available. */
export async function startTestPlay(rallyId: string, formData?: FormData) {
  const db = await createClient();
  const user = await requireUser(db);
  const { data: rally } = await db.from("rallies").select("id,owner_id").eq("id", rallyId).maybeSingle();
  if (!rally || rally.owner_id !== user.id) throw new Error("Geen toegang.");

  const fromStep = Math.max(0, Math.round(Number(formData?.get("fromStep") ?? 0)) || 0);

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("teams")
    .insert({ rally_id: rallyId, name: "🧪 Test" })
    .select("session_token")
    .single();
  if (!team) throw new Error("Kon testsessie niet starten.");

  (await cookies()).set(TEAM_COOKIE, team.session_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  redirect(`/speel/rally?test=1&from=${fromStep}`);
}

// ── points ───────────────────────────────────────────────────────────────────
export async function addPoint(rallyId: string, lat: number, lng: number) {
  const db = await createClient();
  await requireUser(db);

  const { data: points } = await db.from("points").select("id").eq("rally_id", rallyId).order("position");
  const p = points?.length ?? 0;

  // Append at the end; the newest point becomes the finish, the first stays the
  // start. This matches placing points in walking order. Only the previous
  // finish (if any) needs its kind updated → no full recompute.
  await db.from("points").insert({
    rally_id: rallyId,
    position: p,
    kind: p === 0 ? "start" : "finish",
    name: p === 0 ? "Start" : `Punt ${p}`,
    has_task: false,
    gps_unlock: p !== 0,
    lat,
    lng,
  });
  if (p >= 1) {
    await db.from("legs").insert({ rally_id: rallyId, position: p - 1, nav_mode: "routebook" });
  }
  if (p >= 2) {
    // the point that used to be the finish becomes a regular waypoint
    await db.from("points").update({ kind: "waypoint" }).eq("id", points![p - 1].id);
  }
  revalidatePath(`/ontwerp/${rallyId}`);
}

/** Replace the whole route with points parsed from a GPX file (append legs). */
export async function importGpx(rallyId: string, coords: { name: string; lat: number; lng: number }[]) {
  const db = await createClient();
  await requireUser(db);
  const { data: rally } = await db.from("rallies").select("id").eq("id", rallyId).maybeSingle();
  if (!rally) throw new Error("Geen toegang.");
  if (!coords.length) return;

  // wipe existing route (assignments cascade via point fk)
  await db.from("legs").delete().eq("rally_id", rallyId);
  await db.from("points").delete().eq("rally_id", rallyId);

  const rows = coords.slice(0, 200).map((c, i) => ({
    rally_id: rallyId,
    position: i,
    kind: i === 0 ? "start" : i === coords.length - 1 ? "finish" : "waypoint",
    name: c.name || (i === 0 ? "Start" : `Punt ${i}`),
    has_task: false,
    gps_unlock: i !== 0,
    lat: c.lat,
    lng: c.lng,
  }));
  await db.from("points").insert(rows);

  const legRows = [];
  for (let i = 0; i < rows.length - 1; i++) {
    legRows.push({ rally_id: rallyId, position: i, nav_mode: "routebook" as const });
  }
  if (legRows.length) await db.from("legs").insert(legRows);

  await recomputeKinds(db, rallyId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function updatePoint(
  rallyId: string,
  pointId: string,
  fields: Partial<{ name: string; lat: number | null; lng: number | null; has_task: boolean; gps_unlock: boolean; unlock_radius: number; note: string }>,
) {
  const db = await createClient();
  await requireUser(db);
  await db.from("points").update(fields).eq("id", pointId);

  // Keep an assignment row in sync with the has_task toggle.
  if (fields.has_task === true) {
    const { data: existing } = await db.from("assignments").select("id").eq("point_id", pointId).maybeSingle();
    if (!existing) {
      await db.from("assignments").insert({
        point_id: pointId,
        rally_id: rallyId,
        type: "multiple_choice",
        grading: "auto",
        points: 10,
        hint_mode: "off",
      });
    }
  } else if (fields.has_task === false) {
    await db.from("assignments").delete().eq("point_id", pointId);
  }

  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function deletePoint(rallyId: string, pointId: string) {
  const db = await createClient();
  await requireUser(db);

  const { error } = await db.from("points").delete().eq("id", pointId);
  if (error) throw new Error(error.message);

  // Keep legs = points − 1 and positions contiguous. Wrapped so a hiccup here
  // never hides the fact that the point itself was deleted.
  try {
    const { data: legs } = await db.from("legs").select("id,position").eq("rally_id", rallyId).order("position");
    if (legs?.length) {
      await db.from("legs").delete().eq("id", legs[legs.length - 1].id);
    }
    const { data: points } = await db.from("points").select("id").eq("rally_id", rallyId).order("position");
    const { data: legs2 } = await db.from("legs").select("id").eq("rally_id", rallyId).order("position");
    await resequence(db, "points", (points ?? []).map((p) => p.id));
    await resequence(db, "legs", (legs2 ?? []).map((l) => l.id));
    await recomputeKinds(db, rallyId);
  } catch {
    // ignore — the point is deleted; ordering will self-heal on the next change
  }

  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function reorderPoint(rallyId: string, pointId: string, dir: -1 | 1) {
  const db = await createClient();
  await requireUser(db);

  const { data: points } = await db.from("points").select("id,position").eq("rally_id", rallyId).order("position");
  if (!points) return;
  const n = points.length;
  const i = points.findIndex((p) => p.id === pointId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= n) return;

  // Fast adjacent swap: only 3 updates (temp to dodge the unique constraint),
  // and set the two moved points' kinds inline based on their new position.
  const kindFor = (pos: number) => (pos === 0 ? "start" : pos === n - 1 ? "finish" : "waypoint");
  const A = points[i], B = points[j];
  await db.from("points").update({ position: -1 }).eq("id", A.id);
  await db.from("points").update({ position: A.position, kind: kindFor(A.position) }).eq("id", B.id);
  await db.from("points").update({ position: B.position, kind: kindFor(B.position) }).eq("id", A.id);

  revalidatePath(`/ontwerp/${rallyId}`);
}

/** Move a point directly to a given 0-based index (type the order number). */
export async function movePointTo(rallyId: string, pointId: string, targetIndex: number) {
  const db = await createClient();
  await requireUser(db);
  const { data: points } = await db.from("points").select("id").eq("rally_id", rallyId).order("position");
  if (!points) return;
  const n = points.length;
  const i = points.findIndex((p) => p.id === pointId);
  if (i < 0) return;
  const t = Math.max(0, Math.min(n - 1, Math.round(targetIndex)));
  if (t === i) return;

  const order = points.map((p) => p.id);
  order.splice(i, 1);
  order.splice(t, 0, pointId);
  await resequence(db, "points", order);
  await recomputeKinds(db, rallyId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

// ── assignments ──────────────────────────────────────────────────────────────
export async function updateAssignment(
  rallyId: string,
  pointId: string,
  fields: Partial<{
    type: BlockType;
    points: number;
    hint_mode: HintMode;
    hint_cost: number;
    hint_text: string;
    prompt: string;
    grading: "auto" | "scale" | "manual";
    public_config: Record<string, unknown>;
    solution: Record<string, unknown>;
  }>,
) {
  const db = await createClient();
  await requireUser(db);
  const { error } = await db.from("assignments").update(fields).eq("point_id", pointId);
  // Return (don't throw) so the real DB message reaches the client — thrown
  // server-action errors are masked in production builds.
  if (error) return { error: error.message };
  revalidatePath(`/ontwerp/${rallyId}`);
}

// ── legs ──────────────────────────────────────────────────────────────────────
/** Create a missing leg (traject) at a given position, e.g. the stretch into
 *  the finish when a rally ended up with fewer legs than gaps. */
export async function addLeg(rallyId: string, position: number) {
  const db = await createClient();
  await requireUser(db);
  const { error } = await db.from("legs").insert({ rally_id: rallyId, position, nav_mode: "routebook" });
  if (error) throw new Error(error.message);
  revalidatePath(`/ontwerp/${rallyId}`);
}

// ── post-rally review (photos & manual scores) ──────────────────────────────
/**
 * Set the final awarded points for a reviewed submission. Records an append-only
 * correction event (kind 'manual') for the difference and clears the review
 * flag, so team totals and team_scores stay consistent.
 */
export async function reviewSubmission(rallyId: string, eventId: string, finalPoints: number) {
  const db = await createClient();
  const user = await requireUser(db);

  // ownership check via RLS-enforced read
  const { data: rally } = await db.from("rallies").select("id,owner_id").eq("id", rallyId).maybeSingle();
  if (!rally || rally.owner_id !== user.id) throw new Error("Geen toegang tot deze rally.");

  const admin = createAdminClient();
  const { data: ev } = await admin
    .from("team_events")
    .select("id,team_id,rally_id,points_delta")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev || ev.rally_id !== rallyId) throw new Error("Inzending niet gevonden.");

  const delta = Math.round(finalPoints) - ev.points_delta;
  if (delta !== 0) {
    await admin.from("team_events").insert({
      team_id: ev.team_id,
      rally_id: rallyId,
      kind: "manual",
      points_delta: delta,
      detail: { review: true, of: eventId },
    });
  }
  await admin.from("team_events").update({ needs_review: false }).eq("id", eventId);

  revalidatePath(`/ontwerp/${rallyId}/review`);
}

export async function updateLeg(
  rallyId: string,
  legId: string,
  fields: Partial<{
    nav_mode: NavMode;
    bearing: number | null;
    distance: number | null;
    steps: string;
    note: string;
    enroute_enabled: boolean;
    enroute_question: string;
    enroute_answer: string;
    enroute_points: number;
    turn_steps: { dist: number; dir: string; note: string; photo?: string; radius?: number; roads?: number[]; take?: number }[];
    turn_points: { lat: number; lng: number }[];
    turn_route: [number, number][];
    speed_limit: number | null;
    photo_radius: number | null;
    photo_buy_cost: number | null;
    route_points: number | null;
    route_corridor: number | null;
  }>,
) {
  const db = await createClient();
  await requireUser(db);
  const { error } = await db.from("legs").update(fields).eq("id", legId);
  if (error) return { error: error.message };
  revalidatePath(`/ontwerp/${rallyId}`);
}

// Signed upload URL for a junction photo (foto-navigatie), stored in the public
// `route-photos` bucket. Only the rally owner may request one.
export async function createRoutePhotoUpload(
  rallyId: string,
): Promise<{ ok: boolean; bucket?: string; path?: string; token?: string; publicUrl?: string; error?: string }> {
  const db = await createClient();
  const user = await requireUser(db);
  const { data: rally } = await db.from("rallies").select("owner_id").eq("id", rallyId).maybeSingle();
  if (!rally || rally.owner_id !== user.id) return { ok: false, error: "Geen toegang tot deze rally." };

  const admin = createAdminClient();
  const bucket = "route-photos";
  const path = `${rallyId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Kon upload niet voorbereiden." };
  const publicUrl = admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  return { ok: true, bucket, path: data.path, token: data.token, publicUrl };
}
