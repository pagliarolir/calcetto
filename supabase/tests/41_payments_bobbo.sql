\set ON_ERROR_STOP 1
\pset footer off
-- Pagamenti (migrazione 55): chi ha il soprannome «Bobbo» li vede anche senza nome e anche se il soprannome
-- è arrivato dopo la migrazione; un soprannome solo simile no.
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,4) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
grant execute on function as_user(text) to authenticated, anon;
update profiles set first_name = '-', nickname = ' BOBBO 🐻' where id = (select id from ids where n = 'P2');
update profiles set nickname = 'Bobbone' where id = (select id from ids where n = 'P3');
update profiles set first_name = 'Bobbo' where id = (select id from ids where n = 'P4');
-- l'anteprima: dalla migrazione 67 i Conti sono aperti a tutti
update pay_settings set public = false where id = 1;
\echo '--- Leader sì, Bobbo senza nome sì (anche senza essere nell elenco), Bobbone no, chi si chiama Bobbo di nome sì'
select as_user('P1'), pay_visible() as leader;
select as_user('P2'), pay_visible() as bobbo;
select as_user('P3'), pay_visible() as bobbone;
select as_user('P4'), pay_visible() as bobbo_di_nome;
do $$ begin
  perform as_user('P1'); if not pay_visible() then raise exception 'il Leader deve vedere i Pagamenti'; end if;
  perform as_user('P2'); if not pay_visible() then raise exception 'Bobbo deve vedere i Pagamenti'; end if;
  perform as_user('P3'); if pay_visible() then raise exception 'Bobbone non deve vederli'; end if;
  perform as_user('P4'); if not pay_visible() then raise exception 'anche chi si chiama Bobbo di nome li vede'; end if;
end $$;
\echo '    pagina di Bobbo:'
select as_user('P2'), (pay_overview() ->> 'balance_cents') as saldo_bobbo;
