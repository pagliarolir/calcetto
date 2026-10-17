\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,12) g;
update profiles set role = 'premier1' where first_name = 'P2';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated;
set role authenticated;
select as_user('P1'), leader_create_matches(array[current_date + 10], '20:00', jsonb_build_object('players_per_team', 5, 'team_a_kit', 'white', 'team_b_kit', 'black',
  'booking_open_days', 3, 'booking_open_time', '12:00', 'booking_close_days', 0, 'booking_close_time', '17:00', 'votes_open_after_min', 30, 'votes_hours', 48), false);
reset role;
create temp table far as select id from matches where nominal_date = current_date + 10; grant select on far to authenticated;
create function far() returns uuid language sql as $$ select id from far $$; grant execute on function far() to authenticated;

\echo '--- 1) partita tra 10 giorni: chat aperta da subito (atteso: messaggio salvato)'
set role authenticated;
select as_user('P5');
insert into chat_messages (match_id, user_id, body) values (far(), pid('P5'), 'Ci vediamo tra dieci giorni');
reset role;
select count(*) as messaggi from chat_messages where match_id = far();

\echo '--- 2) formazioni fatte e pubblicate subito, anche con le prenotazioni non ancora aperte'
set role authenticated;
select as_user('P1'), leader_book(far(), pid('P'||g), 'present') from generate_series(2,10) g;
select as_user('P2'), save_lineup(far(), (select jsonb_agg(jsonb_build_object('user_id', user_id, 'team', case when rn % 2 = 0 then 'white' else 'black' end, 'field_slot', (rn + 1) / 2))
  from (select user_id, row_number() over (order by sort_key) rn from bookings where match_id = far() and list = 'team') b), true) as stato;
reset role;
select lineup_status, (select count(*) from lineup where match_id = far()) as in_campo from matches where id = far();
select count(*) as avvisi_formazioni_ufficiali from notifications where kind = 'lineup_official' and match_id = far();

\echo '--- 3) scheduler: nessun avviso "squadre" per le partite lontane'
select run_scheduler();
select count(*) as avvisi_squadre_da_fare from notifications where kind = 'lineup_window';

\echo '--- 4) a meno di 24 ore: promemoria solo se le squadre non sono ufficiali'
create temp table near as select id from matches where nominal_date <> current_date + 10 and status = 'scheduled' order by starts_at limit 1;
update matches set starts_at = now() + interval '20 hours', bookings_open_at = now() - interval '1 day', bookings_close_at = now() + interval '19 hours', sent_lineup_window = false
 where id in (select id from near union all select id from far);
select run_scheduler();
select (select count(*) from notifications where kind = 'lineup_window' and match_id = (select id from near)) as promemoria_bozza,
       (select count(*) from notifications where kind = 'lineup_window' and match_id = far()) as promemoria_ufficiale,
       (select sent_lineup_window from matches where id = far()) as segnata_comunque;
