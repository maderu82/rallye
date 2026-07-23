"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { grade } from "@/lib/grading";
import type { Assignment, Team } from "@/lib/types";
import { TEAM_COOKIE } from "./constants";

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
  const joinCode = String(formData.get("joinCode") ?? "").trim().toUpperCase();
  const teamName = String(formData.get("teamName") ?? "").trim() || "Naamloos team";
  if (!joinCode) return { error: "Vul een teamcode in." };

  const db = createAdminClient();
  const { data: rally } = await db
    .from("rallies")
    .select("id,published")
    .eq("join_code", joinCode)
    .eq("published", true)
    .maybeSingle();
  if (!rally) return { error: "Onbekende of gesloten teamcode." };

  const { data: team, error } = await db
    .from("teams")
    .insert({ rally_id: rally.id, name: teamName })
    .select("session_token")
    .single();
  if (error || !team) return { error: "Kon het team niet aanmaken. Probeer opnieuw." };

  (await cookies()).set(TEAM_COOKIE, team.session_token, {
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
