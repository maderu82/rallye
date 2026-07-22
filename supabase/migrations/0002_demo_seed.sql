-- ============================================================================
-- Demo seed — the fixed "Polderpuzzel rallye" scenario (spec §4).
-- Idempotent: does nothing if a rally with join code RLY-7H2K already exists.
-- Safe to skip in a real production database (drop this migration file).
-- ============================================================================
do $$
declare
  v_rally uuid;
  p_s uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p_f uuid;
  a1 uuid; a4 uuid; a5 uuid;
  t_turbo uuid; t_route uuid; t_km uuid;
begin
  if exists (select 1 from public.rallies where join_code = 'RLY-7H2K') then
    return;
  end if;

  insert into public.rallies (owner_id, name, join_code, published)
    values (null, 'Polderpuzzel rallye', 'RLY-7H2K', true)
    returning id into v_rally;

  -- ── points ────────────────────────────────────────────────────────────────
  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 0, 'start', 'Start — dorpsplein', 51.921000, 4.531500, 70, 350, false, false,
            'Aanmelden met teamcode RLY-7H2K + teamnaam, geen account.')
    returning id into p_s;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 1, 'waypoint', 'De oude sluis', 51.951000, 4.567500, 150, 250, true, true)
    returning id into p1;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 2, 'waypoint', 'Fotopunt molen', 51.969000, 4.605750, 235, 190, true, true)
    returning id into p2;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 3, 'waypoint', 'Dijktraject', 51.963000, 4.648500, 330, 210, true, true)
    returning id into p3;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock)
    values (v_rally, 4, 'waypoint', 'Vaar naar de overkant', 51.990000, 4.680000, 400, 120, true, true)
    returning id into p4;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 5, 'waypoint', 'De geheime code', 51.975000, 4.711500, 470, 170, true, true,
            'Na de hint kan het team cijfers van de code kopen: −10 punten per cijfer.')
    returning id into p5;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 6, 'waypoint', 'Café De Molen', 51.948000, 4.716000, 480, 260, true, true,
            'Organisator kan score en bewijsfoto na afloop controleren.')
    returning id into p6;

  insert into public.points (rally_id, position, kind, name, lat, lng, map_x, map_y, has_task, gps_unlock, note)
    values (v_rally, 7, 'finish', 'Finish — café De Molen', 51.936000, 4.716000, 480, 300, false, false,
            'Eindscherm: klassement, eigen statistieken en badges.')
    returning id into p_f;

  -- ── assignments ───────────────────────────────────────────────────────────
  -- WP1: multiple choice (AUTO)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p1, v_rally, 'multiple_choice', 'auto', 20, 'cost', 5,
            'Tel de klinknagels niet — kijk op de gedenksteen naast de sluisdeur.',
            'In welk jaar is deze sluis gebouwd?',
            '{"options":[{"id":"A","label":"1872"},{"id":"B","label":"1894"},{"id":"C","label":"1901"}]}'::jsonb,
            '{"correct":"B"}'::jsonb)
    returning id into a1;

  -- WP2: photo search (AUTO on submission, organizer reviews after)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p2, v_rally, 'photo_search', 'auto', 15, 'off',
            'Vind het bord met de molenaarsnaam en fotografeer het.',
            '{"review":true}'::jsonb);

  -- WP3: average-speed test (SCALE)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p3, v_rally, 'speed_test', 'scale', 25, 'off',
            'Doel: gemiddeld 38 km/u over het traject.',
            '{"target":38,"maxPoints":25,"penaltyPerKmh":3,"min":20,"max":56}'::jsonb);

  -- WP4: QR search (AUTO) — bearing/distance shown by the leg (compass)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p4, v_rally, 'qr_search', 'auto', 30, 'cost', 5,
            'Het echte bordje hangt aan de paal mét het reddingsboei-symbool.',
            'Er hangen drie bordjes bij de overkant. Slechts één is de echte — scan het juiste!',
            '{"signs":["A","B","C"]}'::jsonb,
            '{"correct":"A","wrongPenalty":5,"retry":true}'::jsonb)
    returning id into a4;

  -- WP5: code breaker (AUTO) with two-step help (hint, then buy digits)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, hint_cost, hint_text, prompt, public_config, solution)
    values (p5, v_rally, 'code_breaker', 'auto', 25, 'cost', 5,
            'Denk terug aan waypoint 1: in welk jaar werd de sluis gebouwd?',
            'Er staat een kistje met een 4-cijferig slot. Kraak de code!',
            '{"digits":4,"digitCost":10,"riddle":"Het antwoord ligt achter je — bij het begin van jullie tocht langs het water."}'::jsonb,
            '{"code":"1894","digitCost":10}'::jsonb)
    returning id into a5;

  -- WP6: free game moment (MANUAL)
  insert into public.assignments (point_id, rally_id, type, grading, points, hint_mode, prompt, public_config)
    values (p6, v_rally, 'free_game', 'manual', 15, 'off',
            'Spijkerpoepen — 2 minuten!',
            '{"perUnit":1,"max":15,"unitLabel":"spijker","review":true}'::jsonb);

  -- ── legs ──────────────────────────────────────────────────────────────────
  insert into public.legs (rally_id, position, nav_mode, steps) values
    (v_rally, 0, 'routebook',
     E'Verlaat het dorpsplein via de Kerkstraat.\nGa bij de bakker rechtsaf.\nVolg het water tot de oude sluis.'),
    (v_rally, 1, 'routebook',
     E'Steek de sluisbrug over.\nVolg het fietspad langs de vaart.\nNa 400 m staat de molen links.');

  insert into public.legs (rally_id, position, nav_mode, steps, enroute_enabled, enroute_question, enroute_points)
    values (v_rally, 2, 'turn',
     E'Na 150 m rechts de dijk op.\nNa 800 m flauwe bocht links aanhouden.\nNa 1,4 km stoppen bij het pontje.',
     true, 'Hoeveel wieken heeft de molen die je passeert?', 10);

  insert into public.legs (rally_id, position, nav_mode, bearing, distance) values
    (v_rally, 3, 'compass', 214, 350),
    (v_rally, 4, 'compass', 78, 120);

  insert into public.legs (rally_id, position, nav_mode, note) values
    (v_rally, 5, 'map', 'Volg de route op de kaart naar café De Molen.'),
    (v_rally, 6, 'map', 'De finish is binnen in het café — meld je bij de spelleider.');

  -- ── demo teams (for the leaderboard & live-view demo) ──────────────────────
  insert into public.teams (rally_id, name, current_index) values
    (v_rally, 'Team Turbo', 6) returning id into t_turbo;
  insert into public.teams (rally_id, name, current_index) values
    (v_rally, 'De Routeplanners', 5) returning id into t_route;
  insert into public.teams (rally_id, name, current_index) values
    (v_rally, 'Kilometervreters', 3) returning id into t_km;

  insert into public.team_events (team_id, rally_id, kind, points_delta, detail) values
    (t_turbo, v_rally, 'manual', 312, '{"seed":true}'::jsonb),
    (t_route, v_rally, 'manual', 287, '{"seed":true}'::jsonb),
    (t_km,    v_rally, 'manual', 221, '{"seed":true}'::jsonb);
end $$;
