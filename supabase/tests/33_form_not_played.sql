\set ON_ERROR_STOP 1
\pset footer off
-- Stato di forma (migrazione 46): pareggio '=' e partita non giocata '–' sono distinti.
insert into auth.users (email, raw_user_meta_data) select 'f'||g||'@x.it', jsonb_build_object('first_name', 'F'||g) from generate_series(1,3) g;
insert into matches (starts_at, nominal_date, status, bookings_open_at, bookings_close_at)
values (now() - interval '10 days', (now() - interval '10 days')::date, 'scheduled', now() - interval '20 days', now() - interval '11 days'),
       (now() - interval '3 days', (now() - interval '3 days')::date, 'scheduled', now() - interval '13 days', now() - interval '4 days');

\echo '--- nessuna giornata omologata: none'
select player_form((select id from profiles where first_name = 'F1')) as nessuna;

-- prima giornata: vincono i bianchi; seconda: pareggio. F1 gioca entrambe, F2 solo la prima, F3 nessuna.
insert into lineup (match_id, user_id, team)
select m.id, p.id, 'white' from matches m, profiles p where m.starts_at < now() - interval '5 days' and p.first_name in ('F1', 'F2');
insert into lineup (match_id, user_id, team)
select m.id, p.id, 'black' from matches m, profiles p where m.starts_at > now() - interval '5 days' and m.starts_at < now() and p.first_name = 'F1';
insert into results (match_id, diff, status) select id, case when starts_at < now() - interval '5 days' then 2 else 0 end, 'homologated' from matches where starts_at < now();

\echo '--- atteso: F1 equal (ultima pareggiata), F2 none (ultima non giocata), F3 none'
select p.first_name, player_form(p.id) from profiles p where p.first_name like 'F_' order by 1;
