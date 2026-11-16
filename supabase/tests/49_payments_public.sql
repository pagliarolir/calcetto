\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti per tutti (migrazione 67): ogni giocatore attivo vede i Conti; i cartellini valgono solo per le scadenze future.
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, anon;

\echo '--- 1) dopo la migrazione i Conti sono pubblici: anche P3 (giocatore semplice, non Bobbo) li vede'
select public as pubblico from pay_settings where id = 1;
select as_user('P3'), pay_visible() as p3_vede;

\echo '--- 2) un campo vecchio non pagato, già scaduto prima della migrazione: nessun cartellino'
insert into matches (starts_at, nominal_date) values (now() - interval '5 days', (now() - interval '5 days')::date);
select as_user('P1'), pay_add_expense('Campo', 3000, pid('P1'), array[pid('P1'), pid('P2'), pid('P3')], (select id from matches limit 1)) is not null as spesa;
-- simula la migrazione 67 applicata con questa partita già nello storico
insert into pay_card_checks (match_id)
select e.match_id from pay_expenses e join matches m on m.id = e.match_id where e.match_id is not null
group by e.match_id having now() >= max(scorers_close_at(m)) on conflict do nothing;
select pay_cards_tick();
select count(*) as cartellini from pay_cards;
