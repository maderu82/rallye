-- Speed monitoring: a per-rally default limit and an optional per-leg override
-- (km/h). NULL = no limit set. The live view flags legs whose estimated average
-- speed exceeds the effective limit (leg override, else rally default).
alter table public.rallies add column if not exists speed_limit int;
alter table public.legs    add column if not exists speed_limit int;
