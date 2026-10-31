\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,16) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function ids_of(variadic p text[]) returns uuid[] language sql as $$ select array_agg(pid(x) order by o) from unnest(p) with ordinality a(x, o) $$;
create function nm(u uuid) returns text language sql as $$ select n from ids where id = u $$;
grant execute on function as_user(text), pid(text), ids_of(text[]), nm(uuid) to authenticated;
delete from matches;

\echo '=== Fase 2: il Leader prepara il FantaLeader'
set role authenticated; select as_user('P1');
select fl_save_player(pid('P'||g), true, 10, null) from generate_series(1,16) g;
select fl_link_preset('leader', pid('P1')); select fl_link_preset('manuel', pid('P2')); select fl_link_preset('robertone', pid('P3'));
select fl_link_preset('bobo', pid('P4'));   select fl_link_preset('ben', pid('P5'));    select fl_link_preset('bog', pid('P6'));
select fl_link_preset('gl', pid('P7'));
select fl_set_market(true);
reset role;
select nm(user_id) as giocatore, price_initial as quotazione, preset_code as scheda, (select count(*) from fl_player_skills s where s.user_id = f.user_id) as skill
from fl_players f where preset_code is not null order by price_initial desc, 1;

\echo '--- test 5: solo il Leader cambia quotazioni, descrizioni, skill e mercato (attesi 4 errori)'
\set ON_ERROR_STOP 0
set role authenticated; select as_user('P8');
select fl_save_player(pid('P8'), true, 1, 'mi metto a 1');
select fl_save_skill((select id from fl_skills where code = 'manuel+'), 'x', 'pos', 'x', '{"to":"self","amount":99}', true);
select fl_set_player_skills(pid('P8'), array[(select id from fl_skills where code = 'carlo+')]);
select fl_set_market(false);
reset role;
\set ON_ERROR_STOP 1

\echo '--- test 2, 3, 4, 6: duplicati, 5 o 7 giocatori, budget superato, capitano fuori squadra (attesi 5 errori)'
\set ON_ERROR_STOP 0
set role authenticated; select as_user('P8');
select fl_confirm_team('I Rimbalzi', ids_of('P1','P3','P3','P5','P6','P12'), pid('P1'));
select fl_confirm_team('I Rimbalzi', ids_of('P1','P3','P4','P5','P6'), pid('P1'));
select fl_confirm_team('I Rimbalzi', ids_of('P1','P3','P4','P5','P6','P12','P13'), pid('P1'));
select fl_confirm_team('I Rimbalzi', ids_of('P2','P3','P4','P5','P6','P7'), pid('P2'));
select fl_confirm_team('I Rimbalzi', ids_of('P1','P3','P4','P5','P6','P12'), pid('P9'));
reset role;
\set ON_ERROR_STOP 1

\echo '--- test 1: due allenatori scelgono lo stesso giocatore (P3, P4, P5 in entrambe)'
set role authenticated;
select as_user('P8'), fl_confirm_team('I Rimbalzi', ids_of('P1','P3','P4','P5','P6','P12'), pid('P6'));
select as_user('P9'), fl_confirm_team('Pane e Panchina', ids_of('P2','P3','P4','P5','P12','P13'), pid('P2'));
reset role;

\echo '=== Fase 4: giornata A (già giocata prima delle squadre) Bianchi 5-3 Neri'
-- Bianchi: P1 (Leader), P2 (Manuel, 0 gol), P3 (Robertone, 2 gol), P4 (Bobo, 1 gol), P6 (Bog, 2 gol)
-- Neri:    P7 (GL, 3 gol), P8 (autogol), P9, P10, P11.  P5 (Ben) assente.
insert into matches (starts_at, nominal_date, status, lineup_status) values (now() - interval '8 days', (now() - interval '8 days')::date, 'played', 'official');
create temp table mm as select id, 'A'::text as k from matches; grant select on mm to authenticated;
create function m(k text) returns uuid language sql as $$ select id from mm where mm.k = m.k $$;
grant execute on function m(text) to authenticated;
update matches set votes_opens_at = now() - interval '8 days', votes_closes_at = now() + interval '1 day' where id = m('A');
insert into lineup (match_id, user_id, team) select m('A'), pid(x), 'white' from unnest(array['P1','P2','P3','P4','P6']) x;
insert into lineup (match_id, user_id, team) select m('A'), pid(x), 'black' from unnest(array['P7','P8','P9','P10','P11']) x;
insert into scorers (match_id, user_id, goals, own_goals) values
  (m('A'), pid('P3'), 2, 0), (m('A'), pid('P4'), 1, 0), (m('A'), pid('P6'), 2, 0), (m('A'), pid('P7'), 3, 0), (m('A'), pid('P8'), 0, 1);
