\set ON_ERROR_STOP 1
\pset footer off
-- Marcatori fino alle 12 del giorno dopo (migrazione 51): la partita chiusa a mezzanotte non li blocca più.
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,10) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
grant execute on function as_user(text), pid(text), mid() to authenticated, anon;
insert into lineup (match_id, user_id, team) select mid(), pid('P'||g), case when g <= 5 then 'white' else 'black' end from generate_series(1,10) g;
insert into bookings (match_id, user_id, choice, list) select mid(), pid('P'||g), 'present', 'team' from generate_series(2,10) g on conflict do nothing;

\echo '--- 1) chiusura dei marcatori: le 12 del giorno dopo la partita (ora di Roma)'
update matches set status = 'scheduled', lineup_status = 'official', starts_at = now() - interval '3 hours', bookings_close_at = now() - interval '4 hours' where id = mid();
select to_char(scorers_close_at(m) at time zone 'Europe/Rome', 'HH24:MI') as ora,
       (scorers_close_at(m) at time zone 'Europe/Rome')::date - (result_opens_at(m) at time zone 'Europe/Rome')::date as giorni_dopo
from matches m where id = mid();

\echo '--- 2) partita già chiusa (mezzanotte passata) ma prima delle 12: P2 inserisce ancora i suoi gol'
update matches set locked = true, status = 'played' where id = mid();
set role authenticated; select as_user('P2'), save_scorers(mid(), jsonb_build_array(jsonb_build_object('user_id', pid('P2'), 'goals', 1, 'own_goals', 1))); reset role;
select goals, own_goals, set_by_leader from scorers where user_id = pid('P2');

\echo '--- 3) dopo le 12 del giorno dopo: P3 non può (atteso 1 errore), il Leader sì'
update matches set starts_at = now() - interval '3 days', bookings_close_at = now() - interval '4 days' where id = mid();
\set ON_ERROR_STOP 0
set role authenticated; select as_user('P3'), save_scorers(mid(), jsonb_build_array(jsonb_build_object('user_id', pid('P3'), 'goals', 1))); reset role;
\set ON_ERROR_STOP 1
set role authenticated; select as_user('P1'), save_scorers(mid(), jsonb_build_array(jsonb_build_object('user_id', pid('P3'), 'goals', 1)))::text as leader_ok; reset role;
select (select n from ids where id = user_id) as chi, goals, own_goals, set_by_leader from scorers where match_id = mid() order by 1;
