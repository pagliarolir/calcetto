\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,13) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
-- voti a tutti gli altri in campo: 6 a tutti tranne un 8
create function tutti_a_6(voter uuid) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('target_id', user_id, 'score', case when rn = 1 then 8 else 6 end))
  from (select user_id, row_number() over (order by user_id) as rn from lineup where match_id = mid() and user_id <> voter) x $$;
grant execute on function as_user(text), pid(text), mid(), tutti_a_6(uuid) to authenticated;

-- partita giocata da P2..P11 (il Leader P1 NON ha giocato); P12 delegato del Leader; voti aperti
insert into bookings (match_id, user_id, choice, list) select mid(), pid('P'||g), 'present', 'team' from generate_series(2,11) g;
update bookings set list = 'out', choice = 'absent' where match_id = mid() and user_id = pid('P1');
insert into lineup (match_id, user_id, team) select mid(), pid('P'||g), case when g % 2 = 0 then 'white' else 'black' end from generate_series(2,11) g;
insert into results (match_id, diff, white_goals, black_goals, status) values (mid(), 1, 3, 2, 'homologated');
update matches set status = 'played', lineup_status = 'official', starts_at = now() - interval '2 hours', bookings_close_at = now() - interval '3 hours' where id = mid();
update leadership_delegation set delegate_id = pid('P12'), until = now() + interval '1 day';

set role authenticated;
\echo '--- 1) un giocatore vota tutti (6 di base, un 8): voti registrati'
select as_user('P2'), submit_votes(mid(), tutti_a_6(pid('P2')), null, null);
reset role;
select count(*) as voti_di_p2, count(*) filter (where score = 6) as sei, count(*) filter (where score = 8) as otto from player_votes where voter_id = pid('P2');

\set ON_ERROR_STOP 0
\echo '--- 2) i voti non si modificano (attesi 2 errori): P2 rivota, P2 prova solo il migliore in campo'
set role authenticated;
select as_user('P2'), submit_votes(mid(), tutti_a_6(pid('P2')), null, null);
select as_user('P2'), submit_votes(mid(), '[]'::jsonb, pid('P4'), null);
\echo '--- 3) chi non ha giocato e non e Leader non vota; invio vuoto rifiutato (attesi 2 errori)'
select as_user('P13'), submit_votes(mid(), tutti_a_6(pid('P13')), null, null);
select as_user('P3'), submit_votes(mid(), '[]'::jsonb, null, null);
\set ON_ERROR_STOP 1

\echo '--- 4) il Leader vota anche se non ha giocato, e anche il suo delegato'
select as_user('P1'), submit_votes(mid(), tutti_a_6(pid('P1')), pid('P2'), pid('P3'));
select as_user('P12'), submit_votes(mid(), tutti_a_6(pid('P12')), null, null);
reset role;
select (select count(*) from player_votes where voter_id = pid('P1')) as voti_del_leader,
       (select count(*) from player_votes where voter_id = pid('P12')) as voti_del_delegato;

\echo '--- 5) consultazione: un giocatore vede solo i suoi voti; il Leader tutti'
set role authenticated;
select as_user('P2'); select count(*) as voti_visti_da_p2, count(*) filter (where voter_id <> pid('P2')) as di_altri from player_votes;
select as_user('P1'); select count(distinct voter_id) as votanti_visti_dal_leader from player_votes;
select as_user('P3'); select (vote_summary(mid())->>'voters')::int as votanti, vote_summary(mid())->'players' is null or jsonb_typeof(vote_summary(mid())->'players') = 'null' as medie_ancora_nascoste;
reset role;

\echo '--- 6) nessuno puo cambiare i voti direttamente nella tabella (attesi 2 errori)'
\set ON_ERROR_STOP 0
set role authenticated; select as_user('P2');
update player_votes set score = 10 where voter_id = pid('P2');
delete from player_votes where voter_id = pid('P2');
reset role;
\set ON_ERROR_STOP 1
select count(*) filter (where score = 10) as voti_a_dieci from player_votes;
