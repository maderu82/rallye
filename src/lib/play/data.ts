import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  LeaderboardRow,
  Leg,
  Point,
  PublicAssignment,
  Team,
  TeamBadge,
  TeamEvent,
} from "@/lib/types";

// ============================================================================
// Participant data access (server-only, service role). Answer keys (solution)
// are stripped before anything is returned to a caller that renders in the
// browser.
// ============================================================================

export interface PlayState {
  team: Team;
  rally: { id: string; name: string; join_code: string };
  points: Point[];
  legs: Leg[];
  assignments: PublicAssignment[];
  events: TeamEvent[];
  badges: TeamBadge[];
  score: number;
  hintsUsed: number;
}

function stripSolution(rows: (PublicAssignment & { solution?: unknown })[]): PublicAssignment[] {
  return rows.map(({ solution: _drop, ...rest }) => rest);
}

/** Load full play state for a team identified by its session token. */
export async function getPlayState(token: string): Promise<PlayState | null> {
  const db = createAdminClient();

  const { data: team } = await db
    .from("teams")
    .select("*")
    .eq("session_token", token)
    .maybeSingle();
  if (!team) return null;

  const [{ data: rally }, { data: points }, { data: legs }, { data: assignments }, { data: events }, { data: badges }] =
    await Promise.all([
      db.from("rallies").select("id,name,join_code").eq("id", team.rally_id).single(),
      db.from("points").select("*").eq("rally_id", team.rally_id).order("position"),
      db.from("legs").select("*").eq("rally_id", team.rally_id).order("position"),
      db.from("assignments").select("*").eq("rally_id", team.rally_id),
      db.from("team_events").select("*").eq("team_id", team.id).order("created_at"),
      db.from("team_badges").select("*").eq("team_id", team.id),
    ]);

  const evts = (events ?? []) as TeamEvent[];
  const score = evts.reduce((s, e) => s + e.points_delta, 0);
  const hintsUsed = evts.filter((e) => e.is_hint).length;

  return {
    team: team as Team,
    rally: rally as PlayState["rally"],
    points: (points ?? []) as Point[],
    // strip the en-route answer key — never send it to the browser
    legs: ((legs ?? []) as Leg[]).map((l) => ({ ...l, enroute_answer: null })),
    assignments: stripSolution((assignments ?? []) as PublicAssignment[]),
    events: evts,
    badges: (badges ?? []) as TeamBadge[],
    score,
    hintsUsed,
  };
}

/** Live leaderboard for a rally: every team's score, sorted high to low. */
export async function getLeaderboard(rallyId: string, meTeamId?: string): Promise<LeaderboardRow[]> {
  const db = createAdminClient();
  const [{ data: teams }, { data: events }] = await Promise.all([
    db.from("teams").select("id,name,current_index,finished_at").eq("rally_id", rallyId),
    db.from("team_events").select("team_id,points_delta,is_hint").eq("rally_id", rallyId),
  ]);

  const agg = new Map<string, { score: number; hints: number }>();
  for (const e of events ?? []) {
    const cur = agg.get(e.team_id) ?? { score: 0, hints: 0 };
    cur.score += e.points_delta;
    if (e.is_hint) cur.hints += 1;
    agg.set(e.team_id, cur);
  }

  return (teams ?? [])
    .map((t): LeaderboardRow => {
      const a = agg.get(t.id) ?? { score: 0, hints: 0 };
      return {
        team_id: t.id,
        name: t.name,
        score: a.score,
        hints: a.hints,
        current_index: t.current_index,
        finished: t.finished_at != null,
        me: meTeamId ? t.id === meTeamId : undefined,
      };
    })
    .sort((x, y) => y.score - x.score);
}
