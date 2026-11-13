\set ON_ERROR_STOP 1
\pset footer off
-- «Per votante» (migrazione 50): il Leader vede tutto e può mostrare i voti a qualcuno; gli altri vedono solo i propri.
insert into auth.users (email, raw_user_meta_data) select lower(n)||'@x.it', jsonb_build_object('first_name', n) from unnest(array['VL','VA','VB']) n;  -- il primo account (VL) diventa Leader
insert into matches (starts_at, nominal_date, status, bookings_open_at, bookings_close_at)
values (now() - interval '3 hours', current_date, 'scheduled', now() - interval '3 days', now() - interval '4 hours');
select set_config('test.m', (select id::text from matches order by starts_at desc limit 1), false);
insert into player_votes (match_id, voter_id, target_id, score)
select current_setting('test.m')::uuid, a.id, b.id, 7 from profiles a, profiles b where a.first_name = 'VA' and b.first_name = 'VB';
insert into player_votes (match_id, voter_id, target_id, score)
select current_setting('test.m')::uuid, b.id, a.id, 6 from profiles a, profiles b where a.first_name = 'VA' and b.first_name = 'VB';

\echo '--- VA senza autorizzazione: solo il proprio voto (atteso: falso, 1)'
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'VA'), false);
set role authenticated;
select can_see_votes(current_setting('test.m')::uuid) as vede_tutti, count(*) as voti_visibili from player_votes where match_id = current_setting('test.m')::uuid;
reset role;

\echo '--- il Leader mostra i voti a VA'
select set_config('request.jwt.claim.sub', (select id::text from profiles where role = 'leader' limit 1), false);
select set_config('test.va', (select id::text from profiles where first_name = 'VA'), false);
set role authenticated;
select grant_vote_visibility(current_setting('test.m')::uuid, array[current_setting('test.va')::uuid]);
reset role;

\echo '--- ora VA li vede tutti (atteso: vero, 2)'
select set_config('request.jwt.claim.sub', current_setting('test.va'), false);
set role authenticated;
select can_see_votes(current_setting('test.m')::uuid) as vede_tutti, count(*) as voti_visibili from player_votes where match_id = current_setting('test.m')::uuid;
reset role;
