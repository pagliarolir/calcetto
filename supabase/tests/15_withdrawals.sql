\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,14) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
grant execute on function as_user(text), pid(text), mid() to authenticated;

\echo '--- 1) partita tra 3 giorni: P2 rinuncia (non tardiva) e P11 sale dalle riserve; P12, riserva volontaria, diventa assente (non e una rinuncia)'
update matches set bookings_open_at = now() - interval '1 day', starts_at = now() + interval '3 days', bookings_close_at = now() + interval '3 days';
set role authenticated;
select as_user('P'||g), book(mid(), 'present') from generate_series(2,11) g;
select as_user('P2'), book(mid(), 'absent');
select as_user('P12'), book(mid(), 'reserve');
select as_user('P12'), book(mid(), 'absent');
reset role;
select (select n from ids where id = user_id) as chi, list, withdrew as rinuncia, late_withdrawal as tardiva
from bookings where match_id = mid() and user_id in (pid('P2'), pid('P11'), pid('P12')) order by 1;

\echo '--- 2) a meno di 24 ore P3 rinuncia: rinuncia e tardiva'
update matches set starts_at = now() + interval '10 hours', bookings_close_at = now() + interval '10 hours' where id = mid();
set role authenticated;
select as_user('P3'), book(mid(), 'absent');
reset role;
select withdrew as rinuncia, late_withdrawal as tardiva from bookings where match_id = mid() and user_id = pid('P3');

\echo '--- 3) partita giocata: classifica e registro contano le rinunce'
update matches set status = 'played', starts_at = now() - interval '2 hours' where id = mid();
insert into results (match_id, diff, white_goals, black_goals, status) values (mid(), 1, 2, 1, 'homologated');
set role authenticated; select as_user('P1');
select (select n from ids where id = user_id) as chi, late_withdrawals as forfait, withdrawals as rinunce
from stats_table() where user_id in (pid('P2'), pid('P3'), pid('P11'), pid('P12')) order by 1;
select (select n from ids where id = user_id) as chi, withdrew, late_withdrawal from attendance_register()
where user_id in (pid('P2'), pid('P3')) order by 1;
reset role;

\echo '--- 4) "sceglie il Leader": un titolare che dice non ci sono e una rinuncia'
set role authenticated; select as_user('P1');
select leader_create_matches(array[current_date + 20], '20:00', jsonb_build_object('players_per_team', 5, 'team_a_kit', 'white', 'team_b_kit', 'black',
  'booking_open_days', 3, 'booking_open_time', '12:00', 'booking_close_days', 0, 'booking_close_time', '17:00', 'votes_open_after_min', 30, 'votes_hours', 48, 'booking_mode', 'free'), false) is not null;
reset role;
create temp table fm as select id from matches where booking_mode = 'free'; grant select on fm to authenticated;
update matches set bookings_open_at = now() - interval '1 hour', starts_at = now() + interval '5 days', bookings_close_at = now() + interval '4 days' where id = (select id from fm);
set role authenticated;
select as_user('P5'), book((select id from fm), 'present');
select as_user('P1'), leader_assign((select id from fm), pid('P5'), 'team');
select as_user('P5'), book((select id from fm), 'absent');
reset role;
select withdrew as rinuncia, late_withdrawal as tardiva from bookings where match_id = (select id from fm) and user_id = pid('P5');
