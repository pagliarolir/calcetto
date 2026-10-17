\set ON_ERROR_STOP 1
\pset footer off
\set VERBOSITY verbose
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,7) g;
update profiles set role = 'premier1' where first_name = 'P2';
update profiles set role = 'premier2' where first_name = 'P4';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, service_role;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
grant execute on function as_user(text), pid(text), mid() to authenticated, service_role;
update matches set bookings_open_at = now() - interval '1 day', starts_at = now() + interval '10 hours', bookings_close_at = now() + interval '10 hours';
set role authenticated;
select as_user('P3'), book(mid(), 'present');

\echo '--- 1) il Leader punisce P3 per un giorno con motivo: atteso avviso a P3 e 1 partita in cui e ancora in lista'
select as_user('P1'), punish_member(pid('P3'), now() + interval '1 day', 'Ritardi continui');
reset role;
select title, body from notifications where kind = 'punished';

\set ON_ERROR_STOP 0
\echo '--- 2) P3 prova a intervenire: attesi errori GDL01 (prenotazione, chat, voti) e sicurezza sulla chat'
set role authenticated;
select as_user('P3'), book(mid(), 'absent');
select as_user('P3'), submit_votes(mid(), '[]'::jsonb, null, null);
select as_user('P3'), save_scorers(mid(), '[]'::jsonb);
update matches set starts_at = now() + interval '3 hours', bookings_close_at = now() + interval '3 hours' where id = mid();
insert into chat_messages (match_id, user_id, body) values (mid(), pid('P3'), 'ciao');
\echo '--- 3) le funzioni originali non sono richiamabili direttamente (atteso: permesso negato)'
select as_user('P3'), book_unchecked(mid(), 'absent');
reset role;
\echo '--- 4) azione rapida dalla notifica (come la Edge Function): atteso GDL01'
set role service_role;
select quick_action(pid('P3'), mid(), 'absent');
reset role;
\set ON_ERROR_STOP 1

\echo '--- 5) P3 legge ancora: partite, prenotazioni, statistiche; e puo cambiare il soprannome'
set role authenticated;
select as_user('P3');
select (select count(*) from matches) > 0 as legge_partite, (select count(*) from bookings) > 0 as legge_prenotazioni,
       (select count(*) from stats_table()) > 0 as legge_statistiche, my_punishment()->>'reason' as motivo_che_vede;
update profiles set nickname = 'Pentito' where id = pid('P3');
reset role;
select nickname from profiles where id = pid('P3');

\echo '--- 6) gli inviti non gli arrivano, le informazioni si'
select notify(array[pid('P3'), pid('P5')], 'booking_open', 'Si gioca', 'Ci sei?');
select notify(array[pid('P3')], 'match_moved', 'La partita si sposta', 'Nuovo orario');
select (select n from ids where id = user_id) as a_chi, kind from notifications where kind in ('booking_open','match_moved') order by kind, 1;

\echo '--- 7) Premier punito: perde i poteri; e se il Leader e inattivo la leadership salta a P4'
set role authenticated;
select as_user('P1'), punish_member(pid('P2'), null, null);
select as_user('P2'); select is_staff() as p2_staff, has_leader_powers() as p2_leader;
reset role;
update profiles set last_seen_at = now() - interval '20 days' where id = pid('P1');
select (select n from ids where id = acting_leader()) as comanda_ora;
update profiles set last_seen_at = now() where id = pid('P1');

\set ON_ERROR_STOP 0
\echo '--- 8) casi vietati (attesi 3 errori): punire il Leader, se stessi, punire da giocatore normale'
set role authenticated;
select as_user('P1'), punish_member(pid('P1'), null, null);
select as_user('P5'), punish_member(pid('P6'), null, null);
select as_user('P4'), punish_member(pid('P1'), null, null);
\set ON_ERROR_STOP 1

\echo '--- 9) lo staff vede le punizioni in corso; un giocatore no'
select as_user('P4'); select count(*) as viste_da_premier from active_punishments();
select as_user('P5'); select count(*) as viste_da_giocatore from active_punishments();

\echo '--- 10) scadenza naturale: P3 torna libero e si prenota'
reset role;
update punishments set ends_at = now() - interval '1 second' where user_id = pid('P3');
set role authenticated;
select as_user('P3'); select is_punished() as ancora_punito;
select (book(mid(), 'absent'))->>'list' as p3_risponde;

\echo '--- 11) revoca del Leader: P2 riprende i poteri e riceve l avviso'
select as_user('P1'), pardon_member(pid('P2'));
select as_user('P2'); select is_staff() as p2_staff_di_nuovo;
reset role;
select title from notifications where kind = 'pardoned';
