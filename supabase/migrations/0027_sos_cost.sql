-- Penalty for a team using the "I'm lost — bring me back to the route" button
-- (the manual SOS compass). Rally-wide, default 10 points.
alter table public.rallies add column if not exists sos_cost int not null default 10;
