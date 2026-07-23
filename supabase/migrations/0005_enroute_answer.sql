-- ============================================================================
-- En-route question answer.
-- A leg's onderwegvraag can now carry an answer. Rule (product):
--   * enroute_points > 0  → AUTO-graded: the answer is checked, points awarded.
--   * enroute_points = 0  → a "get to know each other" question: no right/wrong,
--                            no answer needed, 0 points.
-- ============================================================================
alter table public.legs add column if not exists enroute_answer text;

-- backfill the demo rally's en-route question answer (seeded before this column)
update public.legs set enroute_answer = '4'
where enroute_enabled and enroute_answer is null and enroute_question ilike '%wieken%';
