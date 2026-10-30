\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,13) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function chi(c text) returns text language sql as $$
  select coalesce(string_agg((select n from ids where id = pa.user_id), ',' order by (select n from ids where id = pa.user_id)), '-')
  from player_achievements pa join achievements a on a.id = pa.achievement_id where a.code = c $$;
create function lista(m uuid, p text) returns text language sql as $$ select list from bookings where match_id = m and user_id = pid(p) $$;
grant execute on function as_user(text), pid(text), chi(text), lista(uuid, text) to authenticated;
delete from matches;
create temp table mm (k text, id uuid); grant select on mm to authenticated;
insert into mm select 'O', create_match(now() + interval '20 hours');
insert into mm select 'F', create_match(now() + interval '3 days');
create function m(k text) returns uuid language sql as $$ select id from mm where mm.k = m.k $$;
grant execute on function m(text) to authenticated;
update matches set bookings_open_at = now() - interval '2 days';
update matches set booking_mode = 'free' where id = m('F');
-- O: in ordine di arrivo, P2..P10 titolari, P11 e P12 riserve
set role authenticated;
select as_user('P'||g), book(m('O'), 'present') from generate_series(2,12) g;
select as_user('P'||g), book(m('F'), 'present') from generate_series(2,6) g;
reset role;
update matches set bookings_close_at = now() - interval '1 hour' where id = m('O');

\echo '--- 1) «in ordine di arrivo», prenotazioni chiuse: P3 (titolare) si ritira: la prima riserva P11 sale, P3 vince Monnezza'
set role authenticated; select as_user('P3'), (book(m('O'), 'absent'))->>'list' as p3; reset role;
select lista(m('O'), 'P11') as p11, chi('ritiro') as monnezza;
\echo '--- 2) P12 (riserva) si ritira dopo la chiusura: può, ma non vince Monnezza'
set role authenticated; select as_user('P12'), (book(m('O'), 'absent'))->>'list' as p12; reset role;
select chi('ritiro') as monnezza;
\set ON_ERROR_STOP 0
\echo '--- 3) P4 (titolare) vuole passare tra le riserve dopo la chiusura: passa dal Leader (atteso errore)'
set role authenticated; select as_user('P4'), book(m('O'), 'reserve'); reset role;
\set ON_ERROR_STOP 1

\echo '--- 4) «sceglie il Leader»: il Leader mette P5 e P6 titolari; prenotazioni chiuse ma liste non confermate: P5 si ritira, niente Monnezza in più'
set role authenticated; select as_user('P1');
select leader_assign(m('F'), pid('P5'), 'team'); select leader_assign(m('F'), pid('P6'), 'team');
reset role;
update matches set bookings_close_at = now() - interval '1 hour' where id = m('F');
set role authenticated; select as_user('P5'), (book(m('F'), 'absent'))->>'list' as p5; reset role;
select chi('ritiro') as monnezza;
\echo '--- 5) il Leader conferma le liste: ora P6 si ritira e vince Monnezza'
set role authenticated; select as_user('P1'), leader_confirm_lists(m('F')); select as_user('P6'), (book(m('F'), 'absent'))->>'list' as p6; reset role;
select chi('ritiro') as monnezza, (select mission from achievements where code = 'ritiro') as missione;

\echo '--- 6) Info: le scrive il Leader, le legge chiunque; un giocatore non può (atteso errore)'
set role authenticated;
select as_user('P1'), set_info_text(E'Regola 1: si arriva puntuali.\n**Chi sbaglia paga la birra.**');
select as_user('P5'); select info_text, info_updated_at is not null as con_data from app_settings;
\set ON_ERROR_STOP 0
select as_user('P5'), set_info_text('Ho vinto io');
\set ON_ERROR_STOP 1
reset role;
