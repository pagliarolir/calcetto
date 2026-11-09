\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,12) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function nm(u uuid) returns text language sql as $$ select n from ids where id = u $$;
grant execute on function as_user(text), pid(text), nm(uuid) to authenticated;
delete from matches;
do $$ begin execute 'load ''safeupdate'''; exception when others then raise notice 'safeupdate non disponibile: test senza il controllo di Supabase'; end $$;   -- come le richieste dell'app su Supabase (se la libreria c'è)

set role authenticated; select as_user('P1');
select fl_save_player(pid('P'||g), true, 10, null) from generate_series(1,12) g;
select fl_link_preset('leader', pid('P1')); select fl_link_preset('vincenzo', pid('P2')); select fl_link_preset('max', pid('P3'));
select fl_set_visibility(true, '{}'); select fl_set_market(true);
reset role;
select (params ->> 'win') as vittoria, (params ->> 'loss') as sconfitta, (params ->> 'mvp') as migliore, params -> 'coef_bands' as fasce, rules_version from fl_settings;
select code, rule from fl_skills where code in ('vincenzo+', 'vincenzo-', 'max-', 'leader+') order by code;

\echo '--- 1) nessuno sceglie sé stesso (atteso errore)'
\set ON_ERROR_STOP 0
set role authenticated; select as_user('P4'), fl_confirm_team('Io e gli altri', array[pid('P4'),pid('P5'),pid('P6'),pid('P7'),pid('P8'),pid('P9')], pid('P5')); reset role;
\set ON_ERROR_STOP 1

\echo '--- 2) partita: Bianchi P2 (Vincenzo), P5, P6, P7, P8 perdono 4-9 contro Neri P3 (Max, 0 gol), P9, P10, P11, P12... no: Max nei Bianchi'
-- Bianchi: P2 (Vincenzo), P3 (Max, 0 gol), P5, P6, P7 -> perdono 4-9 (subiscono 9 > 8)
-- Neri: P8, P9, P10, P11, P12.  P1 (Leader) assente: la sua skill non vale
insert into matches (starts_at, nominal_date, status, lineup_status) values (now() - interval '3 days', (now() - interval '3 days')::date, 'played', 'official');
create temp table mm as select id from matches; grant select on mm to authenticated;
insert into lineup (match_id, user_id, team) select (select id from mm), pid(x), 'white' from unnest(array['P2','P3','P5','P6','P7']) x;
insert into lineup (match_id, user_id, team) select (select id from mm), pid(x), 'black' from unnest(array['P8','P9','P10','P11','P12']) x;
insert into scorers (match_id, user_id, goals) values ((select id from mm), pid('P2'), 4), ((select id from mm), pid('P8'), 9);
-- sei votanti su dieci: il migliore in campo (P8, scelto da tutti) si scopre
insert into player_votes (match_id, voter_id, target_id, score)
select (select id from mm), pid(v), l.user_id, 6 from unnest(array['P9','P10','P11','P12','P5','P6']) v join lineup l on l.match_id = (select id from mm) and l.user_id <> pid(v);
insert into mvp_votes (match_id, voter_id, black_pick, white_pick)
select (select id from mm), pid(v), case when pid(v) <> pid('P8') then pid('P8') end, pid('P2') from unnest(array['P9','P10','P11','P12','P5','P6']) v;
update matches set mvp_mode = 'single', votes_opens_at = now() - interval '3 days', votes_closes_at = now() - interval '1 minute' where id = (select id from mm);
insert into results (match_id, diff, white_goals, black_goals, status) values ((select id from mm), -5, 4, 9, 'homologated');
select nm(user_id) as giocatore, played, base, skills, total,
       (select string_agg(e ->> 'label' || ' ' || (e ->> 'value'), '; ') from jsonb_array_elements(breakdown) e) as dettaglio, fanta
from fl_points where user_id in (pid('P1'), pid('P2'), pid('P3'), pid('P5'), pid('P8')) order by 1;

\echo '--- 3) con il controllo di Supabase: un marcatore corretto ricalcola subito (nessun avviso) e il Leader ricalcola tutto'
update scorers set goals = 9 where match_id = (select id from mm) and user_id = pid('P8');
set role authenticated; select as_user('P1'), fl_recompute_all() as giornate; reset role;
select count(*) as revisioni_create from fl_points_revisions;

\echo '--- 4) quotazione: le assenze pesano (P1 assente due volte scende, P8 presente sale)'
insert into matches (starts_at, nominal_date, status, lineup_status) values (now() - interval '1 day', (now() - interval '1 day')::date, 'played', 'official');
insert into lineup (match_id, user_id, team) select m.id, pid(x), case when x in ('P2','P3','P5','P6','P7') then 'white' else 'black' end
  from matches m, unnest(array['P2','P3','P5','P6','P7','P8','P9','P10','P11','P12']) x where m.starts_at > now() - interval '2 days';
update matches set votes_closes_at = now() - interval '1 minute' where starts_at > now() - interval '2 days';
insert into results (match_id, diff, white_goals, black_goals, status) select id, 0, 3, 3, 'homologated' from matches where starts_at > now() - interval '2 days';
set role authenticated; select as_user('P4');
select nm(user_id) as giocatore, price_initial as iniziale, price_current as attuale, played as presenze from fl_player_ranking() where user_id in (pid('P1'), pid('P8'), pid('P4')) order by 1;
reset role;
