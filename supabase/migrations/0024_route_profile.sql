-- Per-leg transport profile for routing: car / bike / foot / boat.
alter table public.legs add column if not exists route_profile text;
