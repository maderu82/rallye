-- Soft-delete for rallies: a deleted rally moves to the trash (deleted_at set)
-- and is hidden, but can be restored — or permanently removed later.
alter table public.rallies add column if not exists deleted_at timestamptz;
