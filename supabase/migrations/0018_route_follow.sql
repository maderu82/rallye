-- Map-reading nav mode ("de harde lijn"): the organizer draws a route line the
-- team must follow by map alone; the GPS trail is scored afterwards on how much
-- of the route was covered.
alter table public.legs add column if not exists route_points   int;  -- max points
alter table public.legs add column if not exists route_corridor int;  -- corridor (m)
