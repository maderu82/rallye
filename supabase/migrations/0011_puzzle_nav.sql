-- Two new navigation modes: cryptische route + foto-navigatie.
-- Drop the nav_mode CHECK entirely so new navigation modes never need a
-- migration again (values are controlled in app code).
alter table public.legs drop constraint if exists legs_nav_mode_check;

-- Public bucket for the organizer's junction/landmark photos (foto-navigatie).
-- These are shown to every player, so a public bucket gives stable URLs.
insert into storage.buckets (id, name, public)
values ('route-photos', 'route-photos', true)
on conflict (id) do update set public = true;
