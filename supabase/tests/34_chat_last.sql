\set ON_ERROR_STOP 1
\pset footer off
-- Pallino della Chat (migrazione 47): il bundle porta l'ora dell'ultimo messaggio scritto dagli ALTRI.
insert into auth.users (email, raw_user_meta_data) select 'c'||g||'@x.it', jsonb_build_object('first_name', 'C'||g) from generate_series(1,2) g;
insert into matches (starts_at, nominal_date, status, bookings_open_at, bookings_close_at) values (now() + interval '3 days', (now() + interval '3 days')::date, 'scheduled', now() - interval '1 hour', now() + interval '2 days');
insert into chat_messages (match_id, user_id, body, created_at) select (select id from matches limit 1), id, 'ciao', now() - interval '2 hours' from profiles where first_name = 'C1';
insert into chat_messages (match_id, user_id, body, created_at) select (select id from matches limit 1), id, 'eccomi', now() - interval '1 hour' from profiles where first_name = 'C2';

\echo '--- C2 vede come ultimo il messaggio di C1 (il proprio non conta); C1 quello di C2 (atteso: vero, vero)'
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'C2'), false);
set role authenticated;
select (match_bundle((select id from matches limit 1))->>'chat_last')::timestamptz < now() - interval '90 minutes' as solo_degli_altri;
reset role;
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'C1'), false);
set role authenticated;
select (match_bundle((select id from matches limit 1))->>'chat_last')::timestamptz > now() - interval '90 minutes' as ultimo_di_c2;
reset role;
