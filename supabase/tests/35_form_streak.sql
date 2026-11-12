\set ON_ERROR_STOP 1
\pset footer off
-- Forma a serie (migrazione 48): provvisorio da -3 a +3, alla quarta di fila un ±1 definitivo,
-- pareggio come sconfitta, assenza solo in forma positiva (prima -1, seconda di fila azzera).
insert into auth.users (email, raw_user_meta_data) select lower(n)||'@x.it', jsonb_build_object('first_name', n) from unnest(array['FA','FB','FC','FD','FE']) n;
-- sei giornate omologate negli ultimi giorni: le prime cinque vinte dai bianchi, l'ultima pareggiata
insert into matches (starts_at, nominal_date, status, bookings_open_at, bookings_close_at)
select now() - (g || ' days')::interval, (now() - (g || ' days')::interval)::date, 'scheduled', now() - ((g + 5) || ' days')::interval, now() - ((g + 1) || ' days')::interval
from generate_series(1, 6) g;
create temp table g as select id, row_number() over (order by starts_at) as n from matches where starts_at < now() - interval '12 hours' and starts_at > now() - interval '7 days';
insert into results (match_id, diff, status) select id, case when n = 6 then 0 else 1 end, 'homologated' from g;
-- chi gioca e con chi: (giocatore, giornata, squadra)
insert into lineup (match_id, user_id, team)
select g.id, p.id, x.team from (values
  ('FA',1,'white'),('FA',2,'white'),('FA',3,'white'),('FA',4,'white'),('FA',5,'white'),('FA',6,'white'),
  ('FB',1,'black'),('FB',2,'black'),('FB',3,'black'),('FB',4,'black'),
  ('FC',1,'white'),('FC',2,'white'),('FC',3,'white'),('FC',6,'white'),
  ('FD',1,'black'),('FD',4,'white'),('FD',5,'white'),
  ('FE',1,'white'),('FE',2,'white'),('FE',3,'white'),('FE',4,'black'),('FE',5,'white'),('FE',6,'white')
) x(who, n, team) join g on g.n = x.n join profiles p on p.first_name = x.who;

\echo '--- prima della partenza della regola le partite non contano (atteso: tutti 0 / 0)'
select p.first_name, player_form_state(p.id) from profiles p where p.first_name like 'F_' and length(p.first_name) = 2 order by 1;

update app_settings set form_since = now() - interval '30 days' where true;
\echo '--- atteso: FA s 0 d 1 (quattro vittorie = +1 definitivo, poi vittoria +1 e pareggio -1)'
\echo '---         FB s 0 d -1 (quattro sconfitte = -1 definitivo; le assenze a 0 non contano)'
\echo '---         FC s -1 d 0 (+3, assenza +2, seconda assenza 0, pareggio -1)'
\echo '---         FD s 0 d 0 (-1, assenze in negativo non contano, +0, +1, assenza 0)'
\echo '---         FE s 2 d 0 (+3, sconfitta +2, vittoria +3, pareggio come sconfitta +2)'
select p.first_name, player_form_state(p.id) ->> 's' as s, player_form_state(p.id) ->> 'd' as d, player_form_state(p.id) ->> 'last' as ultima
from profiles p where p.first_name in ('FA','FB','FC','FD','FE') order by 1;

\echo '--- la scheda porta provvisorio e definitivi'
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'FA'), false);
select set_config('test.fe', (select id::text from profiles where first_name = 'FE'), false);
set role authenticated;
\echo '--- atteso: 2 e 0'
select c ->> 'form' as provvisorio, c ->> 'form_def' as definitivi from jsonb_array_elements(player_cards(array[current_setting('test.fe')::uuid])) c;
reset role;
\echo '--- la funzione interna non si chiama dall app (atteso 1 errore)'
set role authenticated;
\set ON_ERROR_STOP 0
select player_form_state((select id from profiles where first_name = 'FA'));
\set ON_ERROR_STOP 1
reset role;
