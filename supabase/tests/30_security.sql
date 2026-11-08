\set ON_ERROR_STOP 1
\pset footer off
\echo '--- 1) controlli strutturali (falliscono se qualcosa non è a norma)'
do $$ declare bad text; begin
  select string_agg(relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if bad is not null then raise exception 'Tabelle senza RLS: %', bad; end if;
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then raise exception 'Funzioni SECURITY DEFINER senza search_path: %', bad; end if;
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('invite_info', 'app_branding');   -- le sole che servono prima dell'accesso
  if bad is not null then raise exception 'Funzioni SECURITY DEFINER chiamabili senza accesso: %', bad; end if;
  select string_agg(table_name, ', ') into bad from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if bad is not null then raise exception 'Tabelle accessibili senza accesso: %', bad; end if;
  raise notice 'struttura a posto';
end $$;
select 'struttura a posto' as esito;

\echo '--- 2) limite della chat: il 13° messaggio in un minuto è rifiutato (atteso 1 errore)'
insert into auth.users (email, raw_user_meta_data) values ('s1@x.it', '{"first_name":"S1"}');
insert into matches (starts_at, nominal_date, status) values (now() + interval '2 days', (now() + interval '2 days')::date, 'scheduled');
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'S1'), false);
set role authenticated;
do $$ begin for i in 1..12 loop insert into chat_messages (match_id, user_id, body) values ((select id from matches limit 1), auth.uid(), 'msg ' || i); end loop; end $$;
\set ON_ERROR_STOP 0
insert into chat_messages (match_id, user_id, body) values ((select id from matches limit 1), auth.uid(), 'il tredicesimo');
\set ON_ERROR_STOP 1
reset role;
select count(*) as messaggi_salvati from chat_messages;
