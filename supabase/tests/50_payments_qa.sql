\set ON_ERROR_STOP 1
\pset footer off
-- Conti, correzioni della migrazione 68: partite vecchie solo al Leader, un campo per partita, quote per eccesso,
-- cartellini solo per il campo, con il campo inserito entro mezzanotte, mai agli ospiti, in attesa di chi riceve,
-- tolti subito alla conferma, uno per giro; avviso quando si toglie una spesa; profili con conti non eliminabili.
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,6) g;
insert into profiles (first_name, guest, active) values ('Ospite', true, true);
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;
select as_user('P1'), pay_set_visibility(true, '{}');
insert into achievements (number, name) values (11, 'Sticker segreto') on conflict (number) do nothing;
-- partite giocate 60-64 ore fa (scadenza delle 12 già passata, meno di 3 giorni) e una di 5 giorni fa
insert into matches (starts_at, nominal_date)
select now() - (h || ' hours')::interval, (now() - (h || ' hours')::interval)::date from unnest(array[60, 61, 62, 63, 64, 120]) h;
create function mt(h int) returns uuid language sql as $$ select id from matches where starts_at between now() - ((h + 0.5) || ' hours')::interval and now() - ((h - 0.5) || ' hours')::interval $$;
grant execute on function mt(int) to authenticated, anon;
-- le spese di campo inserite la sera della partita (prima di mezzanotte)
create function in_time(p uuid) returns void language sql as $$
  update pay_expenses e set created_at = x.starts_at + interval '1 hour' from matches x where x.id = e.match_id and e.match_id = p $$;

\echo '--- 1) partita di 5 giorni fa: P2 non può dividere il campo, il Leader sì'
\set ON_ERROR_STOP 0
select as_user('P2'), pay_add_expense('Campo', 3000, pid('P2'), array[pid('P2'), pid('P3')], mt(120));
\set ON_ERROR_STOP 1
select as_user('P1'), pay_add_expense('Campo vecchio', 3000, pid('P1'), array[pid('P1'), pid('P6')], mt(120)) is not null as leader_ok;

\echo '--- 2) un solo campo per partita: P2 lo inserisce, P3 ci riprova'
select as_user('P2'), pay_add_expense('Campo', 3000, pid('P2'), array[pid('P2'), pid('P3'), pid('P4'), pid('P5'), pid('Ospite')], mt(60)) is not null as campo_a;
\set ON_ERROR_STOP 0
select as_user('P3'), pay_add_expense('Campo', 3000, pid('P3'), array[pid('P2'), pid('P3'), pid('P4'), pid('P5')], mt(60));
\set ON_ERROR_STOP 1
select count(*) as spese_campo_a from pay_expenses where match_id = mt(60) and deleted_at is null;

\echo '--- 3) quote per eccesso: 30 € in 7 → 4,29 a testa, chi ha pagato 4,26; poi P2 la toglie e gli altri sono avvisati'
select as_user('P2'), pay_add_expense('Pizza', 3000, pid('P2'), array[pid('P1'), pid('P2'), pid('P3'), pid('P4'), pid('P5'), pid('P6'), pid('Ospite')]) is not null as pizza;
select (select n from ids where id = s.user_id) chi, s.amount_cents from pay_shares s join pay_expenses e on e.id = s.expense_id where e.title = 'Pizza' order by 1;
select body from notifications where kind = 'pay_expense' and title = 'Nuova spesa: Pizza' and user_id = pid('P3');
select as_user('P2'), pay_delete_expense((select id from pay_expenses where title = 'Pizza'));
select (select n from ids where id = user_id) chi, body from notifications where kind = 'pay_expense_deleted' order by 1;

\echo '--- 4) scadenza del campo A: P3 ha segnato il pagamento (in attesa), P5 ha pagato il campo ma deve 5 € di pallone, P4 niente, ospite niente'
select in_time(mt(60));
select as_user('P3'), pay_mark_paid(pid('P2'), 600, 'paypal') is not null as p3_in_attesa;
select as_user('P5'), pay_mark_paid(pid('P2'), 600, 'cash') is not null as p5_paga;
select as_user('P2'), pay_decide((select id from pay_settlements where from_id = pid('P5')), true);
select as_user('P6'), pay_add_expense('Pallone', 1000, pid('P6'), array[pid('P5'), pid('P6')]) is not null as pallone;
select pay_cards_tick();
select (select n from ids where id = user_id) chi, color from pay_cards where cleared_at is null order by 1;
select (select n from ids where id = w) in_attesa from pay_card_checks, unnest(waiting) w where match_id = mt(60);

