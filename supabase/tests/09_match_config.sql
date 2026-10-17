\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,15) g;
update profiles set role = 'premier1' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function cfg(players int, a text, b text) returns jsonb language sql as $$
  select jsonb_build_object('players_per_team', players, 'team_a_kit', a, 'team_b_kit', b, 'booking_open_days', 3, 'booking_open_time', '12:00',
                            'booking_close_days', 0, 'booking_close_time', '17:00', 'votes_open_after_min', 30, 'votes_hours', 48) $$;
create function loc(t timestamptz) returns text language sql as $$ select to_char(t at time zone 'Europe/Rome', 'DD/MM HH24:MI') $$;
grant execute on function as_user(text), pid(text), cfg(int, text, text), loc(timestamptz) to authenticated;

\echo '--- 1) la partita esistente prende la configurazione predefinita (attesi 5, white, black, voti 1h30 dopo l inizio)'
select players_per_team, team_a_kit, team_b_kit, booking_close_time, votes_opens_at - starts_at as voti_dopo_inizio, votes_closes_at - votes_opens_at as durata_voti from matches;

\echo '--- 2) il Leader crea una partita 6 contro 6, Rossi contro Blu, orari personalizzati'
set role authenticated;
select as_user('P1'), leader_create_matches(array[current_date + 9], '21:00',
  '{"players_per_team":6,"team_a_kit":"red","team_b_kit":"blue","booking_open_days":2,"booking_open_time":"10:00","booking_close_days":1,"booking_close_time":"22:00","votes_open_after_min":60,"votes_hours":24}', false)->'skipped' as saltate;
reset role;
create temp table m6 as select id from matches where players_per_team = 6; grant select on m6 to authenticated;
create function m6() returns uuid language sql as $$ select id from m6 $$; grant execute on function m6() to authenticated;
select loc(starts_at) as inizio, loc(bookings_open_at) as apertura, loc(bookings_close_at) as chiusura,
       votes_opens_at - starts_at as voti_dopo_inizio, votes_closes_at - votes_opens_at as durata_voti,
       team_name(m, 'white') || ' contro ' || team_name(m, 'black') as squadre,
       exists (select 1 from bookings b where b.match_id = m.id and b.user_id = pid('P1')) as leader_numero_1
from matches m where id = m6();
select (current_date + 9 - 2)::text || ' 10:00 e ' || (current_date + 9 - 1)::text || ' 22:00' as attesi;

\echo '--- 3) serie: data doppia e data passata saltate; ora locale 20:00 anche oltre il cambio di ora legale'
set role authenticated;
select as_user('P1'), leader_create_matches(array[current_date + 9, current_date + 16, current_date + 200, current_date - 1], '20:00', cfg(5, 'white', 'black'), false) as esito;
reset role;
select count(*) as create, string_agg(distinct to_char(starts_at at time zone 'Europe/Rome', 'HH24:MI'), ',') as ora_locale,
       string_agg(to_char(starts_at at time zone 'UTC', 'HH24:MI'), ' e ' order by starts_at) as in_utc
from matches where nominal_date in (current_date + 16, current_date + 200);

\echo '--- 4) 6 contro 6: posti dal 1 al 12, riserve dal 13'
update matches set bookings_open_at = now() - interval '1 hour', starts_at = now() + interval '2 days', bookings_close_at = now() + interval '1 day' where id = m6();
set role authenticated;
select as_user('P'||g), book(m6(), 'present') from generate_series(2,13) g;
reset role;
create or replace view board6 as select bb.slot, i.n, bb.list from booking_board bb join ids i on i.id = bb.user_id where bb.match_id = (select id from m6) order by bb.list desc, bb.slot;
select string_agg(n || '=' || slot, ' ' order by slot) filter (where list = 'team') as squadra,
       string_agg(n || '=' || slot, ' ' order by slot) filter (where list = 'reserve') as riserve from board6;

\echo '--- 5) Leader assente: squadra dal 2 al 13, riserve dal 14'
set role authenticated;
select as_user('P1'), book(m6(), 'absent');
select as_user('P14'), book(m6(), 'present');
reset role;
select min(slot) filter (where list = 'team') as primo, max(slot) filter (where list = 'team') as ultimo,
       string_agg(n || '=' || slot, ' ') filter (where list = 'reserve') as riserve from board6;

\echo '--- 6) prenotazioni chiuse: il giocatore no (atteso errore), il Leader si'
update matches set bookings_close_at = now() - interval '1 minute' where id = m6();
\set ON_ERROR_STOP 0
set role authenticated;
select as_user('P14'), book(m6(), 'absent');
\set ON_ERROR_STOP 1
select as_user('P1'), leader_book(m6(), pid('P14'), 'absent');
reset role;
update matches set bookings_close_at = now() + interval '1 day' where id = m6();

