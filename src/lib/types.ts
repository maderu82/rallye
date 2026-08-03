import type { BlockType, Grading, HintMode, NavMode } from "./blocks";

// Row shapes mirroring the database (supabase/migrations/0001_init.sql).

export interface Rally {
  id: string;
  owner_id: string | null;
  name: string;
  join_code: string;
  published: boolean;
  speed_limit: number | null; // rally-wide default speed warning threshold (km/h)
  brand_color: string | null; // accent color (hex) for the player app
  brand_logo: string | null; // logo URL shown in the player header
  deleted_at: string | null; // soft-delete: in the trash when set
  created_at: string;
  updated_at: string;
}

export interface Point {
  id: string;
  rally_id: string;
  position: number;
  kind: "start" | "waypoint" | "finish";
  name: string;
  lat: number | null;
  lng: number | null;
  map_x: number | null;
  map_y: number | null;
  has_task: boolean;
  gps_unlock: boolean;
  unlock_radius: number;
  note: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  point_id: string;
  rally_id: string;
  type: BlockType;
  grading: Grading;
  points: number;
  hint_mode: HintMode;
  hint_cost: number;
  hint_text: string | null;
  prompt: string | null;
  public_config: Record<string, unknown>;
  solution: Record<string, unknown>; // server-only; stripped before reaching the browser
  created_at: string;
}

/** Assignment as sent to the participant — solution removed. */
export type PublicAssignment = Omit<Assignment, "solution">;

export interface Leg {
  id: string;
  rally_id: string;
  position: number;
  nav_mode: NavMode;
  bearing: number | null;
  distance: number | null;
  steps: string | null;
  note: string | null;
  enroute_enabled: boolean;
  enroute_question: string | null;
  enroute_answer: string | null; // server-only; stripped before reaching the browser
  enroute_points: number;
  enroute_hint: string | null; // optional hint for a graded en-route question
  enroute_hint_cost: number | null; // points deducted when the hint is used; null/0 = free
  turn_steps: RoadbookStep[];
  turn_points: { lat: number; lng: number }[];
  turn_route: [number, number][];
  speed_limit: number | null; // per-leg speed warning threshold (km/h); null = use rally default
  photo_radius: number | null; // foto-navigatie: arrival geofence in m; null = default 100
  photo_buy_cost: number | null; // foto-navigatie: cost to buy next photo; null = default 5
  route_points: number | null; // de harde lijn: max points for following the drawn route
  route_corridor: number | null; // de harde lijn: corridor width in m; null = default 40
  created_at: string;
}

export interface RoadbookStep {
  dist: number;
  dir: string;
  note: string;
  photo?: string; // public URL of a junction photo (foto-navigatie)
  radius?: number; // per-step arrival geofence in m (foto/cryptische route); null = leg default
  roads?: number[]; // tulip: screen angles of all roads at this junction
  take?: number; // tulip: screen angle of the road to take
  picto?: string; // roadbook (Dakar): landmark pictogram id at this point
  danger?: number; // roadbook (Dakar): warning level 0=none, 1=let op, 2=gevaar
}

export interface Team {
  id: string;
  rally_id: string;
  name: string;
  session_token: string;
  current_index: number;
  finished_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_gps_at: string | null;
  created_at: string;
}

export interface TeamEvent {
  id: string;
  team_id: string;
  rally_id: string;
  assignment_id: string | null;
  point_id: string | null;
  kind: "assignment" | "hint" | "penalty" | "digit" | "enroute" | "manual" | "badge";
  points_delta: number;
  is_hint: boolean;
  needs_review: boolean;
  photo_path: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface TeamBadge {
  id: string;
  team_id: string;
  name: string;
  icon: string;
  created_at: string;
}

/** Aggregate row for the leaderboard. */
export interface LeaderboardRow {
  team_id: string;
  name: string;
  score: number;
  hints: number;
  current_index: number;
  finished: boolean;
  me?: boolean;
}
