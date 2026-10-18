\set ON_ERROR_STOP 1
\pset footer off
\i seed_demo.sql
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant select on ids to authenticated; grant execute on function as_user(text), pid(text) to authenticated;
-- riepilogo di un giocatore dalla classifica
create function riga(p text) returns text language sql as $$
  select played || ' partite, ' || wins || 'V, ' || goals || ' gol, voto ' || coalesce(avg_vote::text, '-') || ', presenze ' || attendances
  from stats_table() where user_id = pid(p) $$;
grant execute on function riga(text) to authenticated;
set role authenticated; select as_user('Marco');

\echo '--- 0) situazione di partenza'
select riga('Davide') as davide, riga('Simone') as simone, (select sum(played) from stats_table()) as presenze_totali;

\echo '--- 1) azzerato Davide: lui riparte da zero, Simone invariato'
select reset_stats(pid('Davide'));
select riga('Davide') as davide, riga('Simone') as simone, (select count(*) from player_history(pid('Davide'))) as storico_davide;
\echo '--- 2) ripristinato Davide: torna come prima'
select restore_stats(pid('Davide'));
select riga('Davide') as davide;

\echo '--- 3) azzerata tutta la classifica: tutti a zero, registro presenze vuoto; poi ripristino'
select reset_stats(null);
select (select sum(played) from stats_table()) as presenze_totali, (select count(*) from attendance_register()) as registro, stats_reset_info()->>'global' is not null as data_azzeramento;
select restore_stats(null);
select (select sum(played) from stats_table()) as presenze_totali_ripristinate;

\echo '--- 4) azzeramento di 10 giorni fa: conta solo la partita della settimana scorsa'
reset role; update app_settings set stats_since = now() - interval '10 days'; set role authenticated; select as_user('Marco');
select max(played) as max_partite_per_giocatore, count(*) filter (where played > 0) as giocatori_con_partite from stats_table();
reset role; update app_settings set stats_since = null; set role authenticated; select as_user('Marco');

\set ON_ERROR_STOP 0
\echo '--- 5) casi vietati (attesi 3 errori): conferma sbagliata, giocatore normale che azzera, giocatore normale che elimina tutto'
select delete_player_stats(pid('Davide'), 'ok');
select as_user('Paolo'), reset_stats(pid('Davide'));
select as_user('Paolo'), delete_all_stats('elimina');
\set ON_ERROR_STOP 1
select as_user('Marco');

\echo '--- 6) eliminate le statistiche di Davide: le sue a zero, quelle degli altri identiche'
select delete_player_stats(pid('Davide'), ' Elimina ') as eliminati;
select riga('Davide') as davide, riga('Simone') as simone_invariato;
reset role;
select (select count(*) from lineup where user_id = pid('Davide')) as davide_in_formazione,
       (select count(*) from player_votes where voter_id = pid('Davide')) as voti_dati_da_davide_conservati,
       (select count(*) from results) as risultati_conservati,
       (select count(*) from notifications where kind = 'stats_deleted' and user_id = pid('Davide')) as avviso_a_davide;
set role authenticated; select as_user('Marco');

\echo '--- 7) eliminato tutto lo storico: partite giocate cancellate, quella in programma resta'
select delete_all_stats('elimina') as partite_eliminate;
reset role;
select count(*) filter (where status = 'played') as giocate, count(*) filter (where status = 'scheduled') as in_programma,
       (select count(*) from results) as risultati, (select count(*) from player_votes) as voti,
       (select count(distinct user_id) from notifications where kind = 'stats_deleted_all') as avvisati
from matches;
