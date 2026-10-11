-- Simula le parti di Supabase che non esistono in un Postgres normale (auth, vault, pg_net, pg_cron, realtime).
do $$ begin create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
create schema net; create table net.calls(id serial, url text, at timestamptz default now());
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$ insert into net.calls(url) values (url) returning id::bigint $$;
create schema cron; create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ select 1::bigint $$;
create publication supabase_realtime;
grant usage on schema public to authenticated, anon, service_role;
insert into vault.decrypted_secrets values ('dispatch_url','https://x.supabase.co/functions/v1/push-dispatch'),('dispatch_secret','s');
do $$ begin create role authenticator login noinherit; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;
