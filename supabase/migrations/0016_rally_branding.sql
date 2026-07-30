-- Per-rally branding: an accent color (hex) and an optional logo URL.
alter table public.rallies add column if not exists brand_color text;
alter table public.rallies add column if not exists brand_logo  text;
