-- Allow larger uploads (video-opdracht) in the proof bucket. Default is 50 MB;
-- raise to 200 MB so team videos (e.g. the ferry crossing) fit.
insert into storage.buckets (id, name, public, file_size_limit)
values ('proof-photos', 'proof-photos', false, 209715200)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
