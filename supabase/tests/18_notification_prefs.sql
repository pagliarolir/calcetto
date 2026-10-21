\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,13) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
create function chi(k text) returns text language sql as $$ select coalesce(string_agg((select n from ids where id = user_id), ',' order by (select n from ids where id = user_id)), '-') from notifications where kind = k $$;
grant execute on function as_user(text), pid(text), mid(), chi(text) to authenticated;
update matches set bookings_open_at = now() - interval '1 day', starts_at = now() + interval '3 days', bookings_close_at = now() + interval '3 days';

\echo '--- 1) all inizio: chat spenta, il resto acceso'
select notify_wanted('{}', 'chat') as chat, notify_wanted('{}', 'booking_open') as prenotazioni, notify_wanted('{}', 'votes_open') as voti, notify_wanted('{}', 'promoted') as personale;

\echo '--- 2) ognuno cambia le proprie preferenze: P3 accende la chat, P5 spegne "squadra al completo", P6 spegne "rinunce", P7 spegne tutto'
set role authenticated;
select as_user('P3'); update profiles set notify_prefs = '{"chat": true}' where id = pid('P3');
select as_user('P5'); update profiles set notify_prefs = '{"team_full": false}' where id = pid('P5');
select as_user('P6'); update profiles set notify_prefs = '{"withdrawal": false}' where id = pid('P6');
select as_user('P7'); update profiles set notify_prefs = '{"chat": false, "booking_open": false, "team_full": false, "withdrawal": false, "lineup_official": false, "lineup_change": false, "match_changes": false, "result": false, "votes": false}' where id = pid('P7');
reset role;

\echo '--- 3) squadra al completo: P2..P10 si prenotano (con il Leader sono 10); avvisati tutti tranne P10 (che la completa), P5 e P7'
set role authenticated;
select as_user('P'||g), book(mid(), 'present') from generate_series(2,10) g;
select as_user('P11'), book(mid(), 'present');
reset role;
select chi('team_full') as avvisati_squadra_completa;

\echo '--- 4) rinuncia di P4: avvisati quelli in lista tranne P4, P6 e P7 (la riserva P11 sale e lo sa)'
set role authenticated; select as_user('P4'), book(mid(), 'absent'); reset role;
select chi('withdrawal') as avvisati_rinuncia;

\echo '--- 5) chat: avvisato solo chi l ha accesa (P3), non l autore; un secondo messaggio entro 10 minuti non ne crea un altro'
set role authenticated;
select as_user('P2'); insert into chat_messages (match_id, user_id, body) values (mid(), pid('P2'), 'Chi porta il pallone?');
select as_user('P8'); insert into chat_messages (match_id, user_id, body) values (mid(), pid('P8'), 'Lo porto io');
reset role;
select chi('chat') as avvisati_chat, (select title || ': ' || body from notifications where kind = 'chat' limit 1) as testo;
update notifications set read_at = now() where kind = 'chat';
set role authenticated; select as_user('P8'); insert into chat_messages (match_id, user_id, body) values (mid(), pid('P8'), 'Anzi no'); reset role;
select count(*) as avvisi_chat_dopo_la_lettura from notifications where kind = 'chat';

\echo '--- 6) apertura prenotazioni e avvisi personali: P7 (tutto spento) riceve solo quelli personali'
select notify(array[pid('P7'), pid('P9')], 'booking_open', 'Si gioca', 'Ci sei?');
select notify(array[pid('P7')], 'promoted', 'Sei dentro!', 'Si è liberato un posto.');
select chi('booking_open') as apertura, chi('promoted') as personale;
