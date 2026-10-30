\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,12) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
grant execute on function as_user(text), pid(text), mid() to authenticated;
-- partita giocata da P1..P10, 3-1, omologata, votazioni aperte
insert into bookings (match_id, user_id, choice, list) select mid(), pid('P'||g), 'present', 'team' from generate_series(2,10) g on conflict do nothing;
insert into lineup (match_id, user_id, team) select mid(), pid('P'||g), case when g <= 5 then 'white' else 'black' end from generate_series(1,10) g;
update matches set status = 'played', lineup_status = 'official', starts_at = now() - interval '3 hours', bookings_close_at = now() - interval '4 hours',
  votes_opens_at = now() - interval '1 hour', votes_closes_at = now() + interval '1 day', mvp_mode = 'single';
insert into results (match_id, diff, white_goals, black_goals, status) values (mid(), 2, 3, 1, 'homologated');
create function vota(chi text) returns void language sql as $$
  select as_user(chi);
  select submit_votes(mid(), (select jsonb_agg(jsonb_build_object('target_id', l.user_id, 'score', 7)) from lineup l where l.match_id = mid() and l.user_id <> pid(chi)), pid('P3'), null);
$$;
create function vista(chi text) returns text language sql as $$
  select as_user(chi);
  select format('votanti %s | medie nascoste %s | migliore nascosto %s (serve %s) | media di P3 %s | migliore %s',
    s->>'voters', s->>'avgs_hidden', s->>'mvp_hidden', s->>'mvp_threshold',
    coalesce((select x->>'avg' from jsonb_array_elements(s->'players') x where (x->>'user_id')::uuid = pid('P3')), '-'),
    coalesce((select string_agg((select n from ids where id = (x->>'user_id')::uuid), ',') from jsonb_array_elements(s->'players') x where (x->>'is_mvp')::boolean), '-'))
  from (select vote_summary(mid()) s) z $$;
grant execute on function vota(text), vista(text) to authenticated;
create function mvp_in_stats() returns bigint language sql as $$ select coalesce(sum(mvp_count), 0) from stats_table() $$;

\echo '--- 1) un solo votante: medie nascoste (si leggerebbero i suoi voti); il Leader vede tutto'
set role authenticated; select vota('P2'); select vista('P4') as giocatore; select vista('P1') as leader; reset role;
\echo '--- 2) due votanti: medie visibili, migliore ancora segreto'
set role authenticated; select vota('P4'); select vista('P5') as giocatore; reset role;
\echo '--- 3) cinque votanti: migliore segreto anche nelle statistiche'
set role authenticated; select vota('P5'); select vota('P6'); select vota('P7'); select vista('P8') as giocatore; reset role;
select mvp_in_stats() as migliori_in_classifica;
\echo '--- 4) sei votanti su dieci: il migliore si scopre, anche nelle statistiche'
set role authenticated; select vota('P8'); select vista('P9') as giocatore; reset role;
select mvp_in_stats() as migliori_in_classifica;

\echo '--- 5) «sceglie il Leader», prenotazioni chiuse: P11 non aveva risposto, entra come riserva; P2 aveva risposto (atteso errore)'
select create_match(now() + interval '2 days') is not null;
update matches set booking_mode = 'free', bookings_open_at = now() - interval '2 days', bookings_close_at = now() - interval '1 hour' where status = 'scheduled';
insert into bookings (match_id, user_id, choice, list) select id, pid('P2'), 'present', 'pending' from matches where status = 'scheduled';
set role authenticated;
select as_user('P11'), (book((select id from matches where status = 'scheduled'), 'present'))->>'list' as p11_dopo_la_chiusura;
\set ON_ERROR_STOP 0
select as_user('P2'), book((select id from matches where status = 'scheduled'), 'absent');
\echo '--- 6) risultato con il solo scarto (atteso errore): si inserisce solo il risultato esatto'
select as_user('P2'), submit_result(mid(), 2);
\set ON_ERROR_STOP 1
reset role;
