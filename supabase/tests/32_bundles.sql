\set ON_ERROR_STOP 1
\pset footer off
-- Bundle (migrazione 45): una chiamata al posto di tante, con gli stessi dati e le stesse regole delle letture separate.
insert into auth.users (email, raw_user_meta_data) select 'b'||g||'@x.it', jsonb_build_object('first_name', 'B'||g) from generate_series(1,3) g;
insert into matches (starts_at, nominal_date, status, bookings_open_at, bookings_close_at) values (now() + interval '3 days', (now() + interval '3 days')::date, 'scheduled', now() - interval '1 hour', now() + interval '2 days');
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'B2'), false);
set role authenticated;
select book((select id from matches limit 1), 'present') is not null as prenotato;

\echo '--- match_bundle: stessi dati delle letture separate (atteso: tutto vero)'
select (b->'match'->>'id')::uuid = m.id as partita,
       (b->'match'->>'ends_at')::timestamptz = ends_at(m) as orari_calcolati,
       jsonb_array_length(b->'board') = (select count(*) from booking_board where match_id = m.id) as lista,
       jsonb_array_length(b->'windows') = (select count(*) from priority_windows where match_id = m.id) as finestre,
       b->'result' = 'null'::jsonb or b->'result' is null as senza_risultato
from matches m, lateral (select match_bundle(m.id) b) x;

\echo '--- match_bundle di una partita inesistente: null (l app mostra «non trovata»)'
select match_bundle('00000000-0000-0000-0000-000000000000') is null as nulla;

\echo '--- stats_bundle: stesse righe di stats_table e data di azzeramento'
select jsonb_array_length(s->'rows') = (select count(*) from stats_table('-infinity', 'infinity')) as classifica,
       s ? 'kits' and s ? 'pkits' and s ? 'pairs' and s ? 'since' as tutte_le_parti
from (select stats_bundle('-infinity', 'infinity') s) x;

\echo '--- bootstrap: profilo, punizione e membri in una chiamata'
select b->'me'->'profile'->>'first_name' as io, jsonb_array_length(b->'members') = (select count(*) from members) as membri,
       b ? 'punishment' as punizione
from (select bootstrap() b) x;
reset role;

\echo '--- senza accesso i bundle non si possono chiamare (atteso 3 errori)'
set role anon;
\set ON_ERROR_STOP 0
select match_bundle('00000000-0000-0000-0000-000000000000');
select stats_bundle('-infinity', 'infinity');
select bootstrap();
\set ON_ERROR_STOP 1
reset role;
