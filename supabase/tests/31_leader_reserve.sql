\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data) select 'r'||g||'@x.it', jsonb_build_object('first_name', 'R'||g) from generate_series(1,3) g;
insert into matches (starts_at, nominal_date, status, bookings_open_at, bookings_close_at) values (now() + interval '3 days', (now() + interval '3 days')::date, 'scheduled', now() - interval '1 hour', now() + interval '2 days');
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'R1'), false);
set role authenticated;
\echo '--- il Leader (R1, primo iscritto) si mette in riserva'
select book((select id from matches limit 1), 'reserve') is not null as fatto;
reset role;
select p.first_name, b.choice, b.list from bookings b join profiles p on p.id = b.user_id where p.first_name = 'R1';
