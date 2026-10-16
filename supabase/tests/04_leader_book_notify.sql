\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,13) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, service_role;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function mid() returns uuid language sql as $$ select id from matches order by starts_at limit 1 $$;
grant execute on function as_user(text), mid() to authenticated;
update matches set bookings_open_at = now() - interval '1 day', starts_at = now() + interval '3 days';

set role authenticated;
select as_user('P'||g), book(mid(), 'present') from generate_series(2,10) g;   -- squadra piena: Leader + 9
select as_user('P1');
\echo '--- il Leader inserisce P11 a squadra piena: P11 avvisato (team, con pulsante), l ultimo arrivato P10 scende tra le riserve ed e avvisato'
select leader_book(mid(), (select id from ids where n='P11'), 'present');
\echo '--- il Leader mette P12 tra le riserve, poi segna P11 assente'
select leader_book(mid(), (select id from ids where n='P12'), 'reserve');
select leader_book(mid(), (select id from ids where n='P11'), 'absent');
\echo '--- il Leader modifica se stesso: nessun avviso'
select book(mid(), 'absent');
reset role;

select (select n from ids where id = user_id) as a_chi, kind, title, body, actions is not null as con_pulsante
from notifications where kind in ('placed_by_leader', 'demoted', 'promoted') order by id;
\echo '--- atteso: P11 team+pulsante, P10 demoted, P12 reserve+pulsante, P11 assente senza pulsante, nessun avviso a P1, e P10/P12 che salgono quando il Leader esce'
select count(*) as avvisi_a_P1 from notifications where user_id = (select id from ids where n='P1');
\echo '--- un giocatore normale non puo usarla (atteso: errore)'
\set ON_ERROR_STOP 0
set role authenticated;
select as_user('P4'), leader_book(mid(), (select id from ids where n='P13'), 'present');
reset role;
