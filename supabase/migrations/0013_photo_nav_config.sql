-- Per-leg foto-navigatie settings: geofence radius (m) to confirm arrival at a
-- photo, and the point cost to buy/reveal the next photo. NULL = app defaults
-- (100 m / 5 points).
alter table public.legs add column if not exists photo_radius   int;
alter table public.legs add column if not exists photo_buy_cost int;
