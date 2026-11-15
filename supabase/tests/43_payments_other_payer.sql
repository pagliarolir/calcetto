\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti (migrazione 57): Bobbo inserisce una spesa pagata da P3; P3 è avvisato e può toglierla
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
update profiles set nickname = 'Bobbo' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;
select as_user('P1'), pay_set_visibility(false, array[pid('P3')]);
\echo '--- Bobbo (P2) segna 30 € pagati da P3 per P1, P2, P3'
select as_user('P2'), pay_add_expense('Campo', 3000, pid('P3'), array[pid('P1'), pid('P2'), pid('P3')]) as spesa \gset
select as_user('P3'), pay_overview() ->> 'balance_cents' as saldo_p3;
select (select n from ids where id = user_id) chi, title, body from notifications where kind = 'pay_expense' order by 1;
do $$ begin
  perform as_user('P3');
  if (pay_overview() ->> 'balance_cents')::int <> 2000 then raise exception 'P3 deve ricevere 20 €'; end if;
  if not exists (select 1 from notifications n join ids on ids.id = n.user_id where ids.n = 'P3' and n.title like 'Spesa a tuo nome%') then
    raise exception 'P3 deve essere avvisato'; end if;
end $$;
\echo '--- P3 la toglie: saldi a zero'
select as_user('P3'), pay_delete_expense(:spesa);
select as_user('P3'), pay_overview() ->> 'balance_cents' as saldo_p3;
