\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,5) g;
update profiles set role = 'premier1' where first_name = 'P2';
update profiles set active = false where first_name = 'P5';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function foto(p text) returns text language sql as $$ select pid(p)::text || '/11111111-2222-3333-4444-555555555555.jpg' $$;
grant execute on function as_user(text), pid(text), foto(text) to authenticated;
\echo '--- contenitore creato dalla migrazione (atteso: avatars, privato, solo jpeg)'
select id, public, file_size_limit, allowed_mime_types from storage.buckets;

set role authenticated;
\echo '--- P3 carica la sua foto e la collega al profilo (atteso: ok)'
select as_user('P3');
insert into storage.objects (bucket_id, name) values ('avatars', foto('P3'));
update profiles set avatar_path = foto('P3') where id = pid('P3');
\set ON_ERROR_STOP 0
\echo '--- P3 prova a caricare nella cartella di P4 (atteso: errore di sicurezza)'
insert into storage.objects (bucket_id, name) values ('avatars', foto('P4'));
\echo '--- P3 prova a usare come sua la foto di P4 (atteso: errore sul vincolo)'
update profiles set avatar_path = foto('P4') where id = pid('P3');
\set ON_ERROR_STOP 1
\echo '--- P4 vede la foto di P3, nel contenitore e nella vista dei membri (attesi: 1 e il percorso)'
select as_user('P4');
select count(*) as foto_visibili from storage.objects where bucket_id = 'avatars';
select avatar_path is not null as p3_ha_foto from members where id = pid('P3');
\echo '--- P3 nasconde la foto: P4 non la vede piu, P3 si (attesi: f, t)'
select as_user('P3');
update profiles set visibility = visibility || '{"avatar": false}' where id = pid('P3');
select as_user('P4'); select avatar_path is not null as visibile_a_p4 from members where id = pid('P3');
select as_user('P3'); select avatar_path is not null as visibile_a_p3 from members where id = pid('P3');
update profiles set visibility = visibility || '{"avatar": true}' where id = pid('P3');
\echo '--- utente disattivato: non vede le foto (atteso: 0)'
select as_user('P5'); select count(*) as foto_visibili_a_disattivato from storage.objects;
\echo '--- P4 prova a cancellare la foto di P3 (atteso: 0 righe cancellate) e a usare la funzione dello staff (atteso: errore)'
select as_user('P4');
with d as (delete from storage.objects where name = foto('P3') returning 1) select count(*) as cancellate_da_p4 from d;
\set ON_ERROR_STOP 0
select remove_member_avatar(pid('P3'));
\set ON_ERROR_STOP 1
\echo '--- il Premier P2 rimuove la foto di P3: profilo pulito, file cancellabile, avviso a P3'
select as_user('P2');
select remove_member_avatar(pid('P3')) = foto('P3') as percorso_restituito;
with d as (delete from storage.objects where name = foto('P3') returning 1) select count(*) as cancellate_da_premier from d;
reset role;
select avatar_path is null as profilo_pulito from profiles where id = pid('P3');
select kind, (select n from ids where id = user_id) as a_chi from notifications where kind = 'avatar_removed';
