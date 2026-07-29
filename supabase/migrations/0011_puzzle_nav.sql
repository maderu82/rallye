-- Two new navigation modes: cryptische route + foto-navigatie.
alter table public.legs drop constraint if exists legs_nav_mode_check;
alter table public.legs add constraint legs_nav_mode_check
  check (nav_mode in ('compass', 'routebook', 'turn', 'map', 'cryptic', 'photo_nav'));

-- Public bucket for the organizer's junction/landmark photos (foto-navigatie).
-- These are shown to every player, so a public bucket gives stable URLs.
insert into storage.buckets (id, name, public)
values ('route-photos', 'route-photos', true)
on conflict (id) do update set public = true;
