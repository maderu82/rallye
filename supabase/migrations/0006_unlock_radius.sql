-- ============================================================================
-- Per-point unlock radius (metres). When a team gets within this distance of a
-- point, its assignment auto-unlocks (continuous GPS) — like arriving at a
-- roadbook waypoint. Default 50 m; widen it for car rallies.
-- ============================================================================
alter table public.points add column if not exists unlock_radius int not null default 50;
