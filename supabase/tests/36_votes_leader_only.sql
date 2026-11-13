\set ON_ERROR_STOP 1
\pset footer off
-- «Per votante» solo al Leader (migrazione 49): un'autorizzazione vecchia non basta più, i propri voti si vedono sempre.
insert into auth.users (email, raw_user_meta_data) select lower(n)||'@x.it', jsonb_build_object('first_name', n) from unnest(array['VL','VA','VB']) n;
update profiles set role = 'leader' where first_name = 'VL' and not exists (select 1 from profiles where role = 'leader');
insert into matches (starts_at, nominal_date, status, bookings_open_at, bookings_close_at)
values (now() - interval '3 hours', current_date, 'scheduled', now() - interval '3 days', now() - interval '4 hours');
insert into player_votes (match_id, voter_id, target_id, score)
select (select id from matches order by starts_at desc limit 1), a.id, b.id, 7 from profiles a, profiles b where a.first_name = 'VA' and b.first_name = 'VB';
insert into player_votes (match_id, voter_id, target_id, score)
select (select id from matches order by starts_at desc limit 1), b.id, a.id, 6 from profiles a, profiles b where a.first_name = 'VA' and b.first_name = 'VB';
insert into vote_grants (match_id, user_id, until)
select (select id from matches order by starts_at desc limit 1), id, now() + interval '1 day' from profiles where first_name = 'VA';
select set_config('test.m', (select id::text from matches order by starts_at desc limit 1), false);

\echo '--- VA, autorizzato in passato: non vede i voti degli altri (atteso: falso, 1 voto, il suo)'
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'VA'), false);
set role authenticated;
select can_see_votes(current_setting('test.m')::uuid) as vede_tutti, count(*) as voti_visibili from player_votes where match_id = current_setting('test.m')::uuid;
reset role;

\echo '--- chi ha i poteri del Leader li vede tutti (atteso: vero)'
select set_config('request.jwt.claim.sub', (select id::text from profiles where role = 'leader' limit 1), false);
set role authenticated;
select can_see_votes(current_setting('test.m')::uuid) as vede_tutti;
\echo '--- mostrare i voti a qualcuno non si può più (atteso 1 errore)'
\set ON_ERROR_STOP 0
select grant_vote_visibility(current_setting('test.m')::uuid, array[]::uuid[]);
\set ON_ERROR_STOP 1
reset role;
