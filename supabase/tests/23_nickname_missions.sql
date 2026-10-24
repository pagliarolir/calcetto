\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,5) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated;

\set ON_ERROR_STOP 0
\echo '--- 1) P2 nasconde il nome senza soprannome (atteso errore)'
set role authenticated; select as_user('P2');
update profiles set visibility = visibility || '{"first_name": false}' where id = pid('P2');
reset role;
\set ON_ERROR_STOP 1

\echo '--- 2) con il soprannome «Il Mago»: gli altri vedono il soprannome al posto del nome (anche negli avvisi), P2 vede il suo nome'
set role authenticated; select as_user('P2');
update profiles set nickname = 'Il Mago', visibility = visibility || '{"first_name": false, "nickname": false}' where id = pid('P2');
select first_name as p2_vede_se_stesso from members where id = pid('P2');
select as_user('P3'); select first_name as p3_vede_il_nome, nickname as p3_vede_il_soprannome from members where id = pid('P2');
reset role;
select display_name(pid('P2')) as nome_negli_avvisi, (visibility->>'nickname')::boolean as soprannome_reso_visibile from profiles where id = pid('P2');

\set ON_ERROR_STOP 0
\echo '--- 3) con il nome nascosto P2 non può togliere il soprannome (atteso errore)'
set role authenticated; select as_user('P2');
update profiles set nickname = null where id = pid('P2');
reset role;
\set ON_ERROR_STOP 1

\echo '--- 4) P2 rimette il nome: gli altri vedono di nuovo «P2»'
set role authenticated; select as_user('P2');
update profiles set visibility = visibility || '{"first_name": true}' where id = pid('P2');
select as_user('P3'); select first_name as p3_vede from members where id = pid('P2');
reset role;

\echo '--- 5) missioni: dopo che il Leader assegna Bobomber a P4, P5 (che non ce l ha) ne vede la missione; Gesù, mai sbloccato, resta segreto'
delete from player_achievements;
set role authenticated; select as_user('P1'); select award_achievement((select id from achievements where code = 'autogol'), pid('P4'));
select as_user('P5'); select a.name, m.mission from achievement_missions() m join achievements a on a.id = m.id order by a.number;
reset role;
