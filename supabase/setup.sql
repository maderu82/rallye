-- ============================================================================
-- Polderpuzzel rallye — COMPLETE SETUP (run once in a fresh Supabase project)
-- Paste this whole file into the Supabase SQL Editor and press Run.
-- It runs all migrations in order: schema+RLS, demo rally, realtime, storage.
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0001_init.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0002_demo_seed.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Demo seed — the fixed "Polderpuzzel rallye" scenario (spec §4).
-- Idempotent: does nothing if a rally with join code RLY-7H2K already exists.
-- Safe to skip in a real production database (drop this migration file).
-- ============================================================================
do $$
declare
  v_rally uuid;
  p_s uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p_f uuid;
  a1 uuid; a4 uuid; a5 uuid;
  t_turbo uuid; t_route uuid; t_km uuid;
begin
  if exists (select 1 from public.rallies where join_code = 'RLY-7H2K') then
    return;
  end if;

  insert into public.rallies (owner_id, name, join_code, published)
    values (null, 'Polderpuzzel rallye', 'RLY-7H2K', true)
    returning id into v_rally;

  -- ── points ────────────────────────────────────────────────────────────────
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 0, 'start', 'Start — dorpsplein', 51.921000, 4.531500, 70, 350, false, false,
            'Aanmelden met teamcode RLY-7H2K + teamnaam, geen account.')
    returning id into p_s;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 1, 'waypoint', 'De oude sluis', 51.951000, 4.567500, 150, 250, true, true)
    returning id into p1;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 2, 'waypoint', 'Fotopunt molen', 51.969000, 4.605750, 235, 190, true, true)
    returning id into p2;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 3, 'waypoint', 'Dijktraject', 51.963000, 4.648500, 330, 210, true, true)
    returning id into p3;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 4, 'waypoint', 'Vaar naar de overkant', 51.990000, 4.680000, 400, 120, true, true)
    returning id into p4;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 5, 'waypoint', 'De geheime code', 51.975000, 4.711500, 470, 170, true, true,
            'Na de hint kan het team cijfers van de code kopen: −10 punten per cijfer.')
    returning id into p5;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 6, 'waypoint', 'Café De Molen', 51.948000, 4.716000, 480, 260, true, true,
            'Organisator kan score en bewijsfoto na afloop controleren.')
    returning id into p6;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 7, 'finish', 'Finish — café De Molen', 51.936000, 4.716000, 480, 300, false, false,
            'Eindscherm: klassement, eigen statistieken en badges.')
    returning id into p_f;

  -- ── assignments ───────────────────────────────────────────────────────────
  -- WP1: multiple choice (AUTO)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p1, v_rally, 'multiple_choice', 'auto', 20, 'cost', 5,
            'Tel de klinknagels niet — kijk op de gedenksteen naast de sluisdeur.',
            'In welk jaar is deze sluis gebouwd?',
            '{"options":[{"id":"A","label":"1872"},{"id":"B","label":"1894"},{"id":"C","label":"1901"}]}'::jsonb,
            '{"correct":"B"}'::jsonb)
    returning id into a1;

  -- WP2: photo search (AUTO on submission, organizer reviews after)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p2, v_rally, 'photo_search', 'auto', 15, 'off',
            'Vind het bord met de molenaarsnaam en fotografeer het.',
            '{"review":true}'::jsonb);

  -- WP3: average-speed test (SCALE)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p3, v_rally, 'speed_test', 'scale', 25, 'off',
            'Doel: gemiddeld 38 km/u over het traject.',
            '{"target":38,"maxPoints":25,"penaltyPerKmh":3,"min":20,"max":56}'::jsonb);

  -- WP4: QR search (AUTO) — bearing/distance shown by the leg (compass)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p4, v_rally, 'qr_search', 'auto', 30, 'cost', 5,
            'Het echte bordje hangt aan de paal mét het reddingsboei-symbool.',
            'Er hangen drie bordjes bij de overkant. Slechts één is de echte — scan het juiste!',
            '{"signs":["A","B","C"]}'::jsonb,
            '{"correct":"A","wrongPenalty":5,"retry":true}'::jsonb)
    returning id into a4;

  -- WP5: code breaker (AUTO) with two-step help (hint, then buy digits)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p5, v_rally, 'code_breaker', 'auto', 25, 'cost', 5,
            'Denk terug aan waypoint 1: in welk jaar werd de sluis gebouwd?',
            'Er staat een kistje met een 4-cijferig slot. Kraak de code!',
            '{"digits":4,"digitCost":10,"riddle":"Het antwoord ligt achter je — bij het begin van jullie tocht langs het water."}'::jsonb,
            '{"code":"1894","digitCost":10}'::jsonb)
    returning id into a5;

  -- WP6: free game moment (MANUAL)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p6, v_rally, 'free_game', 'manual', 15, 'off',
            'Spijkerpoepen — 2 minuten!',
            '{"perUnit":1,"max":15,"unitLabel":"spijker","review":true}'::jsonb);

  -- ── legs ──────────────────────────────────────────────────────────────────
  insert into public.legs (rally_id, position, nav_mode, steps) values
    (v_rally, 0, 'routebook',
     E'Verlaat het dorpsplein via de Kerkstraat.\nGa bij de bakker rechtsaf.\nVolg het water tot de oude sluis.'),
    (v_rally, 1, 'routebook',
     E'Steek de sluisbrug over.\nVolg het fietspad langs de vaart.\nNa 400 m staat de molen links.');

  insert into public.legs (rally_id, position, nav_mode, steps, enroute_enabled, enroute_question, enroute_points)
    values (v_rally, 2, 'turn',
     E'Na 150 m rechts de dijk op.\nNa 800 m flauwe bocht links aanhouden.\nNa 1,4 km stoppen bij het pontje.',
     true, 'Hoeveel wieken heeft de molen die je passeert?', 10);

  insert into public.legs (rally_id, position, nav_mode, bearing, distance) values
    (v_rally, 3, 'compass', 214, 350),
    (v_rally, 4, 'compass', 78, 120);

  insert into public.legs (rally_id, position, nav_mode, note) values
    (v_rally, 5, 'map', 'Volg de route op de kaart naar café De Molen.'),
    (v_rally, 6, 'map', 'De finish is binnen in het café — meld je bij de spelleider.');

  -- ── demo teams (for the leaderboard & live-view demo) ──────────────────────
  insert into public.teams (rally_id, name, current_index) values
    (v_rally, 'Team Turbo', 6) returning id into t_turbo;
  insert into public.teams (rally_id, name, current_index) values
    (v_rally, 'De Routeplanners', 5) returning id into t_route;
  insert into public.teams (rally_id, name, current_index) values
    (v_rally, 'Kilometervreters', 3) returning id into t_km;

  insert into public.team_events (team_id, rally_id, kind, points_delta, detail) values
    (t_turbo, v_rally, 'manual', 312, '{"seed":true}'::jsonb),
    (t_route, v_rally, 'manual', 287, '{"seed":true}'::jsonb),
    (t_km,    v_rally, 'manual', 221, '{"seed":true}'::jsonb);
