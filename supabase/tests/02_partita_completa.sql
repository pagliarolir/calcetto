\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,12) g;
update profiles set role='premier1' where first_name='P2';
update profiles set role='premier2' where first_name='P3';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function nm(u uuid) returns text language sql as $$ select n from ids where id = u $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
grant execute on function as_user(text), mid(), nm(uuid) to authenticated;

\echo '--- leadership: Leader attivo / inattivo 16 giorni / anche P1 inattivo'
select nm(acting_leader()) as acting;
update profiles set last_seen_at = now() - interval '16 days' where first_name='P1';
select nm(acting_leader()) as acting;
update profiles set last_seen_at = now() - interval '16 days' where first_name='P2';
select nm(acting_leader()) as acting;
set role authenticated; select as_user('P3'); select has_leader_powers() as p3_powers; reset role;
-- il Leader si riconnette
set role authenticated; select as_user('P1'); select (touch()->>'leader_powers') as p1_powers; reset role;
select nm(acting_leader()) as acting_after_reconnect;
-- delega a P7
set role authenticated; select as_user('P1'); select delegate_leadership((select id from ids where n='P7'), now() + interval '1 day');
select as_user('P7'); select has_leader_powers() as p7_delegate_powers; reset role;

-- partita a 10 ore: siamo nelle 24 ore
update matches set bookings_open_at = now() - interval '2 days', starts_at = now() + interval '10 hours';
set role authenticated;
select as_user('P'||g), book(mid(), 'present') from generate_series(2,10) g;
\echo '--- P4 rinuncia a 10 ore, nessuna riserva: atteso late_withdrawal + avviso need_one'
select as_user('P4'), book(mid(), 'absent');
reset role;
select kind, count(*) from notifications where kind in ('late_withdrawal','need_one') group by kind;
select nm(user_id), late_withdrawal from bookings where late_withdrawal;
set role authenticated; select as_user('P11'), book(mid(), 'present'); reset role;

\echo '--- formazioni (P8 delegato propone, P2 premier approva)'
set role authenticated;
select as_user('P1'); select set_lineup_delegate(mid(), (select id from ids where n='P8'));
select as_user('P8');
select save_lineup(mid(), (select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'team', case when rn % 2 = 1 then 'white' else 'black' end, 'field_slot', (rn+1)/2))
  from (select user_id, row_number() over (order by sort_key) rn from bookings where match_id = mid() and list='team') b), true) as status;
select as_user('P5'); select count(*) as lineup_visible_to_p5_before from lineup;
select as_user('P2'); select review_lineup(mid(), true);
select as_user('P5'); select count(*) as lineup_visible_to_p5_after from lineup;
reset role;
select nm(user_id), team, field_slot from lineup order by team, field_slot;

-- la partita è finita (21:30 passate)
update matches set starts_at = now() - interval '2 hours';
\echo '--- risultato: P1 inserisce 6-3, 5 conferme omologano'
set role authenticated;
select as_user('P1'); select submit_result(mid(), null, 6, 3);
\set ON_ERROR_STOP 0
select as_user('P1'); select review_result(mid(), true);
select as_user('P6'); select submit_result(mid(), 1);
\echo '--- marcatori incoerenti (7 gol ai bianchi): atteso errore'
select as_user('P5'); select save_scorers(mid(), (select jsonb_agg(jsonb_build_object('user_id', user_id, 'goals', 2)) from lineup where team='white' and match_id=mid()));
\set ON_ERROR_STOP 1
select as_user('P5'); select save_scorers(mid(), jsonb_build_array(
   jsonb_build_object('user_id', (select user_id from lineup where team='white' order by field_slot limit 1), 'goals', 3, 'assists', 1),
   jsonb_build_object('user_id', (select user_id from lineup where team='black' order by field_slot limit 1), 'goals', 2, 'own_goals', 1)));
select as_user('P'||g), review_result(mid(), true) from generate_series(5,9) g;
reset role;
select status, homologated_by from results;

\echo '--- voti: 4 votanti => medie nascoste; 5 => visibili'
set role authenticated;
select as_user(nm(l.user_id)), submit_votes(mid(),
  (select jsonb_agg(jsonb_build_object('target_id', t.user_id, 'score', 5 + (abs(hashtext(t.user_id::text||l.user_id::text)) % 9) / 2.0)) from lineup t where t.user_id <> l.user_id), null, null)
from (select user_id from lineup order by user_id limit 4) l;
select as_user('P9'); select vote_summary(mid())->>'voters' as voters_now, jsonb_typeof(vote_summary(mid())->'players') = 'null' as hidden;
select as_user(nm(l.user_id)), submit_votes(mid(), '[]'::jsonb, (select user_id from lineup where team='white' and user_id<>l.user_id limit 1), null)
from (select user_id from lineup order by user_id offset 4 limit 1) l;
select as_user('P9'); select jsonb_array_length(vote_summary(mid())->'players') as players_shown;
select count(*) as votes_seen_by_p9 from player_votes;
select as_user('P1'); select count(*) as votes_seen_by_leader from player_votes;
reset role;

\echo '--- scheduler: chiusura a mezzanotte (simulata) e statistiche'
update matches set starts_at = now() - interval '30 hours';
select run_scheduler();
select status, locked from matches where id = mid();
set role authenticated; select as_user('P9');
select nm(user_id) n, played, wins, losses, points, goals, own_goals, team_goals_for gf, team_goals_against ga, avg_vote, mvp_count, cur_win_streak, attendances, late_withdrawals
from stats_table() where played > 0 or late_withdrawals > 0 order by points desc, goals desc;
reset role;
select count(*) as matches_total, count(*) filter (where status='scheduled') as upcoming from matches;
select count(*) as dispatcher_calls from net.calls;

\echo '--- riserva che risponde "non posso": attesa scelta absent, lista out'
reset role;
insert into auth.users (email, raw_user_meta_data) values ('r1@x.it', '{"first_name":"R1"}');
insert into ids select first_name, id from profiles where first_name = 'R1';
update matches set status = 'scheduled', locked = false, bookings_open_at = now() - interval '1 day', starts_at = now() + interval '10 hours' where id = mid();
set role authenticated;
select as_user('R1'), book(mid(), 'reserve');
select as_user('R1'), reserve_reply(mid(), 'declined');
reset role;
select nm(user_id) as chi, choice, list, reserve_reply from bookings where user_id = (select id from ids where n = 'R1');