-- tre votanti: tutti 7, P3 prende 8
insert into player_votes (match_id, voter_id, target_id, score)
select m('A'), pid(v), l.user_id, case when l.user_id = pid('P3') then 8 else 7 end
from unnest(array['P9','P10','P11']) v join lineup l on l.match_id = m('A') and l.user_id <> pid(v);
insert into results (match_id, diff, white_goals, black_goals, status) values (m('A'), 2, 5, 3, 'homologated');
select count(*) as righe, bool_and(status = 'provisional') as provvisori from fl_points where match_id = m('A');

\echo '--- pagelle chiuse: i punti diventano definitivi'
update matches set votes_closes_at = now() - interval '1 minute' where id = m('A');
select fl_refresh() as giornate_aggiornate;
select nm(user_id) as giocatore, played as gioca, base, skills, zeroed as azzerato, coef, total as totale,
       (select string_agg(e ->> 'label' || ' ' || (e ->> 'value'), '; ') from jsonb_array_elements(breakdown) e where e ->> 'label' like 'Skill%') as skill_attivate,
       fanta
from fl_points where match_id = m('A') and user_id in (select pid(x) from unnest(array['P1','P2','P3','P4','P5','P6','P7','P8','P12']) x) order by 1;

\echo '--- test 8: ricalcolare senza cambiamenti non crea revisioni'
select fl_refresh() as giornate; select fl_compute_match(m('A'));
select coalesce(max(revision), 0) as revisione_massima, (select count(*) from fl_points_revisions) as revisioni from fl_points where match_id = m('A');

\echo '=== giornata B (dopo la creazione delle squadre): Neri 2-4 Bianchi'
-- Bianchi: P6 (Bog, 1 gol), P1, P3 (0 gol), P4 (2 gol), P12 (1 gol).  Neri: P2 (Manuel 2 gol), P7, P9, P10, P11.  P5 assente.
insert into matches (starts_at, nominal_date, status, lineup_status) values (now() + interval '1 minute', now()::date, 'played', 'official');
insert into mm select id, 'B' from matches where id not in (select id from mm);
update matches set votes_opens_at = now(), votes_closes_at = now() + interval '1 day' where id = m('B');
insert into lineup (match_id, user_id, team) select m('B'), pid(x), 'white' from unnest(array['P1','P3','P4','P6','P12']) x;
insert into lineup (match_id, user_id, team) select m('B'), pid(x), 'black' from unnest(array['P2','P7','P9','P10','P11']) x;
insert into scorers (match_id, user_id, goals) values (m('B'), pid('P6'), 1), (m('B'), pid('P4'), 2), (m('B'), pid('P12'), 1), (m('B'), pid('P2'), 2);
insert into results (match_id, diff, white_goals, black_goals, status) values (m('B'), 2, 4, 2, 'homologated');