end $$;

-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0003_realtime_scores.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Realtime-friendly leaderboard.
--
-- team_events stays the append-only source of truth (and holds answer
-- submissions in `detail`, which must NOT be exposed to participants). This
-- migration adds a denormalized, secret-free `team_scores` table maintained by
-- triggers, readable by anon for PUBLISHED rallies, and published to Supabase
-- Realtime so the leaderboard and live tracking update instantly.
-- ============================================================================

create table public.team_scores (
  team_id       uuid primary key references public.teams (id) on delete cascade,
  rally_id      uuid not null references public.rallies (id) on delete cascade,
  name          text not null,
  score         int  not null default 0,
  hints         int  not null default 0,
  current_index int  not null default 0,
  finished      boolean not null default false,
  updated_at    timestamptz not null default now()
);
create index team_scores_rally_idx on public.team_scores (rally_id);

-- backfill from existing data
insert into public.team_scores (team_id, rally_id, name, score, hints, current_index, finished)
select t.id, t.rally_id, t.name,
       coalesce(sum(e.points_delta), 0),
       coalesce(sum(case when e.is_hint then 1 else 0 end), 0),
       t.current_index, t.finished_at is not null
from public.teams t
left join public.team_events e on e.team_id = t.id
group by t.id;

-- ── triggers keep team_scores in sync ────────────────────────────────────────
create or replace function public.ts_on_team_ins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_scores (team_id, rally_id, name, current_index, finished)
  values (new.id, new.rally_id, new.name, new.current_index, new.finished_at is not null)
  on conflict (team_id) do nothing;
  return new;
end $$;
create trigger team_ins after insert on public.teams
  for each row execute function public.ts_on_team_ins();

create or replace function public.ts_on_team_upd()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_scores
     set name = new.name,
         current_index = new.current_index,
         finished = new.finished_at is not null,
         updated_at = now()
   where team_id = new.id;
  return new;
end $$;
create trigger team_upd after update on public.teams
  for each row execute function public.ts_on_team_upd();

create or replace function public.ts_on_event_ins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_scores
     set score = score + new.points_delta,
         hints = hints + (case when new.is_hint then 1 else 0 end),
         updated_at = now()
   where team_id = new.team_id;
  return new;
end $$;
create trigger event_ins after insert on public.team_events
  for each row execute function public.ts_on_event_ins();

-- ── RLS: readable for published rallies (anon) or by the owner ───────────────
alter table public.team_scores enable row level security;
create policy team_scores_read on public.team_scores
  for select using (
    exists (
      select 1 from public.rallies r
      where r.id = rally_id and (r.published or r.owner_id = auth.uid())
    )
  );

-- ── publish to Supabase Realtime ─────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_scores'
  ) then
    alter publication supabase_realtime add table public.team_scores;
  end if;
exception when undefined_object then
  -- publication doesn't exist in this environment; skip.
  null;
end $$;

-- >>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0004_storage.sql <<<<<<<<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Private Storage bucket for proof photos (photo-search + free-game).
--
-- The bucket is private. All uploads and reads go through the Next.js server
-- (service role), which bypasses Storage RLS, so no object-level policies are
-- required and participants never get direct bucket access. Organizers view
-- photos in the review screen via short-lived signed URLs minted server-side.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('proof-photos', 'proof-photos', false)
on conflict (id) do nothing;
