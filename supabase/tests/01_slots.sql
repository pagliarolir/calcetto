\set ON_ERROR_STOP 1
\pset footer off
-- 14 utenti: il primo diventa Leader
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,14) g;
select first_name, role, active from profiles order by first_name limit 2;
update profiles set role='premier1' where first_name='P2';
update profiles set role='premier2' where first_name='P3';
-- la partita esiste già (creata dalla migrazione) col Leader dentro: apriamo le prenotazioni
update matches set bookings_open_at = now() - interval '1 hour', starts_at = now() + interval '3 days', bookings_close_at = now() + interval '3 days';
create temp table ids as select first_name n, id from profiles;
grant select on ids to authenticated;
create or replace function as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create or replace function mid() returns uuid language sql as $$ select id from matches limit 1 $$;
grant execute on function as_user(text), mid() to authenticated;
create or replace view board as select bb.slot, i.n, bb.list, bb.choice from booking_board bb join ids i on i.id = bb.user_id order by bb.list desc, bb.slot;
grant select on board to authenticated;

set role authenticated;
-- P2..P12 presenti (11 persone): con il Leader i primi 9 entrano (slot 2..10), P11 e P12 riserve 11,12
select as_user('P'||g), book(mid(), 'present') from generate_series(2,12) g;
-- P13 si segna riserva: slot 13
select as_user('P13'), book(mid(), 'reserve');
\echo '--- tabellone iniziale (atteso: P1=1, P2..P10=2..10, P11=11, P12=12, P13=13)'
select * from board;

-- Il Leader dichiara assenza: slot 1 vuoto, entra P11 (slot 11), riserve da 12
select as_user('P1'), book(mid(), 'absent');
\echo '--- Leader assente (atteso: squadra 2..11 con P11, riserve P12=12, P13=13)'
select * from board where list <> 'out';

-- P5 rinuncia: le riserve scalano, entra P12
select as_user('P5'), book(mid(), 'absent');
\echo '--- P5 rinuncia (atteso: P12 entra, P13 riserva 12)'
select * from board where list <> 'out';

-- P5 ci ripensa: squadra piena, finisce ultimo tra le riserve
select as_user('P5'), book(mid(), 'present');
\echo '--- P5 torna presente (atteso: riserve P13=12, P5=13)'
select * from board where list = 'reserve';

-- Il Leader torna: è di nuovo 1, l'ultimo entrato scende in testa alle riserve
select as_user('P1'), book(mid(), 'present');
\echo '--- Leader rientra (atteso: P1=1, P12 scende prima riserva)'
select * from board where list <> 'out';

-- Riserva non può essere scelta dal Leader
\set ON_ERROR_STOP 0
select as_user('P1'), book(mid(), 'reserve');
-- Un utente normale non può prenotare per altri
select as_user('P4'), leader_book(mid(), (select id from ids where n='P14'), 'present');
\set ON_ERROR_STOP 1
-- Il Leader inserisce P14 direttamente nei 10: scende l'ultimo arrivato
select as_user('P1'), leader_book(mid(), (select id from ids where n='P14'), 'present');
\echo '--- Leader inserisce P14 (atteso: P14 in squadra, P11 prima riserva)'
select * from board where list <> 'out';
reset role;
\echo '--- avvisi generati'
select kind, count(*) from notifications group by kind order by kind;
