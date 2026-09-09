-- Per-assignment "move on without solving" penalty. NULL = skipping not allowed;
-- a value (>= 0) lets a team give up the task and advance for that many penalty
-- points after a wrong answer.
alter table public.assignments add column if not exists skip_cost int;
