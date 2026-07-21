"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BlockType, HintMode, NavMode } from "@/lib/blocks";

// ============================================================================
// Designer portal mutations. All run through the RLS-enforced server client,
// so an organizer can only ever touch their own rallies.
// ============================================================================

type DB = Awaited<ReturnType<typeof createClient>>;

/** Illustrative canvas (x,y) → gps, mirroring the prototype's mapping. */
function xyToGeo(x: number, y: number) {
  return {
    lat: Number((51.9 + (420 - y) * 0.0003).toFixed(6)),
    lng: Number((4.5 + x * 0.00045).toFixed(6)),
  };
}

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

  // Seed a start, a finish and the connecting leg.
  await db.from("points").insert([
    { rally_id: rally.id, position: 0, kind: "start", name: "Start", has_task: false, gps_unlock: false, map_x: 70, map_y: 350 },
    { rally_id: rally.id, position: 1, kind: "finish", name: "Finish", has_task: false, gps_unlock: false, map_x: 480, map_y: 300 },
  ]);
  await db.from("legs").insert({ rally_id: rally.id, position: 0, nav_mode: "routebook" });

  redirect(`/ontwerp/${rally.id}`);
}

export async function renameRally(rallyId: string, name: string) {
  const db = await createClient();
  await requireUser(db);
  await db.from("rallies").update({ name }).eq("id", rallyId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function togglePublish(rallyId: string, published: boolean) {
  const db = await createClient();
  await requireUser(db);
  await db.from("rallies").update({ published }).eq("id", rallyId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function deleteRally(rallyId: string) {
  const db = await createClient();
  await requireUser(db);
  await db.from("rallies").delete().eq("id", rallyId);
  redirect("/ontwerp");
}

// ── points ───────────────────────────────────────────────────────────────────
export async function addPoint(rallyId: string, mapX: number, mapY: number) {
  const db = await createClient();
  await requireUser(db);

  const { data: points } = await db
    .from("points")
    .select("id,position,kind")
    .eq("rally_id", rallyId)
    .order("position");
  if (!points?.length) return;

  const finish = points[points.length - 1];
  const waypoints = points.slice(0, -1); // start + existing waypoints

  // Insert new waypoint + a new leg at temporary high positions, then resequence.
  const { data: np } = await db
    .from("points")
    .insert({
      rally_id: rallyId,
      position: 99990,
      kind: "waypoint",
      name: `Nieuw punt ${waypoints.length}`,
      has_task: false,
      gps_unlock: true,
      map_x: mapX,
      map_y: mapY,
      ...xyToGeo(mapX, mapY),
    })
    .select("id")
    .single();
  await db.from("legs").insert({ rally_id: rallyId, position: 99991, nav_mode: "routebook" });

  const { data: legs } = await db.from("legs").select("id,position").eq("rally_id", rallyId).order("position");

  // Desired point order: start … waypoints, NEW, finish
  const orderedPoints = [...waypoints.map((p) => p.id), np!.id, finish.id];
  await resequence(db, "points", orderedPoints);
  await resequence(db, "legs", (legs ?? []).map((l) => l.id));

  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function updatePoint(
  rallyId: string,
  pointId: string,
  fields: Partial<{ name: string; lat: number | null; lng: number | null; has_task: boolean; gps_unlock: boolean; note: string }>,
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

  const { data: point } = await db.from("points").select("position,kind").eq("id", pointId).single();
  if (!point || point.kind !== "waypoint") return;

  await db.from("points").delete().eq("id", pointId);

  // Drop the highest-position leg to keep legs = points − 1, then resequence.
  const { data: legs } = await db.from("legs").select("id,position").eq("rally_id", rallyId).order("position");
  if (legs?.length) {
    await db.from("legs").delete().eq("id", legs[legs.length - 1].id);
  }
  const { data: points } = await db.from("points").select("id").eq("rally_id", rallyId).order("position");
  const { data: legs2 } = await db.from("legs").select("id").eq("rally_id", rallyId).order("position");
  await resequence(db, "points", (points ?? []).map((p) => p.id));
  await resequence(db, "legs", (legs2 ?? []).map((l) => l.id));

  revalidatePath(`/ontwerp/${rallyId}`);
}

export async function reorderPoint(rallyId: string, pointId: string, dir: -1 | 1) {
  const db = await createClient();
  await requireUser(db);

  const { data: points } = await db.from("points").select("id,position,kind").eq("rally_id", rallyId).order("position");
  if (!points) return;
  const i = points.findIndex((p) => p.id === pointId);
  const j = i + dir;
  // start (0) and finish (last) are fixed
  if (i <= 0 || i >= points.length - 1) return;
  if (j <= 0 || j >= points.length - 1) return;

  const order = points.map((p) => p.id);
  [order[i], order[j]] = [order[j], order[i]];
  await resequence(db, "points", order);
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
  }>,
) {
  const db = await createClient();
  await requireUser(db);
  await db.from("assignments").update(fields).eq("point_id", pointId);
  revalidatePath(`/ontwerp/${rallyId}`);
}

// ── legs ──────────────────────────────────────────────────────────────────────
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
    enroute_points: number;
  }>,
) {
  const db = await createClient();
  await requireUser(db);
  await db.from("legs").update(fields).eq("id", legId);
  revalidatePath(`/ontwerp/${rallyId}`);
}