\echo '--- 5) P2 rifiuta il pagamento di P3: al giro dopo P3 prende il giallo'
select as_user('P2'), pay_decide((select id from pay_settlements where from_id = pid('P3')), false);
select pay_cards_tick();
select (select n from ids where id = user_id) chi, color from pay_cards where cleared_at is null order by 1;

\echo '--- 6) P2 segna «Ricevuti» da P4: il giallo di P4 si toglie subito, senza aspettare il giro'
select as_user('P2'), pay_mark_paid(pid('P2'), 600, 'cash', pid('P4')) is not null as ricevuti;
select (select n from ids where id = user_id) chi, color, cleared_at is not null as tolto from pay_cards order by 1;

\echo '--- 7) campo B: P3 ancora in debito → rosso; il messaggio della punizione parla dei Conti'
select as_user('P2'), pay_add_expense('Campo', 2000, pid('P2'), array[pid('P2'), pid('P3')], mt(61)) is not null as campo_b;
select in_time(mt(61));
select pay_cards_tick();
select (select n from ids where id = user_id) chi, color from pay_cards where cleared_at is null order by 1, 2;
\set ON_ERROR_STOP 0
select as_user('P3'), pay_add_expense('Birra', 500, pid('P3'), array[pid('P2'), pid('P3')]);
\set ON_ERROR_STOP 1
-- salda tutto: P2 conferma e la punizione finisce subito
select as_user('P3'), pay_mark_paid(pid('P2'), 1600, 'paypal') is not null as p3_salda;
select as_user('P2'), pay_decide((select id from pay_settlements where from_id = pid('P3') and status = 'pending'), true);
select is_punished(pid('P3')) as p3_punito, (select count(*) from pay_cards where user_id = pid('P3') and cleared_at is null) as cartellini_p3;

\echo '--- 8) due campi scaduti nello stesso giro: P6 prende un solo cartellino (giallo, non anche il rosso)'
select as_user('P2'), pay_add_expense('Campo', 2000, pid('P2'), array[pid('P2'), pid('P6')], mt(62)) is not null as campo_c;
select as_user('P2'), pay_add_expense('Campo', 2000, pid('P2'), array[pid('P2'), pid('P6')], mt(63)) is not null as campo_d;
select in_time(mt(62)), in_time(mt(63));
select pay_cards_tick();
select color from pay_cards where user_id = pid('P6') and cleared_at is null;

\echo '--- 9) campo inserito dopo la mezzanotte della partita: niente cartellini'
select as_user('P2'), pay_add_expense('Campo', 2000, pid('P2'), array[pid('P2'), pid('P4')], mt(64)) is not null as campo_tardi;
select pay_cards_tick();
select count(*) as cartellini_p4 from pay_cards where user_id = pid('P4') and cleared_at is null;

\echo '--- 10) richiesta dei dati di pagamento: due giocatori con lo stesso nome non si bloccano a vicenda'
update profiles set first_name = 'Marco' where id in (pid('P4'), pid('P5'));
select as_user('P4'), pay_ask_methods(pid('P3')) as p4_prima, pay_ask_methods(pid('P3')) as p4_seconda;
select as_user('P5'), pay_ask_methods(pid('P3')) as p5_prima;

\echo '--- 11) l''ospite ha movimenti nei Conti: non si può eliminare'
\set ON_ERROR_STOP 0
select as_user('P1'), delete_guest(pid('Ospite'));
\set ON_ERROR_STOP 1

do $$ begin
  if exists (select 1 from pay_cards where user_id = pid('Ospite')) then raise exception 'gli ospiti non prendono cartellini'; end if;
  if exists (select 1 from pay_cards where user_id = pid('P5')) then raise exception 'P5 aveva pagato il campo'; end if;
  if (select count(*) from pay_cards where user_id = pid('P6') and match_id in (mt(62), mt(63))) <> 1 then raise exception 'un solo cartellino per giro'; end if;
  if exists (select 1 from pay_cards where match_id in (mt(64), mt(120))) then raise exception 'campo inserito tardi: niente cartellini'; end if;
  if (select count(*) from pay_expenses where match_id = mt(60)) <> 1 then raise exception 'un solo campo per partita'; end if;
  if not exists (select 1 from profiles where id = pid('Ospite')) then raise exception 'il profilo con i conti doveva restare'; end if;
  if (select sum(net_cents) from pay_balances()) <> 0 then raise exception 'i saldi devono fare zero'; end if;
end $$;
\echo 'esito: regole dei Conti a posto'
