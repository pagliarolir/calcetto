\set ON_ERROR_STOP 1
\pset footer off
-- Banda delle Leader News (migrazione 70): le notizie degli ultimi 14 giorni, lette o no, solo per chi è nel gruppo.
insert into auth.users (email, raw_user_meta_data) select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,2) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce((select id::text from ids where n = p), ''), false) $$;
grant execute on function as_user(text) to authenticated, anon;
select as_user('P1'), leader_news_post('Giovedì si gioca alle 21');
insert into leader_news (body, created_by, created_at) select 'Vecchia', id, now() - interval '20 days' from profiles where first_name = 'P1';
select as_user('P2'), leader_news_seen((select max(id) from leader_news));
\echo '--- P2 l''ha già letta ma nella banda c''è ancora; quella di 20 giorni fa no'
select as_user('P2'), jsonb_array_length(leader_news_recent()) as notizie, leader_news_recent()->0->>'body' as prima;
do $$ begin
  perform as_user('P2'); if jsonb_array_length(leader_news_recent()) <> 1 then raise exception 'una sola notizia recente'; end if;
  perform as_user('nessuno'); if jsonb_array_length(leader_news_recent()) <> 0 then raise exception 'chi non è nel gruppo non vede niente'; end if;
end $$;
\echo 'esito: banda delle Leader News a posto'
