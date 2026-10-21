\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon, service_role;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
grant execute on function as_user(text) to authenticated, anon;
update profiles set last_name = 'Rossi', birth_date = '1990-05-01',
  visibility = visibility || '{"last_name": true, "birth_date": false}' where first_name = 'P2';

\echo '--- 1) la vista members non e piu "security definer" (atteso security_invoker=true)'
select reloptions from pg_class where relname = 'members' and relnamespace = 'public'::regnamespace;

\echo '--- 2) le regole di visibilita valgono come prima: P3 vede il cognome di P2 ma non la data di nascita; P2 vede la sua'
set role authenticated;
select as_user('P3'); select count(*) as membri_visti, max(last_name) filter (where first_name = 'P2') as cognome_p2,
  max(birth_date) filter (where first_name = 'P2') is null as nascita_nascosta from members;
select as_user('P2'); select birth_date is not null as vede_la_sua_data from members where first_name = 'P2';
reset role;

\set ON_ERROR_STOP 0
\echo '--- 3) un anonimo non legge i membri (atteso errore di permesso)'
set role anon;
select count(*) from members;
reset role;
\set ON_ERROR_STOP 1

\echo '--- 4) service_role ha permessi espliciti su ogni tabella (attesi 0 tabelle senza permessi)'
select count(*) as tabelle_senza_permessi_per_service_role
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
  and not (has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
       and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete'));
set role service_role;
select (select count(*) from push_subscriptions) >= 0 as legge_le_iscrizioni_push, (select count(*) from members) >= 0 as legge_i_membri;
reset role;

\echo '--- 5) nessuna tabella di public espone dati agli anonimi (attese 0)'
select count(*) as tabelle_leggibili_da_anon from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'select');
