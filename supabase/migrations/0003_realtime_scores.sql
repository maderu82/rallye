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
