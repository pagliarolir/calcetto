\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,14) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function cfg(players int, mode text) returns jsonb language sql as $$
  select jsonb_build_object('players_per_team', players, 'team_a_kit', 'white', 'team_b_kit', 'black', 'booking_open_days', 3, 'booking_open_time', '12:00',
    'booking_close_days', 0, 'booking_close_time', '17:00', 'votes_open_after_min', 30, 'votes_hours', 48, 'booking_mode', mode) $$;
grant execute on function as_user(text), pid(text), cfg(int, text) to authenticated;

\echo '--- 1) predefinita: in ordine di arrivo'
select booking_mode as predefinita from app_settings; select booking_mode as partita_esistente from matches;

\echo '--- 2) partita "sceglie il Leader" 6 contro 6: chi dice ci sono diventa disponibile, senza numero'
set role authenticated; select as_user('P1');
select leader_create_matches(array[current_date + 20], '20:00', cfg(6, 'free'), false) is not null;
reset role;
create temp table fm as select id from matches where booking_mode = 'free'; grant select on fm to authenticated;
create function fm() returns uuid language sql as $$ select id from fm $$; grant execute on function fm() to authenticated;
update matches set bookings_open_at = now() - interval '1 hour', starts_at = now() + interval '2 days', bookings_close_at = now() + interval '1 day' where id = fm();
set role authenticated;
select as_user('P'||g), book(fm(), 'present') from generate_series(2,12) g;
select as_user('P13'), book(fm(), 'absent');
reset role;
select list, count(*), count(slot) as con_numero from booking_board where match_id = fm() group by list order by list;

\set ON_ERROR_STOP 0
\echo '--- 3) casi vietati (attesi 3 errori): risposta Riserva, giocatore che sceglie, Leader che sceglie chi non e disponibile'
set role authenticated;
select as_user('P3'), book(fm(), 'reserve');
select as_user('P2'), leader_assign(fm(), pid('P3'), 'team');
select as_user('P1'), leader_assign(fm(), pid('P13'), 'team');
\set ON_ERROR_STOP 1

\echo '--- 4) il Leader sceglie 11 titolari (con lui 12 su 12); il dodicesimo disponibile non entra (atteso errore)'
select as_user('P1'), leader_assign(fm(), pid('P'||g), 'team') from generate_series(2,12) g;
select as_user('P14'), book(fm(), 'present');
\set ON_ERROR_STOP 0
select as_user('P1'), leader_assign(fm(), pid('P14'), 'team');
\set ON_ERROR_STOP 1
reset role;
select count(*) filter (where kind like 'lists%') as avvisi_prima_della_conferma from notifications;

\echo '--- 5) conferma: chi resta disponibile diventa riserva, avvisi a tutti, prenotazioni chiuse'
set role authenticated; select as_user('P1');
select leader_confirm_lists(fm()) as esito;
reset role;
select list, count(*) from bookings where match_id = fm() group by list order by list;
select title, count(*) from notifications where kind = 'lists_confirmed' group by title order by title;
select bookings_close_at <= now() as chiuse from matches where id = fm();
\set ON_ERROR_STOP 0
set role authenticated;
select as_user('P14'), book(fm(), 'absent');
select as_user('P1'), leader_confirm_lists(fm());
\set ON_ERROR_STOP 1

\echo '--- 6) dopo la conferma ogni cambio avvisa solo l interessato'
select as_user('P1'), leader_assign(fm(), pid('P12'), 'reserve');
select as_user('P1'), leader_assign(fm(), pid('P14'), 'team');
reset role;
select (select n from ids where id = user_id) as a_chi, title from notifications where kind = 'lists_changed' order by 1;

\echo '--- 7) azzerando un titolare nessuna riserva sale da sola'
update matches set bookings_close_at = now() + interval '1 day' where id = fm();
set role authenticated; select as_user('P1');
select leader_reset_booking(fm(), pid('P2'));
reset role;
select count(*) filter (where list = 'team') as titolari, count(*) filter (where list = 'reserve') as riserve from bookings where match_id = fm();

\echo '--- 8) da 6 a 5 contro 5: il titolare in eccesso torna disponibile'
set role authenticated; select as_user('P1');
select update_matches_config(array[fm()], cfg(5, 'free'), array['players_per_team'], null);
reset role;
select count(*) filter (where list = 'team') as titolari, count(*) filter (where list = 'pending') as disponibili from bookings where match_id = fm();

\echo '--- 9) passaggio a "in ordine di arrivo": lista ricostruita nell ordine delle risposte'
set role authenticated; select as_user('P1');
select update_matches_config(array[fm()], cfg(5, 'order'), array['booking_mode'], null);
reset role;
select string_agg(i.n, ' ' order by bb.slot) filter (where bb.list = 'team') as squadra_in_ordine,
       string_agg(i.n || '=' || bb.slot, ' ' order by bb.slot) filter (where bb.list = 'reserve') as riserve
from booking_board bb join ids i on i.id = bb.user_id where bb.match_id = fm();
select lists_confirmed_at is null as conferma_azzerata from matches where id = fm();

\echo '--- 10) e di nuovo a "sceglie il Leader": tutti disponibili tranne il Leader'
set role authenticated; select as_user('P1');
select update_matches_config(array[fm()], cfg(5, 'free'), array['booking_mode'], null);
reset role;
select list, count(*) from bookings where match_id = fm() and list <> 'out' group by list order by list;

\echo '--- 11) chiusura anticipata e riapertura (partita in ordine di arrivo)'
create temp table om as select id from matches where booking_mode = 'order' order by starts_at limit 1; grant select on om to authenticated;
update matches set bookings_open_at = now() - interval '1 hour', starts_at = now() + interval '3 days', bookings_close_at = now() + interval '2 days' where id = (select id from om);
set role authenticated; select as_user('P1');
select leader_close_bookings((select id from om));
\set ON_ERROR_STOP 0
select as_user('P5'), book((select id from om), 'present');
\set ON_ERROR_STOP 1
select as_user('P1'), leader_reopen_bookings((select id from om));
select as_user('P5'), (book((select id from om), 'present'))->>'list' as dopo_la_riapertura;
