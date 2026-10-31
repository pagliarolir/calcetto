\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,8) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated;

\echo '--- 1) all''inizio: il giocatore con soprannome «Bobbo» (anche con maiuscole e spazi) entra nell''anteprima'
update profiles set nickname = '  BoBBo ' where id = pid('P2');
-- stessa istruzione della migrazione
update fl_settings set preview_users = coalesce((select array_agg(id) from profiles where active and lower(trim(nickname)) = 'bobbo'), '{}') where id = 1;
select (select n from ids where id = any (preview_users)) as anteprima from fl_settings;

set role authenticated; select as_user('P1');
select fl_save_player(pid('P'||g), true, 10, null) from generate_series(1,8) g;
select fl_set_market(true);
reset role;

\echo '--- 2) chi vede: Leader sì, Bobbo sì, P3 no'
set role authenticated;
select as_user('P1'); select 'P1 (Leader)' as chi, fl_visible() as vede, (select count(*) from fl_players) as giocatori_letti, (select count(*) from fl_player_ranking()) as classifica;
select as_user('P2'); select 'P2 (Bobbo)' as chi, fl_visible() as vede, (select count(*) from fl_players) as giocatori_letti, (select count(*) from fl_player_ranking()) as classifica;
select as_user('P3'); select 'P3' as chi, fl_visible() as vede, (select count(*) from fl_players) as giocatori_letti, (select count(*) from fl_player_ranking()) as classifica,
  (select count(*) from fl_settings) as impostazioni_lette, fl_current_price(pid('P4')) as quotazione_letta;
\set ON_ERROR_STOP 0
\echo '--- 3) P3 non può creare una fantasquadra né cambiare l''elenco (attesi 2 errori)'
select as_user('P3'), fl_confirm_team('Fuori lista', array[pid('P1'),pid('P2'),pid('P4'),pid('P5'),pid('P6'),pid('P7')], pid('P1'));
select as_user('P3'), fl_set_visibility(true, '{}');
\set ON_ERROR_STOP 1
\echo '--- 4) Bobbo crea la sua fantasquadra'
select as_user('P2'), (fl_confirm_team('Bobbo FC', array[pid('P1'),pid('P3'),pid('P4'),pid('P5'),pid('P6'),pid('P7')], pid('P1')))->>'spent' as spesi;
\echo '--- 5) il Leader aggiunge P3 all''anteprima, poi apre a tutti'
select as_user('P1'), fl_set_visibility(false, array[pid('P2'), pid('P3')]);
select as_user('P3'), fl_visible() as p3_vede, (select count(*) from fl_team_ranking()) as squadre_lette;
select as_user('P4'), fl_visible() as p4_vede_prima;
select as_user('P1'), fl_set_visibility(true, array[pid('P2'), pid('P3')]);
select as_user('P4'), fl_visible() as p4_vede_dopo;
reset role;
select action from fl_audit where action = 'visibilità cambiata';
