-- ============================================================================
-- Road-snapped geometry for a bolletje-pijltje (turn) leg, as an array of
-- [lat, lng] pairs, so the drawn route follows the actual roads.
-- ============================================================================
alter table public.legs add column if not exists turn_route jsonb not null default '[]'::jsonb;
