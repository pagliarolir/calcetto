\set ON_ERROR_STOP 1
\pset footer off
-- Password temporanea (migrazione 69): scade dopo 24 ore se non è stata cambiata; cambiandola in tempo resta valida.
insert into auth.users (email, raw_user_meta_data) select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function pid(text) to authenticated, anon;
select mark_password_reset(pid('P2'), pid('P1')), mark_password_reset(pid('P3'), pid('P1'));
\echo '--- P2 la cambia subito; per P3 passano 25 ore'
select set_config('request.jwt.claim.sub', pid('P2')::text, false), password_changed();
update profiles set password_reset_at = now() - interval '25 hours' where id = pid('P3');
select expire_temp_passwords() as scadute;
select n, p.must_change_password as deve_cambiarla, p.password_reset_at is not null as in_corso
from ids join profiles p on p.id = ids.id order by n;
select body from notifications where user_id = pid('P3') and title = 'Password temporanea scaduta';
do $$ begin
  if expire_temp_passwords() <> 0 then raise exception 'una password scade una volta sola'; end if;
  if (select must_change_password from profiles where id = pid('P2')) then raise exception 'P2 l''ha già cambiata'; end if;
end $$;
\echo 'esito: password temporanee a posto'
