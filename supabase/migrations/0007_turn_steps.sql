-- ============================================================================
-- Structured roadbook steps for bolletje-pijltje (turn) legs.
-- Each step: { dist: number(m), dir: string, note: string } — shown to teams as
-- a tulip/roadbook card with a direction arrow.
-- ============================================================================
alter table public.legs add column if not exists turn_steps jsonb not null default '[]'::jsonb;
