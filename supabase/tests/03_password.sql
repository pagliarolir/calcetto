\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,5) g;
update profiles set role='premier1' where first_name='P2';
update profiles set role='premier2' where first_name='P3';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, service_role;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated, service_role;

\echo '--- chi può reimpostare la password di chi (attese: L->P4 t, L->P2 t, L->se stesso f, P2->P4 t, P2->P3 f, P2->L f, P4->P5 f)'
set role authenticated;
select as_user('P1'), can_reset_password(pid('P4')) as l_user, can_reset_password(pid('P2')) as l_premier, can_reset_password(pid('P1')) as l_self;
select as_user('P2'), can_reset_password(pid('P4')) as p_user, can_reset_password(pid('P3')) as p_premier, can_reset_password(pid('P1')) as p_leader;
select as_user('P4'), can_reset_password(pid('P5')) as user_user;
\echo '--- un utente non può chiamare direttamente mark_password_reset (atteso: permesso negato)'
\set ON_ERROR_STOP 0
select as_user('P4'), mark_password_reset(pid('P5'), pid('P4'));
\set ON_ERROR_STOP 1
reset role;

\echo '--- reimpostazione fatta da un Premier: obbligo di cambio + avviso a interessato e Leader'
set role service_role;
select mark_password_reset(pid('P4'), pid('P2'));
reset role;
select (select n from ids where id = profiles.id) as chi, must_change_password from profiles where id = pid('P4');
select kind, (select n from ids where id = user_id) as a_chi from notifications where kind like 'password%' order by kind;

\echo '--- P4 sceglie la nuova password: obbligo rimosso'
set role authenticated;
select as_user('P4'), password_changed();
reset role;
select must_change_password from profiles where id = pid('P4');
