import type { BlockType, Grading, HintMode, NavMode } from "./blocks";

// Row shapes mirroring the database (supabase/migrations/0001_init.sql).

export interface Rally {
  id: string;
  owner_id: string | null;
  name: string;
  join_code: string;
  published: boolean;
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
  created_at: string;
}

export interface Team {
  id: string;
  rally_id: string;
  name: string;
  session_token: string;
  current_index: number;
  finished_at: string | null;
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
