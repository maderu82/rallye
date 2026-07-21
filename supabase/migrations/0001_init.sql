-- ============================================================================
-- Polderpuzzel rallye — initial schema
-- ============================================================================
-- Design notes
--  * Organizers are Supabase Auth users. They own their rallies; RLS restricts
--    every organizer to their own data.
--  * Participants have NO accounts. A team is created when someone joins with a
--    rally join code and picks a team name. The shared phone stores a random
--    session token identifying the team.
--  * Answer keys live in assignments.solution and are NEVER exposed to the
--    browser. All participant reads/writes and answer grading go through the
--    Next.js server (service-role), so anon clients never touch these tables
--    directly — which keeps RLS simple and grading tamper-proof.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── rallies ────────────────────────────────────────────────────────────────
create table public.rallies (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users (id) on delete cascade,  -- null = demo template
  name        text not null,
  join_code   text not null unique,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── points (waypoints) ─────────────────────────────────────────────────────
-- position 0 is the start, the highest position is the finish.
create table public.points (
  id          uuid primary key default gen_random_uuid(),
  rally_id    uuid not null references public.rallies (id) on delete cascade,
  position    int  not null,
  kind        text not null default 'waypoint'
                check (kind in ('start', 'waypoint', 'finish')),
  name        text not null,
  lat         numeric(9,6),
  lng         numeric(9,6),
  map_x       numeric,          -- illustrative editor canvas coords
  map_y       numeric,
  has_task    boolean not null default false,
  gps_unlock  boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  unique (rally_id, position)
);
create index points_rally_idx on public.points (rally_id, position);

-- ─── assignments (one per point, optional) ──────────────────────────────────
-- The 12 building blocks. `public_config` is safe to send to the browser;
-- `solution` (answer keys) is server-only.
create table public.assignments (
  id            uuid primary key default gen_random_uuid(),
  point_id      uuid not null unique references public.points (id) on delete cascade,
  rally_id      uuid not null references public.rallies (id) on delete cascade,
  type          text not null check (type in (
                  'multiple_choice', 'open_question', 'observation',
                  'code_breaker', 'estimation', 'ordering',
                  'photo_search', 'qr_checkpoint', 'qr_search',
                  'speed_test', 'compass_point', 'free_game')),
  grading       text not null default 'auto' check (grading in ('auto', 'scale', 'manual')),
  points        int  not null default 10,
  hint_mode     text not null default 'off' check (hint_mode in ('off', 'free', 'cost')),
  hint_cost     int  not null default 5,
  hint_text     text,
  prompt        text,
  public_config jsonb not null default '{}'::jsonb,
  solution      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index assignments_rally_idx on public.assignments (rally_id);

-- ─── legs (trajectories between consecutive points) ─────────────────────────
-- Leg at `position` connects point[position] -> point[position + 1].
create table public.legs (
  id               uuid primary key default gen_random_uuid(),
  rally_id         uuid not null references public.rallies (id) on delete cascade,
  position         int  not null,
  nav_mode         text not null default 'routebook'
                     check (nav_mode in ('compass', 'routebook', 'turn', 'map')),
  bearing          numeric,
  distance         numeric,
  steps            text,
  note             text,
  enroute_enabled  boolean not null default false,
  enroute_question text,
  enroute_points   int not null default 10,
  created_at       timestamptz not null default now(),
  unique (rally_id, position)
);

-- ─── teams (participants, no accounts) ──────────────────────────────────────
create table public.teams (
  id             uuid primary key default gen_random_uuid(),
  rally_id       uuid not null references public.rallies (id) on delete cascade,
  name           text not null,
  session_token  text not null default encode(gen_random_bytes(18), 'hex'),
  current_index  int  not null default 0,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index teams_rally_idx on public.teams (rally_id);
create index teams_token_idx on public.teams (session_token);

-- ─── team_events (append-only scored actions) ───────────────────────────────
-- Running score = sum(points_delta). Hints used = count(is_hint).
-- Bought code-breaker digits are point deductions (is_hint = false) per §3.3.
create table public.team_events (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  rally_id      uuid not null references public.rallies (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  point_id      uuid references public.points (id) on delete set null,
  kind          text not null check (kind in
                  ('assignment', 'hint', 'penalty', 'digit', 'enroute', 'manual', 'badge')),
  points_delta  int  not null default 0,
  is_hint       boolean not null default false,
  needs_review  boolean not null default false,
  photo_path    text,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index team_events_team_idx on public.team_events (team_id);
create index team_events_rally_idx on public.team_events (rally_id);

-- ─── team_badges ────────────────────────────────────────────────────────────
create table public.team_badges (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null,
  icon       text not null default '🎖️',
  created_at timestamptz not null default now(),
  unique (team_id, name)
);

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Organizers manage only their own rallies (and children). Participant traffic
-- is mediated by the server (service role, which bypasses RLS), so no anon
-- policies are needed here — nothing is directly reachable by the browser
-- except an organizer's own authenticated data.
-- ============================================================================
alter table public.rallies     enable row level security;
alter table public.points      enable row level security;
alter table public.assignments enable row level security;
alter table public.legs        enable row level security;
alter table public.teams       enable row level security;
alter table public.team_events enable row level security;
alter table public.team_badges enable row level security;

-- rallies: owner-only
create policy rallies_owner_all on public.rallies
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- helper: a rally is owned by the current user
create or replace function public.owns_rally(p_rally_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rallies r
    where r.id = p_rally_id and r.owner_id = auth.uid()
  );
$$;

create policy points_owner_all on public.points
  for all using (public.owns_rally(rally_id)) with check (public.owns_rally(rally_id));

create policy assignments_owner_all on public.assignments
  for all using (public.owns_rally(rally_id)) with check (public.owns_rally(rally_id));

create policy legs_owner_all on public.legs
  for all using (public.owns_rally(rally_id)) with check (public.owns_rally(rally_id));

-- teams / events / badges: organizer of the rally may read (for live view &
-- post-rally review). Participant writes go through the service-role server.
create policy teams_owner_read on public.teams
  for select using (public.owns_rally(rally_id));

create policy team_events_owner_read on public.team_events
  for select using (public.owns_rally(rally_id));

create policy team_badges_owner_read on public.team_badges
  for select using (
    exists (select 1 from public.teams t
            where t.id = team_id and public.owns_rally(t.rally_id))
  );

-- keep updated_at fresh on rallies
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger rallies_touch before update on public.rallies
  for each row execute function public.touch_updated_at();
