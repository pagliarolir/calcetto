\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,5) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated;
insert into bookings (match_id, user_id, choice, list) select (select id from matches limit 1), pid('P3'), 'present', 'team';

\echo '--- 1) P3 cancellato dal gruppo e poi eliminato: profilo, account e prenotazioni spariscono'
set role authenticated; select as_user('P1');
select deactivate_member(pid('P3'));
select delete_former_member(pid('P3')) is null as senza_foto;
reset role;
select (select count(*) from profiles where id = pid('P3')) as profilo, (select count(*) from auth.users where id = pid('P3')) as account,
       (select count(*) from bookings where user_id = pid('P3')) as prenotazioni;

\set ON_ERROR_STOP 0
\echo '--- 2) casi vietati (attesi 3 errori): giocatore ancora nel gruppo, giocatore normale, il Leader stesso'
set role authenticated;
select as_user('P1'), delete_former_member(pid('P4'));
select as_user('P2'), delete_former_member(pid('P5'));
select as_user('P1'), delete_former_member(pid('P1'));
\set ON_ERROR_STOP 1

\echo '--- 3) ex giocatore senza account: si elimina il profilo'
select as_user('P1');
reset role; create temp table g (id uuid); grant select, insert on g to authenticated; set role authenticated; select as_user('P1');
insert into g select create_guest('Ospite');
reset role;
update profiles set active = false where id = (select id from g);
set role authenticated; select as_user('P1');
select delete_former_member((select id from g)) is null;
reset role;
select count(*) as ospite_rimasto from profiles where first_name = 'Ospite';
