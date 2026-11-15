\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti (migrazione 58): «Svuota l'elenco» delle spese nasconde le spese solo a chi lo preme; i saldi non cambiano
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
update profiles set nickname = 'Bobbo' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;
select as_user('P1'), pay_add_expense('Campo', 3000, pid('P1'), array[pid('P1'), pid('P2'), pid('P3')]) is not null as spesa;
\echo '--- prima: 1 spesa per P1 e P2; P2 deve 10 €'
select as_user('P2'), jsonb_array_length(pay_overview() -> 'expenses') as spese_p2, pay_overview() ->> 'balance_cents' as saldo_p2;
select as_user('P2'), pay_clear_expenses();
\echo '--- P2 svuota: P2 0 spese, saldo -10 € invariato; P1 vede ancora la spesa'
select as_user('P2'), jsonb_array_length(pay_overview() -> 'expenses') as spese_p2, pay_overview() ->> 'balance_cents' as saldo_p2;
select as_user('P1'), jsonb_array_length(pay_overview() -> 'expenses') as spese_p1;
do $$ begin
  perform as_user('P2');
  if jsonb_array_length(pay_overview() -> 'expenses') <> 0 then raise exception 'le spese di P2 devono sparire'; end if;
  if (pay_overview() ->> 'balance_cents')::int <> -1000 then raise exception 'il saldo di P2 non deve cambiare'; end if;
  if pay_overview() ->> 'history_cleared_at' is not null then raise exception 'lo storico pagamenti non va toccato'; end if;
  perform as_user('P1');
  if jsonb_array_length(pay_overview() -> 'expenses') <> 1 then raise exception 'P1 vede ancora la spesa'; end if;
end $$;
\echo '--- una spesa nuova dopo lo svuotamento si vede'
select as_user('P1'), pay_add_expense('Pizza', 900, pid('P1'), array[pid('P1'), pid('P2'), pid('P3')]) is not null as spesa;
select as_user('P2'), jsonb_array_length(pay_overview() -> 'expenses') as spese_p2;
\echo '--- P3 (non in anteprima) non può svuotare (atteso 1 errore)'
select as_user('P3'), pay_clear_expenses();
