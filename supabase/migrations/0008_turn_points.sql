-- ============================================================================
-- Roadbook turn points drawn on the map for bolletje-pijltje (turn) legs.
-- Array of { lat, lng } vertices between the leg's start and end; the app
-- derives distance + direction per step from them.
-- ============================================================================
alter table public.legs add column if not exists turn_points jsonb not null default '[]'::jsonb;
