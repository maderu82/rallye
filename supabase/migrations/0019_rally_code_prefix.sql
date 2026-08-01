-- Every rally code must start with RLY-. Normalize any legacy codes: strip
-- spaces, upper-case, drop a bare RLY/RLY- the code may already carry, then
-- re-apply exactly one RLY- prefix.
update public.rallies
set join_code = 'RLY-' || regexp_replace(upper(replace(join_code, ' ', '')), '^RLY-?', '')
where join_code is not null
  and join_code !~ '^RLY-.';
