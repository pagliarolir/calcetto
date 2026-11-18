\set ON_ERROR_STOP 1
\pset footer off
-- FantaLeader (migrazione 72): la voce la vede solo Bobbo, non il Leader né gli altri; Bobbo è nell'anteprima.
insert into auth.users (email, raw_user_meta_data) values
  ('l@x.it', '{"first_name":"Leo"}'), ('b@x.it', '{"first_name":"Roberto"}'), ('g@x.it', '{"first_name":"Gino"}');
update profiles set active = true where true;
update profiles set nickname = 'Bobbo' where first_name = 'Roberto';
update fl_settings set preview_users = (select coalesce(array_agg(id), '{}') from profiles where active and not guest and pay_is_bobbo(id)) where id = 1;
create temp table esito (chi text, vede boolean);
grant all on esito to authenticated;
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'Leo'), false);
insert into esito select 'Leader', fl_visible();
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'Roberto'), false);
insert into esito select 'Bobbo', fl_visible();
select set_config('request.jwt.claim.sub', (select id::text from profiles where first_name = 'Gino'), false);
insert into esito select 'Gino', fl_visible();
select * from esito order by chi;
do $$ begin
  if (select vede from esito where chi = 'Leader') then raise exception 'il Leader non deve vedere FantaLeader'; end if;
  if not (select vede from esito where chi = 'Bobbo') then raise exception 'Bobbo deve vedere FantaLeader'; end if;
  if (select vede from esito where chi = 'Gino') then raise exception 'gli altri non devono vedere FantaLeader'; end if;
end $$;
\echo 'esito: FantaLeader solo a Bobbo'
