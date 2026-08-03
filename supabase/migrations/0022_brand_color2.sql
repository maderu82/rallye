-- Optional second brand (accent) color for the player app.
alter table public.rallies add column if not exists brand_color2 text;
