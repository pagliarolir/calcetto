\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,10) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, service_role;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function chi(c text) returns text language sql as $$
  select coalesce(string_agg((select n from ids where id = pa.user_id), ',' order by (select n from ids where id = pa.user_id)), '-')
  from player_achievements pa join achievements a on a.id = pa.achievement_id where a.code = c $$;
grant execute on function as_user(text), pid(text), chi(text) to authenticated, service_role;
delete from matches;
-- A: «sceglie il Leader», fra 3 giorni. B: in ordine di arrivo, fra 20 ore. C: in ordine di arrivo, fra 4 giorni.
create temp table mm (k text, id uuid); grant select on mm to authenticated, service_role;
insert into mm select 'A', create_match(now() + interval '3 days');
insert into mm select 'B', create_match(now() + interval '20 hours');
insert into mm select 'C', create_match(now() + interval '4 days');
create function m(k text) returns uuid language sql as $$ select id from mm where mm.k = m.k $$;
grant execute on function m(text) to authenticated, service_role;
update matches set bookings_open_at = now() - interval '1 day', bookings_close_at = starts_at - interval '1 hour';
update matches set booking_mode = 'free' where id = m('A');

\echo '--- 1) con «sceglie il Leader» il Leader segna P2 presente: nessun errore, avviso giusto (prima: testo vuoto)'
set role authenticated; select as_user('P1'); select leader_book(m('A'), pid('P2'), 'present')->>'list' as lista; reset role;
select title, body from notifications where kind = 'placed_by_leader' and user_id = pid('P2');

\echo '--- 2) azione rapida dalla notifica con «sceglie il Leader»: risposta con testo'
select quick_action(pid('P3'), m('A'), 'present') as risposta;

\echo '--- 3) Salva Leader: P4 dice «ci sono» da sé a 20 ore dalla partita B; il Leader inserisce P5 (non vale); P6 si prenota per C, fra 4 giorni (non vale)'
set role authenticated;
select as_user('P4'), book(m('B'), 'present');
select as_user('P1'), leader_book(m('B'), pid('P5'), 'present');
select as_user('P6'), book(m('C'), 'present');
reset role;
select chi('salva_leader') as salva_leader;

\echo '--- 4) Monnezza: formazione ufficiale di B con P4 e P5; P4 si ritira da sé (vale); il Leader segna assente P5 (non vale);'
\echo '        P6 si ritira da C, dove la formazione non è ufficiale (non vale)'
insert into lineup (match_id, user_id, team) values (m('B'), pid('P4'), 'white'), (m('B'), pid('P5'), 'black');
update matches set lineup_status = 'official' where id = m('B');
set role authenticated;
select as_user('P4'), book(m('B'), 'absent');
select as_user('P1'), leader_book(m('B'), pid('P5'), 'absent');
select as_user('P6'), book(m('C'), 'absent');
reset role;
select chi('ritiro') as monnezza, (select count(*) from lineup where match_id = m('B') and user_id = pid('P4')) as p4_ancora_in_formazione;
select number, name, mission from achievements where code in ('ritiro', 'salva_leader') order by number;
