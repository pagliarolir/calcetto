\set ON_ERROR_STOP 1
\pset footer off
-- Leader News (migrazione 62): il Leader scrive, ognuno la vede una volta al primo avvio, chi scrive non la rivede
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
grant execute on function as_user(text) to authenticated, anon;
\echo '--- il Leader (P1) pubblica due notizie'
select as_user('P1'), leader_news_post('Giovedì si gioca alle 21: portate le pettorine!') > 0 as prima;
select as_user('P1'), leader_news_post('Ricordatevi la quota del campo.') > 0 as seconda;
\echo '--- P2 le vede entrambe, il Leader nessuna'
select as_user('P2'), jsonb_array_length(leader_news_pending()) as da_leggere_p2;
select as_user('P1'), jsonb_array_length(leader_news_pending()) as da_leggere_leader;
\echo '--- P2 le segna lette: non le rivede; P3 sì'
select as_user('P2'), leader_news_seen((select max(id) from leader_news));
select as_user('P2'), jsonb_array_length(leader_news_pending()) as dopo_p2;
select as_user('P3'), jsonb_array_length(leader_news_pending()) as p3;
\echo '--- elenco del Leader con le letture'
select as_user('P1'), jsonb_path_query_array(leader_news_list(), '$[*].seen') as lette_da;
do $$ begin
  perform as_user('P2'); if jsonb_array_length(leader_news_pending()) <> 0 then raise exception 'P2 le ha già lette'; end if;
  perform as_user('P3'); if jsonb_array_length(leader_news_pending()) <> 2 then raise exception 'P3 deve vederne 2'; end if;
  perform as_user('P1'); perform leader_news_delete((select max(id) from leader_news));
  perform as_user('P3'); if jsonb_array_length(leader_news_pending()) <> 1 then raise exception 'la notizia tolta non si vede più'; end if;
end $$;
\echo '--- regole (attesi 3 errori): P2 non può scrivere né vedere l elenco; testo vuoto'
\set ON_ERROR_STOP 0
select as_user('P2'), leader_news_post('ciao');
select as_user('P2'), leader_news_list();
select as_user('P1'), leader_news_post('   ');
