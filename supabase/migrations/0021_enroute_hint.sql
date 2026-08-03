-- Optional hint for a graded en-route question: reveal on demand, optionally at
-- a point cost.
alter table public.legs add column if not exists enroute_hint      text;
alter table public.legs add column if not exists enroute_hint_cost int;
