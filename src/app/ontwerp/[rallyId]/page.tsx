import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Assignment, Leg, Point, Team, TeamEvent } from "@/lib/types";
import EditorClient from "./EditorClient";

export const dynamic = "force-dynamic";

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
      db.from("team_events").select("*").eq("rally_id", rallyId),
    ]);

  // Aggregate live team stats (score / hints) from events.
  const agg = new Map<string, { score: number; hints: number }>();
  for (const e of (events ?? []) as TeamEvent[]) {
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
    }))
    .sort((a, b) => b.score - a.score);

  return (
    <EditorClient
      rally={rally}
      points={(points ?? []) as Point[]}
      legs={(legs ?? []) as Leg[]}
      assignments={(assignments ?? []) as Assignment[]}
      liveTeams={liveTeams}
    />
  );
}
