-- Drop the assignment type CHECK so new building blocks (video_task,
-- game_master, …) never need a schema migration again. Values are controlled
-- in app code.
alter table public.assignments drop constraint if exists assignments_type_check;
