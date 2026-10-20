\set ON_ERROR_STOP 1
\pset footer off
\i seed_demo.sql
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant select on ids to authenticated; grant execute on function as_user(text), pid(text) to authenticated;

\echo '--- 1) il Leader assegna e toglie punti; ognuno riceve un avviso'
set role authenticated; select as_user('Marco');
select award_leader_points(pid('Davide'), 10, 'Gol in rovesciata') is not null as primo;
select award_leader_points(pid('Davide'), -5, 'Ritardo di venti minuti') is not null as secondo;
select award_leader_points(pid('Luca'), 99, 'Ha portato i palloni nuovi') is not null as terzo;
\set ON_ERROR_STOP 0
\echo '--- 2) casi vietati (attesi 5 errori): 100 punti, zero punti, senza motivazione, giocatore normale, annullamento da giocatore normale'
select award_leader_points(pid('Davide'), 100, 'Troppi');
select award_leader_points(pid('Davide'), 0, 'Niente');
select award_leader_points(pid('Davide'), 5, '   ');
select as_user('Paolo'), award_leader_points(pid('Paolo'), 99, 'Me li do da solo');
select as_user('Paolo'), delete_leader_points((select min(id) from leader_points));
\set ON_ERROR_STOP 1

\echo '--- 3) classifica e storico visibili a un giocatore normale'
select as_user('Paolo');
select (select n from ids where id = t.user_id) as giocatore, total, awards from leader_points_table() t;
select count(*) as righe_di_storico_viste_da_paolo from leader_points;
reset role;
select count(*) as avvisi, string_agg(title, ' | ' order by id) as titoli from notifications where kind = 'leader_points';

\echo '--- 4) il Leader annulla un assegnazione: Davide torna a 10'
set role authenticated; select as_user('Marco');
select delete_leader_points((select id from leader_points where points = -5));
select total as davide from leader_points_table() where user_id = pid('Davide');

\echo '--- 5) squadre per colore: ogni partita conta due volte (una per lato), vittorie e sconfitte si bilanciano'
select kit, played, wins, draws, losses from team_kit_stats();
select sum(played) = 2 * (select count(*) from results where status = 'homologated') as lati_giusti,
       sum(wins) = sum(losses) as vittorie_uguali_sconfitte from team_kit_stats();

\echo '--- 6) bilancio per colore di ogni giocatore: coincide con le partite della classifica'
select bool_and(k.played = s.played) as coincide_per_tutti
from (select user_id, sum(played) as played from player_kit_stats() group by user_id) k
join stats_table() s using (user_id);

\echo '--- 7) coppie: totali uguali a quelli calcolati dalle formazioni'
reset role;
create temp table attesi as
  select sum(w * (w - 1) / 2 + b * (b - 1) / 2) as compagni, sum(w * b) as avversari
  from (select l.match_id, count(*) filter (where l.team = 'white') as w, count(*) filter (where l.team = 'black') as b
        from lineup l join results r on r.match_id = l.match_id and r.status = 'homologated' group by l.match_id) x;
grant select on attesi to authenticated;
set role authenticated; select as_user('Marco');
select (select sum(together) from pair_stats()) = (select compagni from attesi) as compagni_giusti,
       (select sum(against) from pair_stats()) = (select avversari from attesi) as avversari_giusti,
       (select bool_and(together_wins + together_draws <= together and a_wins + b_wins + against_draws = against) from pair_stats()) as conti_coerenti;
select (select n from ids where id = a_id) || ' e ' || (select n from ids where id = b_id) as coppia_piu_frequente_da_compagni, together, together_wins
from pair_stats() order by together desc, together_wins desc limit 1;

\echo '--- 8) azzeramento della classifica: squadre e coppie vuote, punti Leader intatti; poi ripristino'
select reset_stats(null);
select (select count(*) from team_kit_stats()) as squadre, (select count(*) from pair_stats()) as coppie, (select sum(total) from leader_points_table()) as punti_leader;
select restore_stats(null);
select (select count(*) from pair_stats()) > 0 as coppie_ripristinate;

\echo '--- 9) giocatore senza account con punti Leader: collegandosi, i punti passano all account'
select award_leader_points(create_guest('Ospite'), 7, 'Primo allenamento') is not null;
reset role;
update profiles set invite_token = 'tokentest', invite_expires_at = now() + interval '1 day' where first_name = 'Ospite' and guest;
insert into auth.users (email, raw_user_meta_data) values ('ospite@x.it', '{"first_name": "Ospite", "link_token": "tokentest"}');
select (select count(*) from profiles where first_name = 'Ospite' and guest) as profilo_senza_account_rimasto,
       (select sum(points) from leader_points lp join auth.users u on u.id = lp.user_id where u.email = 'ospite@x.it') as punti_sull_account;
