-- ============================================================================
-- Polderpuzzel rallye — COMPLETE, RE-RUNNABLE SETUP
-- Paste this whole file into the Supabase SQL Editor and press Run.
-- Safe to run multiple times: it creates whatever is missing and skips what
-- already exists (no "already exists" errors).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── rallies ────────────────────────────────────────────────────────────────
create table if not exists public.rallies (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users (id) on delete cascade,
  name        text not null,
  join_code   text not null unique,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── points ─────────────────────────────────────────────────────────────────
create table if not exists public.points (
  id          uuid primary key default gen_random_uuid(),
  rally_id    uuid not null references public.rallies (id) on delete cascade,
  position    int  not null,
  kind        text not null default 'waypoint' check (kind in ('start','waypoint','finish')),
  name        text not null,
  lat         numeric(9,6),
  lng         numeric(9,6),
  map_x       numeric,
  map_y       numeric,
  has_task    boolean not null default false,
  gps_unlock  boolean not null default true,
  unlock_radius int not null default 50,
  note        text,
  created_at  timestamptz not null default now(),
  unique (rally_id, position)
);
create index if not exists points_rally_idx on public.points (rally_id, position);
alter table public.points add column if not exists unlock_radius int not null default 50;

-- ─── assignments ────────────────────────────────────────────────────────────
create table if not exists public.assignments (
  id            uuid primary key default gen_random_uuid(),
  point_id      uuid not null unique references public.points (id) on delete cascade,
  rally_id      uuid not null references public.rallies (id) on delete cascade,
  type          text not null check (type in (
                  'multiple_choice','open_question','observation','code_breaker',
                  'estimation','ordering','photo_search','qr_checkpoint','qr_search',
                  'speed_test','compass_point','free_game')),
  grading       text not null default 'auto' check (grading in ('auto','scale','manual')),
  points        int  not null default 10,
  hint_mode     text not null default 'off' check (hint_mode in ('off','free','cost')),
  hint_cost     int  not null default 5,
  hint_text     text,
  prompt        text,
  public_config jsonb not null default '{}'::jsonb,
  solution      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists assignments_rally_idx on public.assignments (rally_id);

-- ─── legs ────────────────────────────────────────────────────────────────────
create table if not exists public.legs (
  id               uuid primary key default gen_random_uuid(),
  rally_id         uuid not null references public.rallies (id) on delete cascade,
  position         int  not null,
  nav_mode         text not null default 'routebook' check (nav_mode in ('compass','routebook','turn','map')),
  bearing          numeric,
  distance         numeric,
  steps            text,
  note             text,
  enroute_enabled  boolean not null default false,
  enroute_question text,
  enroute_answer   text,
  enroute_points   int not null default 10,
  turn_steps       jsonb not null default '[]'::jsonb,
  turn_points      jsonb not null default '[]'::jsonb,
  turn_route       jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  unique (rally_id, position)
);
-- add columns to databases created before these fields existed
alter table public.legs add column if not exists enroute_answer text;
alter table public.legs add column if not exists turn_steps jsonb not null default '[]'::jsonb;
alter table public.legs add column if not exists turn_points jsonb not null default '[]'::jsonb;
alter table public.legs add column if not exists turn_route jsonb not null default '[]'::jsonb;

-- ─── teams ───────────────────────────────────────────────────────────────────
create table if not exists public.teams (
  id             uuid primary key default gen_random_uuid(),
  rally_id       uuid not null references public.rallies (id) on delete cascade,
  name           text not null,
  session_token  text not null default encode(gen_random_bytes(18), 'hex'),
  current_index  int  not null default 0,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists teams_rally_idx on public.teams (rally_id);
create index if not exists teams_token_idx on public.teams (session_token);

-- ─── team_events ─────────────────────────────────────────────────────────────
create table if not exists public.team_events (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  rally_id      uuid not null references public.rallies (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  point_id      uuid references public.points (id) on delete set null,
  kind          text not null check (kind in ('assignment','hint','penalty','digit','enroute','manual','badge')),
  points_delta  int  not null default 0,
  is_hint       boolean not null default false,
  needs_review  boolean not null default false,
  photo_path    text,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists team_events_team_idx on public.team_events (team_id);
create index if not exists team_events_rally_idx on public.team_events (rally_id);

-- ─── team_badges ─────────────────────────────────────────────────────────────
create table if not exists public.team_badges (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  name       text not null,
  icon       text not null default '🎖️',
  created_at timestamptz not null default now(),
  unique (team_id, name)
);

-- ─── team_scores (realtime leaderboard) ──────────────────────────────────────
create table if not exists public.team_scores (
  team_id       uuid primary key references public.teams (id) on delete cascade,
  rally_id      uuid not null references public.rallies (id) on delete cascade,
  name          text not null,
  score         int  not null default 0,
  hints         int  not null default 0,
  current_index int  not null default 0,
  finished      boolean not null default false,
  updated_at    timestamptz not null default now()
);
create index if not exists team_scores_rally_idx on public.team_scores (rally_id);

-- backfill any missing score rows (safe to re-run)
insert into public.team_scores (team_id, rally_id, name, score, hints, current_index, finished)
select t.id, t.rally_id, t.name,
       coalesce(sum(e.points_delta), 0),
       coalesce(sum(case when e.is_hint then 1 else 0 end), 0),
       t.current_index, t.finished_at is not null
from public.teams t
left join public.team_events e on e.team_id = t.id
group by t.id
on conflict (team_id) do nothing;

-- ============================================================================
-- Functions & triggers (create or replace / drop-if-exists = idempotent)
-- ============================================================================
create or replace function public.owns_rally(p_rally_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rallies r where r.id = p_rally_id and r.owner_id = auth.uid());
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists rallies_touch on public.rallies;
create trigger rallies_touch before update on public.rallies
  for each row execute function public.touch_updated_at();

create or replace function public.ts_on_team_ins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_scores (team_id, rally_id, name, current_index, finished)
  values (new.id, new.rally_id, new.name, new.current_index, new.finished_at is not null)
  on conflict (team_id) do nothing;
  return new;
end $$;
drop trigger if exists team_ins on public.teams;
create trigger team_ins after insert on public.teams for each row execute function public.ts_on_team_ins();

create or replace function public.ts_on_team_upd()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_scores set name = new.name, current_index = new.current_index,
         finished = new.finished_at is not null, updated_at = now()
   where team_id = new.id;
  return new;
end $$;
drop trigger if exists team_upd on public.teams;
create trigger team_upd after update on public.teams for each row execute function public.ts_on_team_upd();

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
drop trigger if exists event_ins on public.team_events;
create trigger event_ins after insert on public.team_events for each row execute function public.ts_on_event_ins();

-- ============================================================================
-- Row Level Security (enable is idempotent; policies dropped & recreated)
-- ============================================================================
alter table public.rallies     enable row level security;
alter table public.points      enable row level security;
alter table public.assignments enable row level security;
alter table public.legs        enable row level security;
alter table public.teams       enable row level security;
alter table public.team_events enable row level security;
alter table public.team_badges enable row level security;
alter table public.team_scores enable row level security;

drop policy if exists rallies_owner_all on public.rallies;
create policy rallies_owner_all on public.rallies
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists points_owner_all on public.points;
create policy points_owner_all on public.points
  for all using (public.owns_rally(rally_id)) with check (public.owns_rally(rally_id));

drop policy if exists assignments_owner_all on public.assignments;
create policy assignments_owner_all on public.assignments
  for all using (public.owns_rally(rally_id)) with check (public.owns_rally(rally_id));

drop policy if exists legs_owner_all on public.legs;
create policy legs_owner_all on public.legs
  for all using (public.owns_rally(rally_id)) with check (public.owns_rally(rally_id));

drop policy if exists teams_owner_read on public.teams;
create policy teams_owner_read on public.teams
  for select using (public.owns_rally(rally_id));

drop policy if exists team_events_owner_read on public.team_events;
create policy team_events_owner_read on public.team_events
  for select using (public.owns_rally(rally_id));

drop policy if exists team_badges_owner_read on public.team_badges;
create policy team_badges_owner_read on public.team_badges
  for select using (
    exists (select 1 from public.teams t where t.id = team_id and public.owns_rally(t.rally_id))
  );

drop policy if exists team_scores_read on public.team_scores;
create policy team_scores_read on public.team_scores
  for select using (
    exists (select 1 from public.rallies r where r.id = rally_id and (r.published or r.owner_id = auth.uid()))
  );

-- ── publish team_scores to Supabase Realtime ────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_scores'
  ) then
    alter publication supabase_realtime add table public.team_scores;
  end if;
exception when undefined_object then null;
end $$;

-- ── private storage bucket for proof photos ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('proof-photos', 'proof-photos', false)
on conflict (id) do nothing;

-- ============================================================================
-- Demo rally "Polderpuzzel rallye" (teamcode RLY-7H2K). Skipped if it exists.
-- ============================================================================
do $$
declare
  v_rally uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
  t_turbo uuid; t_route uuid; t_km uuid;
begin
  if exists (select 1 from public.rallies where join_code = 'RLY-7H2K') then
    return;
  end if;

  insert into public.rallies (owner_id, name, join_code, published)
    values (null, 'Polderpuzzel rallye', 'RLY-7H2K', true) returning id into v_rally;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 0, 'start', 'Start — dorpsplein', 51.921000, 4.531500, 70, 350, false, false,
            'Aanmelden met teamcode RLY-7H2K + teamnaam, geen account.');
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 1, 'waypoint', 'De oude sluis', 51.951000, 4.567500, 150, 250, true, true) returning id into p1;
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 2, 'waypoint', 'Fotopunt molen', 51.969000, 4.605750, 235, 190, true, true) returning id into p2;
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 3, 'waypoint', 'Dijktraject', 51.963000, 4.648500, 330, 210, true, true) returning id into p3;
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 4, 'waypoint', 'Vaar naar de overkant', 51.990000, 4.680000, 400, 120, true, true) returning id into p4;
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 5, 'waypoint', 'De geheime code', 51.975000, 4.711500, 470, 170, true, true,
            'Na de hint kan het team cijfers van de code kopen: −10 punten per cijfer.') returning id into p5;
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 6, 'waypoint', 'Café De Molen', 51.948000, 4.716000, 480, 260, true, true,
            'Organisator kan score en bewijsfoto na afloop controleren.') returning id into p6;
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 7, 'finish', 'Finish — café De Molen', 51.936000, 4.716000, 480, 300, false, false,
            'Eindscherm: klassement, eigen statistieken en badges.');

  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p1, v_rally, 'multiple_choice', 'auto', 20, 'cost', 5,
            'Tel de klinknagels niet — kijk op de gedenksteen naast de sluisdeur.',
            'In welk jaar is deze sluis gebouwd?',
            '{"options":[{"id":"A","label":"1872"},{"id":"B","label":"1894"},{"id":"C","label":"1901"}]}'::jsonb,
            '{"correct":"B"}'::jsonb);
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p2, v_rally, 'photo_search', 'auto', 15, 'off',
            'Vind het bord met de molenaarsnaam en fotografeer het.', '{"review":true}'::jsonb);
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p3, v_rally, 'speed_test', 'scale', 25, 'off',
            'Doel: gemiddeld 38 km/u over het traject.',
            '{"target":38,"maxPoints":25,"penaltyPerKmh":3,"min":20,"max":56}'::jsonb);
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p4, v_rally, 'qr_search', 'auto', 30, 'cost', 5,
            'Het echte bordje hangt aan de paal mét het reddingsboei-symbool.',
            'Er hangen drie bordjes bij de overkant. Slechts één is de echte — scan het juiste!',
            '{"signs":["A","B","C"]}'::jsonb, '{"correct":"A","wrongPenalty":5,"retry":true}'::jsonb);
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p5, v_rally, 'code_breaker', 'auto', 25, 'cost', 5,
            'Denk terug aan waypoint 1: in welk jaar werd de sluis gebouwd?',
            'Er staat een kistje met een 4-cijferig slot. Kraak de code!',
            '{"digits":4,"digitCost":10,"riddle":"Het antwoord ligt achter je — bij het begin van jullie tocht langs het water."}'::jsonb,
            '{"code":"1894","digitCost":10}'::jsonb);
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p6, v_rally, 'free_game', 'manual', 15, 'off',
            'Spijkerpoepen — 2 minuten!',
            '{"perUnit":1,"max":15,"unitLabel":"spijker","review":true}'::jsonb);

  insert into public.legs (rally_id, position, nav_mode, steps) values
    (v_rally, 0, 'routebook', E'Verlaat het dorpsplein via de Kerkstraat.\nGa bij de bakker rechtsaf.\nVolg het water tot de oude sluis.'),
    (v_rally, 1, 'routebook', E'Steek de sluisbrug over.\nVolg het fietspad langs de vaart.\nNa 400 m staat de molen links.');
  insert into public.legs (rally_id, position, nav_mode, steps, enroute_enabled, enroute_question, enroute_answer, enroute_points)
    values (v_rally, 2, 'turn', E'Na 150 m rechts de dijk op.\nNa 800 m flauwe bocht links aanhouden.\nNa 1,4 km stoppen bij het pontje.',
            true, 'Hoeveel wieken heeft de molen die je passeert?', '4', 10);
  insert into public.legs (rally_id, position, nav_mode, bearing, distance) values
    (v_rally, 3, 'compass', 214, 350), (v_rally, 4, 'compass', 78, 120);
  insert into public.legs (rally_id, position, nav_mode, note) values
    (v_rally, 5, 'map', 'Volg de route op de kaart naar café De Molen.'),
    (v_rally, 6, 'map', 'De finish is binnen in het café — meld je bij de spelleider.');

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
