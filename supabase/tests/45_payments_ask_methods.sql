\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti (migrazione 59): chiedere i dati di pagamento a chi non li ha, al massimo una volta ogni 12 ore
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
update profiles set nickname = 'Bobbo' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;
\echo '--- Bobbo (P2) chiede i dati al Leader (P1): avviso; la seconda volta no'
select as_user('P2'), pay_ask_methods(pid('P1')) as prima, pay_ask_methods(pid('P1')) as seconda;
select title, body, url from notifications where kind = 'pay_ask_methods';
\echo '--- il Leader li chiede a Bobbo; Bobbo salva i dati; poi non si chiedono più; P3 non vede i Pagamenti: niente'
select as_user('P1'), pay_ask_methods(pid('P2')) as a_bobbo, pay_ask_methods(pid('P3')) as a_p3, pay_ask_methods(pid('P1')) as a_se_stesso;
select as_user('P2'), pay_save_methods('bobbo', null, null);
delete from notifications where kind = 'pay_ask_methods';
select as_user('P1'), pay_ask_methods(pid('P2')) as con_dati;
do $$ begin
  perform as_user('P1');
  if pay_ask_methods(pid('P2')) then raise exception 'chi ha già i dati non va avvisato'; end if;
  if exists (select 1 from notifications where kind = 'pay_ask_methods') then raise exception 'nessun avviso atteso'; end if;
end $$;
