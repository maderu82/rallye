import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Assignment, Leg, Point, Team, TeamEvent } from "@/lib/types";
import EditorClient from "./EditorClient";

export const dynamic = "force-dynamic";

export type ActivityItem = {
  label: string;
  answer: string;
  points: number;
  photoUrl: string | null;
  isVideo: boolean;
  when: string;
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
      label,
      answer,
      points: e.points_delta,
      photoUrl,
      isVideo: e.photo_path ? VIDEO_RE.test(e.photo_path) : false,
      when: new Date(e.created_at).toLocaleString("nl-NL"),
    });
  }

  return (
    <EditorClient
      rally={rally}
      points={(points ?? []) as Point[]}
      legs={(legs ?? []) as Leg[]}
      assignments={(assignments ?? []) as Assignment[]}
      liveTeams={liveTeams}
      teamActivity={teamActivity}
    />
  );
}
