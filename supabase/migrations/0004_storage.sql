-- ============================================================================
-- Private Storage bucket for proof photos (photo-search + free-game).
--
-- The bucket is private. All uploads and reads go through the Next.js server
-- (service role), which bypasses Storage RLS, so no object-level policies are
-- required and participants never get direct bucket access. Organizers view
-- photos in the review screen via short-lived signed URLs minted server-side.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('proof-photos', 'proof-photos', false)
on conflict (id) do nothing;
