-- Threshold (minutes) after which a stationary team is flagged in the live view.
alter table public.rallies add column if not exists idle_limit int;
