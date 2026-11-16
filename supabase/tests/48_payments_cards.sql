\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti (migrazione 64): giallo a chi non paga il campo entro le 12 del giorno dopo, rosso (punizione) se alla
-- partita dopo ha ancora un debito; tolti quando salda con conferma; in punizione si salda lo stesso; promemoria.
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,4) g;
update profiles set nickname = 'Bobbo' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;
select as_user('P1'), pay_set_visibility(false, array[pid('P3')]);
insert into achievements (number, name) values (11, 'Sticker segreto') on conflict (number) do nothing;
-- due partite giocate: la prima 3 giorni fa, la seconda 2 giorni fa
insert into matches (starts_at, nominal_date) values (now() - interval '3 days', (now() - interval '3 days')::date), (now() - interval '2 days', (now() - interval '2 days')::date);
create function m1() returns uuid language sql as $$ select id from matches where starts_at < now() - interval '60 hours' order by starts_at limit 1 $$;
create function m2() returns uuid language sql as $$ select id from matches where starts_at between now() - interval '60 hours' and now() order by starts_at limit 1 $$;
grant execute on function m1(), m2() to authenticated, anon;

\echo '--- 1) campo della prima partita: paga P1 (30 €, 10 a testa con P2 e P3); P2 salda e P1 conferma, P3 no'
select as_user('P1'), pay_add_expense('Campo', 3000, pid('P1'), array[pid('P1'), pid('P2'), pid('P3')], m1()) is not null as spesa1;
-- la spesa è stata inserita «in tempo»: la retrodatiamo di un giorno
update pay_expenses set created_at = now() - interval '2 days';
select as_user('P2'), pay_mark_paid(pid('P1'), 1000, 'cash') is not null as segnato;
select as_user('P1'), pay_decide((select id from pay_settlements where from_id = pid('P2')), true);
select pay_cards_tick();
select (select n from ids where id = user_id) chi, color from pay_cards order by 1;
select (select n from ids where id = user_id) chi, (select name from achievements a where a.id = achievement_id) sticker from player_achievements order by 1;

\echo '--- 2) il promemoria: P1 a P3 (dalle 13 e una volta al giorno: «sent» o «early», poi «already» o «early»)'
select as_user('P1'), pay_remind(pid('P3')) in ('sent', 'early') as primo, pay_remind(pid('P3')) in ('already', 'early') as secondo;

-- P3 è prenotato in una partita futura: col rosso deve uscire dalla lista
insert into matches (starts_at, nominal_date, bookings_open_at, bookings_close_at) values (now() + interval '3 days', (now() + interval '3 days')::date, now() - interval '1 day', now() + interval '2 days');
create function mf() returns uuid language sql as $$ select id from matches where starts_at > now() order by starts_at limit 1 $$;
grant execute on function mf() to authenticated, anon;
select _book(pid('P3'), pid('P3'), mf(), 'present', true) ->> 'list' as p3_prenotato;
\echo '--- 3) seconda partita: P3 ancora in debito → rosso e punizione; P2 nessun cartellino'
select as_user('P1'), pay_add_expense('Campo', 3000, pid('P1'), array[pid('P1'), pid('P2'), pid('P3')], m2()) is not null as spesa2;
update pay_expenses set created_at = now() - interval '2 days';
-- P2 paga in tempo anche la seconda
select as_user('P2'), pay_mark_paid(pid('P1'), 1000, 'cash') is not null as p2_paga;
select as_user('P1'), pay_decide((select id from pay_settlements where from_id = pid('P2') and status = 'pending'), true);
select pay_cards_tick();
select (select n from ids where id = user_id) chi, color, punishment_id is not null as punito from pay_cards where cleared_at is null order by 1, 2;
select is_punished(pid('P3')) as p3_in_punizione;
select list as p3_nella_partita_futura from bookings where match_id = mf() and user_id = pid('P3');

\echo '--- 4) in punizione P3 vede i conti e salda; P1 conferma; al giro dopo niente cartellini e punizione finita'
select as_user('P3'), (pay_overview() ->> 'balance_cents') as saldo_p3;
select as_user('P3'), pay_mark_paid(pid('P1'), 2000, 'paypal') is not null as p3_salda;
select as_user('P1'), pay_decide((select id from pay_settlements where from_id = pid('P3')), true);
select pay_cards_tick();
select count(*) filter (where cleared_at is null) as cartellini_attivi, bool_and(cleared_at is not null) as tutti_tolti from pay_cards;
select is_punished(pid('P3')) as p3_ancora_punito;
do $$ begin
  if is_punished(pid('P3')) then raise exception 'la punizione doveva finire'; end if;
  if exists (select 1 from pay_cards where cleared_at is null) then raise exception 'i cartellini dovevano essere tolti'; end if;
  if (select count(*) from pay_cards where user_id = pid('P3')) <> 2 then raise exception 'P3 doveva avere giallo e rosso'; end if;
  if exists (select 1 from pay_cards where user_id = pid('P2')) then raise exception 'P2 aveva pagato in tempo'; end if;
  if (select count(*) from pay_card_checks) <> 2 then raise exception 'ogni partita si controlla una volta'; end if;
end $$;
\echo '--- 5) il Leader titolare (P1) non prende cartellini; spesa inserita dopo la scadenza: vale subito la scadenza'
insert into matches (starts_at, nominal_date) values (now() - interval '50 hours', (now() - interval '50 hours')::date);
create function m3() returns uuid language sql as $$ select id from matches where id not in (m1(), m2()) and starts_at < now() - interval '40 hours' and starts_at > now() - interval '55 hours' limit 1 $$;
select as_user('P3'), pay_add_expense('Campo', 2000, pid('P3'), array[pid('P1'), pid('P3')], m3()) is not null as spesa3;
select pay_cards_tick();
select count(*) as cartellini_leader from pay_cards where user_id = pid('P1');
do $$ begin
  if exists (select 1 from pay_cards where user_id = pid('P1')) then raise exception 'il Leader non prende cartellini'; end if;
  if not exists (select 1 from pay_card_checks where match_id = m3()) then raise exception 'la scadenza delle 12 vale anche per le spese inserite tardi'; end if;
end $$;
\echo '--- 6) cartellini visibili a tutti (solo il colore) e i miei'
select as_user('P2'), pay_cards_active() as attivi;
select as_user('P3'), pay_my_cards() as miei;
