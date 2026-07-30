-- Store each team's last known GPS position so the organizer's live view can
-- show where teams actually are (not just an estimate from their progress).
alter table public.teams add column if not exists last_lat    numeric(9,6);
alter table public.teams add column if not exists last_lng    numeric(9,6);
alter table public.teams add column if not exists last_gps_at timestamptz;

-- Push team position updates to the organizer's live view via Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teams'
  ) then
    alter publication supabase_realtime add table public.teams;
  end if;
exception when undefined_object then null;
end $$;
