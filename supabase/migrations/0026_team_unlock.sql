-- Game-leader "unlock" signal. Points whose position is <= unlocked_index are
-- force-unlocked for that team (bypassing the gps gate). It rides the existing
-- realtime team_scores row (anon-readable for published rallies), so the team's
-- device opens the assignment live. -1 = nothing force-unlocked.
alter table public.team_scores add column if not exists unlocked_index int not null default -1;