\echo '--- 7) da 6 a 5 contro 5: gli ultimi arrivati scendono tra le riserve con avviso'
set role authenticated;
select as_user('P1'), update_matches_config(array[m6()], cfg(5, 'red', 'blue'), array['players_per_team'], null) as aggiornate;
reset role;
select count(*) filter (where list = 'team') as squadra, count(*) filter (where list = 'reserve') as riserve from bookings where match_id = m6();
select count(*) as avvisi_retrocessi from notifications where kind = 'demoted';

\echo '--- 8) da 5 a 7 contro 7: le riserve salgono'
set role authenticated;
select as_user('P1'), update_matches_config(array[m6()], cfg(7, 'red', 'blue'), array['players_per_team'], null);
reset role;
select count(*) filter (where list = 'team') as squadra, count(*) filter (where list = 'reserve') as riserve from bookings where match_id = m6();

\echo '--- 9) posizioni in campo: 7 ammessa, 8 no con 7 contro 7 (atteso un errore)'
insert into lineup (match_id, user_id, team, field_slot) values (m6(), pid('P2'), 'white', 7);
\set ON_ERROR_STOP 0
insert into lineup (match_id, user_id, team, field_slot) values (m6(), pid('P3'), 'white', 8);
\set ON_ERROR_STOP 1

\echo '--- 10) colori cambiati in Verdi e Arancioni: gli avvisi usano i nuovi nomi'
set role authenticated;
select as_user('P1'), update_matches_config(array[m6()], cfg(7, 'green', 'orange'), array['kits'], null);
reset role;
select announce_lineup(m6(), false);
select body from notifications where kind = 'lineup_official' and user_id = pid('P2');
update matches set starts_at = now() - interval '2 hours' where id = m6();
set role authenticated;
select as_user('P2'), submit_result(m6(), null, 3, 2);
reset role;
select title from notifications where kind = 'result_review' limit 1;

\echo '--- 11) votazioni aperte piu tardi: prima dell orario si vota no (atteso errore)'
update matches set votes_open_after_min = 600 where id = m6();
select loc(votes_opens_at) as voti_da, votes_opens_at > now() as ancora_chiuse from matches where id = m6();
\set ON_ERROR_STOP 0
set role authenticated;
select as_user('P2'), submit_votes(m6(), '[]'::jsonb, null, null);
reset role;
\set ON_ERROR_STOP 1

\echo '--- 12) scheduler: avviso del risultato subito, pagelle solo all orario delle votazioni'
update matches set sent_result = false, sent_votes = false where id = m6();
select run_scheduler();
select count(*) filter (where kind = 'result_open') as risultato, count(*) filter (where kind = 'votes_open') as pagelle from notifications where match_id = m6();
update matches set votes_opens_at = now() - interval '1 minute' where id = m6();
select run_scheduler();
select count(*) filter (where kind = 'votes_open') as pagelle_dopo from notifications where match_id = m6();

\echo '--- 13) con partite in programma lo scheduler non ne crea altre'
select count(*) as prima from matches; select run_scheduler(); select count(*) as dopo from matches;

\echo '--- 14) spostare una partita mantiene le sue regole (apertura 2 giorni prima alle 10:00)'
set role authenticated;
select as_user('P1'), leader_create_matches(array[current_date + 30], '20:00',
  '{"players_per_team":5,"team_a_kit":"white","team_b_kit":"black","booking_open_days":2,"booking_open_time":"10:00","booking_close_days":0,"booking_close_time":"17:00","votes_open_after_min":30,"votes_hours":48}', false);
select as_user('P1'), move_match((select id from matches where nominal_date = current_date + 30), ((current_date + 33) + time '19:00') at time zone 'Europe/Rome');
reset role;
select loc(starts_at) as nuova_data, loc(bookings_open_at) as apertura from matches where nominal_date = current_date + 30;

\echo '--- 15) configurazione predefinita: la usano le nuove partite automatiche'
set role authenticated;
select as_user('P1'), update_default_match_config(cfg(8, 'yellow', 'purple'), 2, '19:30');
reset role;
select players_per_team, team_a_kit, team_b_kit, game_weekday, game_time from app_settings;
create temp table nuova as select create_match(now() + interval '60 days') as id;
select players_per_team, team_a_kit, team_b_kit from matches where id = (select id from nuova);

\set ON_ERROR_STOP 0
\echo '--- 16) casi vietati (attesi 4 errori): giocatore normale, stessi colori, chiusura prima dell apertura, 9 contro 9'
set role authenticated;
select as_user('P5'), leader_create_matches(array[current_date + 40], '20:00', cfg(5, 'white', 'black'), false);
select as_user('P1'), leader_create_matches(array[current_date + 40], '20:00', cfg(5, 'red', 'red'), false);
select as_user('P1'), leader_create_matches(array[current_date + 40], '20:00', cfg(5, 'white', 'black') || '{"booking_open_days":0,"booking_open_time":"18:00"}', false);
select as_user('P1'), leader_create_matches(array[current_date + 40], '20:00', cfg(9, 'white', 'black'), false);
