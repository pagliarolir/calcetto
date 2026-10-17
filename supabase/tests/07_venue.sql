\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,6) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
grant execute on function as_user(text), mid() to authenticated;
update matches set bookings_open_at = now() - interval '1 day', starts_at = now() + interval '3 days', bookings_close_at = now() + interval '3 days';
set role authenticated;
select as_user('P'||g), book(mid(), 'present') from generate_series(2,4) g;
select as_user('P5'), book(mid(), 'reserve');

\echo '--- 1) prima impostazione come campo abituale, link senza https: atteso https aggiunto, nessun avviso'
select as_user('P1'), set_match_venue(mid(), '  Centro Sportivo Aurora ', 'Via dei Campi 12, Torino', 'www.aurora-calcetto.it', true);
reset role;
select venue_name, venue_address, venue_url from matches where id = mid();
select venue_name as abituale from app_settings;
select count(*) as avvisi_cambio from notifications where kind = 'venue_changed';

\echo '--- 2) una nuova partita eredita il campo abituale'
select create_match(now() + interval '10 days') is not null as creata;
select venue_name, venue_url from matches where id <> mid() order by starts_at desc limit 1;

\echo '--- 3) cambio solo per questa partita: avvisati squadra e riserve (non il Leader), abituale invariato'
set role authenticated;
select as_user('P1'), set_match_venue(mid(), 'Palestra Comunale', 'Corso Francia 5', null, false);
reset role;
select string_agg((select n from ids where id = user_id), ', ' order by 1) as avvisati, min(body) as testo from notifications where kind = 'venue_changed';
select venue_name as abituale_invariato from app_settings;

\echo '--- 4) campo svuotato: avviso con "un campo da definire"'
set role authenticated;
select as_user('P1'), set_match_venue(mid(), '', '', '', false);
reset role;
select body from notifications where kind = 'venue_changed' order by id desc limit 1;

\set ON_ERROR_STOP 0
\echo '--- 5) casi vietati (attesi 3 errori): giocatore normale, link javascript, link con spazi'
set role authenticated;
select as_user('P3'), set_match_venue(mid(), 'X', null, null, false);
select as_user('P1'), set_match_venue(mid(), 'X', null, 'javascript:alert(1)', false);
select as_user('P1'), set_match_venue(mid(), 'X', null, 'www.sito con spazi.it', false);
\echo '--- 6) link con porta senza schema (atteso accettato e completato con https)'
select as_user('P1'), set_match_venue(mid(), 'X', null, 'circolo.it:8080/prenota', false);
reset role;
select venue_url from matches where id = mid();
