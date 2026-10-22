\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,11) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
grant execute on function as_user(text), pid(text), mid() to authenticated, anon;
-- partita giocata: P1..P10 in campo (P1..P5 bianchi), 5-3, voti aperti
insert into bookings (match_id, user_id, choice, list) select mid(), pid('P'||g), 'present', 'team' from generate_series(2,10) g on conflict do nothing;
insert into lineup (match_id, user_id, team) select mid(), pid('P'||g), case when g <= 5 then 'white' else 'black' end from generate_series(1,10) g;
update matches set status = 'scheduled', lineup_status = 'official', starts_at = now() - interval '3 hours', bookings_close_at = now() - interval '4 hours';
create temp table vt as select votes_opens_at < now() as aperte from matches; grant select on vt to authenticated;

\echo '--- 1) il risultato inserito da un giocatore resta da omologare: arriva la richiesta al Leader'
set role authenticated; select as_user('P2'), submit_result(mid(), null, 5, 3); reset role;
select (select n from ids where id = user_id) as a_chi, title from notifications where kind = 'homologate_needed';

\echo '--- 2) marcatori: P2 inserisce i suoi (2 assist anche se nessuno ha ancora inserito i gol: nessun errore)'
set role authenticated; select as_user('P2'), save_scorers(mid(), jsonb_build_array(jsonb_build_object('user_id', pid('P2'), 'assists', 2))); reset role;
select goals, assists, set_by_leader from scorers where user_id = pid('P2');

\echo '--- 3) il Leader inserisce i gol di P3 (anche 0 autogol) e corregge P2: i loro dati si bloccano'
set role authenticated;
select as_user('P1'), save_scorers(mid(), jsonb_build_array(jsonb_build_object('user_id', pid('P3'), 'goals', 3), jsonb_build_object('user_id', pid('P2'), 'goals', 1, 'assists', 1)));
reset role;
select (select n from ids where id = user_id) as chi, goals, assists, set_by_leader from scorers where match_id = mid() order by 1;
\set ON_ERROR_STOP 0
\echo '--- 4) attesi 2 errori: P3 cambia i dati messi dal Leader; P4 inserisce i gol di P5'
set role authenticated;
select as_user('P3'), save_scorers(mid(), jsonb_build_array(jsonb_build_object('user_id', pid('P3'), 'goals', 5)));
select as_user('P4'), save_scorers(mid(), jsonb_build_array(jsonb_build_object('user_id', pid('P5'), 'goals', 1)));
reset role;
\set ON_ERROR_STOP 1
select goals as gol_di_p3_invariati from scorers where user_id = pid('P3');

\echo '--- 5) un solo migliore in campo: P6 e P7 scelgono P3, P8 sceglie P9; migliore P3 (uno solo)'
update matches set votes_opens_at = now() - interval '1 hour', votes_closes_at = now() + interval '1 day' where id = mid();
set role authenticated;
select as_user('P6'), submit_votes(mid(), jsonb_build_array(jsonb_build_object('target_id', pid('P2'), 'score', 6)), pid('P3'), null);
select as_user('P7'), submit_votes(mid(), jsonb_build_array(jsonb_build_object('target_id', pid('P2'), 'score', 6)), null, pid('P3'));
select as_user('P8'), submit_votes(mid(), jsonb_build_array(jsonb_build_object('target_id', pid('P2'), 'score', 6)), pid('P9'), null);
reset role;
select mvp_mode from matches where id = mid();
select (select n from ids where id = white_pick) as bianco, (select n from ids where id = black_pick) as nero from mvp_votes order by voter_id;
set role authenticated; select as_user('P1');
select (select n from ids where id = (x->>'user_id')::uuid) as migliore from jsonb_array_elements(vote_summary(mid())->'players') x where (x->>'is_mvp')::boolean;
reset role;

\echo '--- 6) partite votate prima del cambio: restano "uno per squadra" (stesse scelte: due migliori)'
update matches set mvp_mode = 'per_team' where id = mid();
set role authenticated; select as_user('P1');
select string_agg((select n from ids where id = (x->>'user_id')::uuid), ',' order by 1) as migliori_per_squadra from jsonb_array_elements(vote_summary(mid())->'players') x where (x->>'is_mvp')::boolean;
reset role;
update matches set mvp_mode = 'single' where id = mid();

\echo '--- 7) durata: partita da 45 minuti, voti 30 minuti dopo la fine; 91 minuti rifiutati (atteso errore)'
set role authenticated; select as_user('P1');
select leader_create_matches(array[current_date + 15], '20:00', jsonb_build_object('players_per_team', 5, 'team_a_kit', 'white', 'team_b_kit', 'black',
  'booking_open_days', 3, 'booking_open_time', '12:00', 'booking_close_days', 0, 'booking_close_time', '17:00', 'votes_open_after_min', 30, 'votes_hours', 48, 'duration_min', 45), false) is not null;
reset role;
select duration_min, votes_opens_at - starts_at as voti_dopo_inizio from matches where nominal_date = current_date + 15;
\set ON_ERROR_STOP 0
set role authenticated; select as_user('P1');
select update_matches_config(array[(select id from matches where nominal_date = current_date + 15)], jsonb_build_object('players_per_team', 5, 'team_a_kit', 'white', 'team_b_kit', 'black',
  'booking_open_days', 3, 'booking_open_time', '12:00', 'booking_close_days', 0, 'booking_close_time', '17:00', 'votes_open_after_min', 30, 'votes_hours', 48, 'duration_min', 91), array['duration'], null);
reset role;
\set ON_ERROR_STOP 1

\echo '--- 8) logo: lo imposta il Leader, un giocatore no (atteso errore); si legge anche senza accedere'
set role authenticated; select as_user('P1'), set_app_logo('11111111-2222-3333-4444-555555555555');
\set ON_ERROR_STOP 0
select as_user('P2'), set_app_logo(null);
\set ON_ERROR_STOP 1
reset role; set role anon;
select app_branding()->>'logo_id' as logo_visto_da_anonimo;
reset role;
