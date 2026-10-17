\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,14) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
create or replace view board as select bb.slot, i.n, bb.list from booking_board bb join ids i on i.id = bb.user_id where bb.match_id = mid() order by bb.list desc, bb.slot;
grant execute on function as_user(text), pid(text), mid() to authenticated; grant select on board to authenticated;
update matches set bookings_open_at = now() - interval '1 day', starts_at = now() + interval '3 days', bookings_close_at = now() + interval '3 days';

set role authenticated;
select as_user('P'||g), book(mid(), 'present') from generate_series(2,11) g;   -- Leader + P2..P10 in squadra, P11 riserva
select as_user('P12'), book(mid(), 'reserve');                                 -- P12 riserva volontaria
\echo '--- 1) il Leader azzera P5 (in squadra): atteso P5 sparisce, P11 sale nei 10, P12 resta riserva'
select as_user('P1'), leader_reset_booking(mid(), pid('P5'));
select * from board;
reset role;
select kind, (select n from ids where id = user_id) as a_chi, actions is not null as con_pulsanti
  from notifications where kind in ('booking_reset','promoted','late_withdrawal','need_one') order by id;
select count(*) as forfait_tardivi from bookings where late_withdrawal;

set role authenticated;
\echo '--- 2) azzera la riserva P12: atteso squadra invariata, P12 senza risposta'
select as_user('P1'), leader_reset_booking(mid(), pid('P12'));
select count(*) filter (where list = 'team') as squadra, count(*) filter (where list = 'reserve') as riserve from bookings where match_id = mid();

\set ON_ERROR_STOP 0
\echo '--- 3) casi vietati (attesi 3 errori): Leader titolare, giocatore normale, chi non ha risposto'
select as_user('P1'), leader_reset_booking(mid(), pid('P1'));
select as_user('P3'), leader_reset_booking(mid(), pid('P4'));
select as_user('P1'), leader_reset_booking(mid(), pid('P13'));
\set ON_ERROR_STOP 1

\echo '--- 4) squadra da 10 senza riserve: azzerando P6 si scende a 9, parte "manca un giocatore" (non a P6)'
select as_user('P1'), leader_reset_booking(mid(), pid('P6'));
reset role;
select count(*) as squadra from bookings where match_id = mid() and list = 'team';
select count(*) as avvisi_manca_uno, bool_or(user_id = pid('P6')) as anche_a_p6 from notifications where kind = 'need_one';

\echo '--- 5) formazioni ufficiali: azzerando P7 esce dalle squadre e i partecipanti sono avvisati'
insert into lineup (match_id, user_id, team) select mid(), user_id, case when row_number() over (order by user_id) % 2 = 0 then 'white' else 'black' end
  from bookings where match_id = mid() and list = 'team';
update matches set lineup_status = 'official' where id = mid();
set role authenticated;
select as_user('P1'), leader_reset_booking(mid(), pid('P7'));
reset role;
select count(*) as p7_nelle_squadre from lineup where match_id = mid() and user_id = pid('P7');
select count(*) > 0 as avviso_variazione from notifications where kind = 'lineup_change';

\echo '--- 6) P5, azzerato, risponde di nuovo: entra come ultimo arrivato'
set role authenticated;
select as_user('P5'), book(mid(), 'present');
reset role;
select list as p5_ora, (select slot from booking_board where match_id = mid() and user_id = pid('P5')) as numero from bookings where match_id = mid() and user_id = pid('P5');

\echo '--- 7) prenotazioni non ancora aperte: avviso senza pulsanti, con la data di apertura'
update matches set bookings_open_at = now() + interval '1 day' where id = mid();
set role authenticated;
select as_user('P1'), leader_reset_booking(mid(), pid('P8'));
reset role;
select title, actions is null as senza_pulsanti, body like '%Potrai rispondere%' as con_data
  from notifications where kind = 'booking_reset' and user_id = pid('P8');
