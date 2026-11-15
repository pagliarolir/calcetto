\set ON_ERROR_STOP 1
\pset footer off
-- FantaLeader in una chiamata (migrazione 53): stessi dati delle letture separate, null per chi non lo vede
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,4) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
grant execute on function as_user(text) to authenticated, anon;

\echo '--- 1) il Leader vede tutto: chiavi e numeri uguali alle letture separate'
set role authenticated; select as_user('P1');
select (select array_agg(k order by k) from jsonb_object_keys(b) k) as chiavi,
       jsonb_array_length(b->'players') = (select count(*) from fl_players) as giocatori_uguali,
       jsonb_array_length(b->'skills') = (select count(*) from fl_skills) as skill_uguali,
       jsonb_array_length(b->'ranking') = (select count(*) from fl_player_ranking()) as classifica_uguale,
       (b->'settings'->>'id') = '1' as impostazioni
from (select fl_bundle() b) x;
reset role;

\echo '--- 2) un giocatore fuori dall''anteprima riceve null'
set role authenticated; select as_user('P2'), fl_bundle() is null as nascosto; reset role;

\echo '--- 3) anon non può chiamarla (atteso 1 errore)'
\set ON_ERROR_STOP 0
set role anon; select fl_bundle(); reset role;