\echo '--- test 9 e 10: coefficienti della giornata B dalla classifica dopo A (1-6 -> 1,00; 7-12 -> 1,25; 13+ -> 1,50)'
select coef, count(*) as giocatori, min(position) as da_posizione, max(position) as a_posizione
from fl_coefficients where match_id = m('B') group by coef order by coef;
select bool_and(coef = case when position <= 6 then 1.00 when position <= 12 then 1.25 else 1.50 end) as fasce_rispettate
from fl_coefficients where match_id = m('B');
update matches set votes_closes_at = now() - interval '1 second' where id = m('B');
select fl_refresh() as giornate;
select nm(user_id) as giocatore, pre, coef, total as totale, (select string_agg(e ->> 'label' || ' ' || (e ->> 'value'), '; ') from jsonb_array_elements(breakdown) e where e ->> 'label' like 'Skill%') as skill
from fl_points where match_id = m('B') and user_id in (select pid(x) from unnest(array['P2','P3','P4','P5','P6','P12']) x) order by 1;

\echo '--- test 11 e capitano: contributi delle due fantasquadre (A senza coefficienti né capitano, B con)'
select t.name, x.match_id = m('A') as giornata_a, x.points as punti, x.captain_points as punti_capitano
from fl_team_match_points() x join fl_teams t on t.id = x.team_id order by t.name, x.starts_at;
-- controllo a mano della giornata B dei Rimbalzi: capitano P6 gioca e vince -> gli altri x1,25; più le skill di fantasquadra
select round(
  (select sum(p.total * case when p.user_id = pid('P6') then 1 else 1.25 end) from fl_points p where p.match_id = m('B') and p.user_id = any (ids_of('P1','P3','P4','P5','P6','P12')))
  + (select coalesce(sum((e ->> 'amount')::numeric * case when e ->> 'to' = 'all' then 6 else 5 end), 0)
     from fl_points p, jsonb_array_elements(p.fanta) e where p.match_id = m('B') and p.user_id = any (ids_of('P1','P3','P4','P5','P6','P12'))), 2) as rimbalzi_b_a_mano;

\echo '--- classifiche'
set role authenticated; select as_user('P10');
select pos, nm(user_id) as giocatore, total as punti, last_points as ultima, played as presenze, price_initial as iniziale, price_current as attuale, next_coef as coef_prossima
from fl_player_ranking() order by pos limit 6;
select pos, name, nm(owner_id) as allenatore, total, last_points, nm(captain_id) as capitano, spent from fl_team_ranking();
reset role;

\echo '--- test 8 (correzione dopo il consolidamento): una sola revisione, e il coefficiente di B non cambia (test 10)'
create temp table coef_b as select user_id, coef from fl_coefficients where match_id = m('B');
update scorers set goals = 3 where match_id = m('A') and user_id = pid('P3');
select fl_refresh() as giornate;
select nm(user_id) as giocatore, revision, old_total, new_total from fl_points_revisions order by id;
select (select count(*) from fl_coefficients c join coef_b b using (user_id) where c.match_id = m('B') and c.coef <> b.coef) as coefficienti_cambiati;

\echo '--- quotazione attuale (dopo 2 giornate, entro ±30% dell''iniziale) e chiusura del mercato: diventa la nuova iniziale'
select nm(user_id) as giocatore, price_initial as iniziale, fl_current_price(user_id) as attuale from fl_players where user_id in (pid('P4'), pid('P6'), pid('P11')) order by 1;
set role authenticated; select as_user('P1'), fl_set_market(false); reset role;
select nm(user_id) as giocatore, price_initial as nuova_iniziale from fl_players where user_id in (pid('P4'), pid('P6'), pid('P11')) order by 1;
\set ON_ERROR_STOP 0
\echo '--- a mercato chiuso non si cambia squadra (atteso errore)'
set role authenticated; select as_user('P8'), fl_confirm_team('I Rimbalzi', ids_of('P1','P3','P4','P5','P6','P13'), pid('P6')); reset role;
\set ON_ERROR_STOP 1

\echo '--- test 12: un errore di FantaLeader non blocca le partite (fl_touch lo trasforma in un avviso)'
update fl_skills set rule = '{"to":"self","amount":"non-un-numero"}' where code = 'bobo+';
update scorers set goals = 1 where match_id = m('A') and user_id = pid('P3');
select goals as gol_registrato_comunque from scorers where match_id = m('A') and user_id = pid('P3');
\echo '--- registro delle operazioni'
select action, count(*) from fl_audit group by action order by action;
