\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti (migrazione 54): spese, quote, debiti semplificati, «Ho pagato» e conferma, visibilità in anteprima
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,4) g;
update profiles set nickname = 'Bobbo' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;
create function nets() returns table (chi text, saldo bigint) language sql security definer as $$
  select (select n from ids where id = b.user_id), b.net_cents from pay_balances() b order by 1 $$;
create function trs() returns table (da text, a text, cents bigint) language sql security definer as $$
  select (select n from ids where id = t.from_id), (select n from ids where id = t.to_id), t.amount_cents from pay_transfers() t order by 1, 2 $$;
grant execute on function nets(), trs() to authenticated;

\echo '--- 1) anteprima: il Leader li vede; Bobbo dopo che il Leader lo aggiunge; P3 no'
set role authenticated;
select as_user('P1'), pay_visible() as leader;
select as_user('P2'), pay_visible() as bobbo_prima;
select as_user('P1'), pay_set_visibility(false, array[pid('P2')]);
select as_user('P2'), pay_visible() as bobbo_dopo;
select as_user('P3'), pay_visible() as p3;
reset role;

\echo '--- 2) spese: 30 € pagati da P1 per P1, P2, P3; 10 € pagati da P2 per P2 e P3'
set role authenticated;
select as_user('P1'), pay_add_expense('Campo 12/11', 3000, pid('P1'), array[pid('P1'), pid('P2'), pid('P3')]) is not null as spesa1;
select as_user('P2'), pay_add_expense('Pallone', 1000, pid('P2'), array[pid('P2'), pid('P3')]) is not null as spesa2;
reset role;
select * from nets();
\echo '    debiti semplificati (P3 paga tutto a P1, non 5 a P2):'
select * from trs();
select n as chi, kind, body from notifications x join ids on ids.id = x.user_id where kind like 'pay_%' order by x.id;

\echo '--- 3) arrotondamento: 10 € tra 3 = 3,34 + 3,33 + 3,33'
set role authenticated; select as_user('P1'), pay_add_expense('Prova', 1000, pid('P1'), array[pid('P1'), pid('P2'), pid('P3')]) as spesa3 \gset
reset role;
select string_agg(amount_cents::text, ' + ' order by amount_cents desc) as quote, sum(amount_cents) as totale from pay_shares where expense_id = :spesa3;
set role authenticated; select as_user('P1'), pay_delete_expense(:spesa3); reset role;
select * from trs();

\echo '--- 4) regole (attesi 2 errori): P3 non vede; IBAN sbagliato (dalla migrazione 57 si possono inserire spese pagate da altri: test 43)'
\set ON_ERROR_STOP 0
set role authenticated;
select as_user('P3'), pay_overview();
select as_user('P2'), pay_save_methods(null, 'IT60X0542811101000000123457', null);
reset role;
\set ON_ERROR_STOP 1

\echo '--- 5) metodi: link PayPal.me ripulito, IBAN con spazi accettato'
set role authenticated;
select as_user('P1'), pay_save_methods('https://www.paypal.me/RobertoP/5', 'it60 x054 2811 1010 0000 0123 456', 'Roberto P');
reset role;
select paypal, iban, holder from pay_methods;

\echo '--- 6) Bobbo segna «Ho pagato» 5 € a P1: in attesa, il saldo non cambia; doppio «Ho pagato» e conferma di Bobbo rifiutati (attesi 2 errori); P1 conferma'
set role authenticated;
select as_user('P2'), pay_mark_paid(pid('P1'), 500, 'paypal') as saldo \gset
reset role;
select status from pay_settlements where id = :saldo;
select * from trs();
\set ON_ERROR_STOP 0
set role authenticated; select as_user('P2'), pay_mark_paid(pid('P1'), 500, 'paypal'); reset role;
set role authenticated; select as_user('P2'), pay_decide(:saldo, true); reset role;
\set ON_ERROR_STOP 1
set role authenticated; select as_user('P1'), pay_decide(:saldo, true); reset role;
select status from pay_settlements where id = :saldo;
select * from trs();
select n as chi, kind, body from notifications x join ids on ids.id = x.user_id where kind in ('pay_check', 'pay_confirmed') order by x.id;

\echo '--- 7) il Leader segna per P3 (contanti): confermato subito, conti a zero'
set role authenticated; select as_user('P1'), pay_mark_paid(pid('P1'), 1500, 'cash', pid('P3')); reset role;
select count(*) as debiti_rimasti from pay_transfers();

\echo '--- 8) vista di Bobbo: solo ciò che lo riguarda, metodi di chi deve pagare'
set role authenticated; select as_user('P1'), pay_add_expense('Pizza', 2000, pid('P1'), array[pid('P2'), pid('P4')]); reset role;
set role authenticated; select as_user('P2');
select jsonb_array_length(o->'transfers') as debiti_visti, (o->'transfers'->0->>'amount_cents') as importo,
       jsonb_array_length(o->'methods') as metodi, o->>'settings' is null as niente_impostazioni, jsonb_array_length(o->'expenses') as spese_viste
from (select pay_overview() o) x;
reset role;

\echo '--- 9) giocatore senza account con un debito, poi collegato a un account: il debito passa'
set role authenticated; select as_user('P1'), create_guest('Ospite') as g \gset
select as_user('P1'), pay_add_expense('Campo ospite', 600, pid('P1'), array[:'g'::uuid]); reset role;
select merge_profiles(:'g'::uuid, pid('P4'));
select * from trs();

\echo '--- 10) anon non può (atteso 1 errore)'
\set ON_ERROR_STOP 0
set role anon; select pay_overview(); reset role;
