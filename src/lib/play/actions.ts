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
