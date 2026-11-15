\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti (migrazione 56): «Svuota» nasconde lo storico solo a chi lo svuota; i saldi non cambiano
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
update profiles set nickname = 'Bobbo' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;
select as_user('P1'), pay_add_expense('Campo', 3000, pid('P1'), array[pid('P1'), pid('P2'), pid('P3')]) is not null as spesa;
select as_user('P1'), pay_mark_paid(pid('P1'), 1000, 'cash', pid('P2')) is not null as segnato;
\echo '--- prima: storico 1 per P1 e P2; saldo P1 +10 €'
select as_user('P1'), jsonb_array_length(pay_overview() -> 'history') as storico_p1, pay_overview() ->> 'balance_cents' as saldo_p1;
select as_user('P2'), jsonb_array_length(pay_overview() -> 'history') as storico_p2;
select as_user('P2'), pay_clear_history();
\echo '--- P2 svuota: P2 0, P1 ancora 1, saldi invariati'
select as_user('P2'), jsonb_array_length(pay_overview() -> 'history') as storico_p2, pay_overview() ->> 'balance_cents' as saldo_p2;
select as_user('P1'), jsonb_array_length(pay_overview() -> 'history') as storico_p1, pay_overview() ->> 'balance_cents' as saldo_p1;
do $$ begin
  perform as_user('P2');
  if jsonb_array_length(pay_overview() -> 'history') <> 0 then raise exception 'lo storico di P2 deve essere vuoto'; end if;
  if (pay_overview() ->> 'balance_cents')::int <> 0 then raise exception 'il saldo di P2 non deve cambiare'; end if;
  perform as_user('P1');
  if jsonb_array_length(pay_overview() -> 'history') <> 1 then raise exception 'lo storico di P1 resta'; end if;
  if (pay_overview() ->> 'balance_cents')::int <> 1000 then raise exception 'il saldo di P1 non deve cambiare'; end if;
end $$;
\echo '--- i dati di pagamento di P2 restano vuoti, P3 (non in anteprima) non può svuotare (atteso 1 errore)'
select as_user('P2'), (select paypal is null and iban is null from pay_methods where user_id = pid('P2')) as metodi_vuoti;
select as_user('P3'), pay_clear_history();
