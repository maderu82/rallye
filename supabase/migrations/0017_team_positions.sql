-- Breadcrumb trail: a periodic sample of each team's position + speed, so the
-- organizer can see the route they drove and monitor speed for safety.
create table if not exists public.team_positions (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  rally_id   uuid not null references public.rallies (id) on delete cascade,
  lat        numeric(9,6) not null,
  lng        numeric(9,6) not null,
  speed      numeric,   -- m/s from the GPS (nullable when unavailable)
  accuracy   numeric,   -- m
  created_at timestamptz not null default now()
);
create index if not exists team_positions_team_idx  on public.team_positions (team_id, created_at);
create index if not exists team_positions_rally_idx on public.team_positions (rally_id, created_at);
-- Only the server (service role) touches this table; deny the anon/auth roles.
alter table public.team_positions enable row level security;
