\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,4) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant execute on function as_user(text), pid(text) to authenticated;
do $$ begin execute 'load ''safeupdate'''; exception when others then raise notice 'safeupdate non disponibile: test senza il controllo di Supabase'; end $$;   -- come le richieste dell'app su Supabase (se la libreria c'è)
update profiles set field_role = 'difensore_centrale' where id = pid('P2');

\echo '--- 1) il Leader inserisce i valori di P2: tutto 80, finalizzazione 100, marcatura 40, pallino verde'
set role authenticated; select as_user('P1');
select set_player_ratings(pid('P2'), jsonb_build_object('shot_accuracy',80,'shot_power',80,'finishing',100,'dribbling',80,'speed',80,'agility',80,
  'stamina',80,'marking',40,'ball_protection',80,'strength',80,'positioning',80,'ball_control',80,'passing',80), 'green', null) as scheda;
\echo '--- 2) P3 non legge le caratteristiche (0 righe) ma vede la scheda calcolata'
select as_user('P3');
select count(*) as caratteristiche_lette_da_p3 from player_ratings;
select c ->> 'role' as ruolo, c ->> 'role_value' as valore_nel_ruolo, c ->> 'best' as ruolo_migliore, c ->> 'pu' as punta, c ->> 'eo' as est_off, c ->> 'ed' as est_dif,
       c ->> 'dc' as centrale, c ->> 'cen' as centro, c ->> 'overall' as generale, c -> 'hex' as esagono
from jsonb_array_elements(player_cards(array[pid('P2')])) c;
\set ON_ERROR_STOP 0
\echo '--- 3) un giocatore non cambia valori, profilo o foto degli altri (attesi 3 errori)'
select as_user('P3'), set_player_ratings(pid('P3'), '{"finishing": 100}', null, 99);
select as_user('P3'), admin_update_profile(pid('P2'), '{"nickname": "Scarso"}');
select as_user('P3'), admin_set_avatar(pid('P2'), pid('P2')::text || '/' || gen_random_uuid() || '.jpg');
\echo '--- 4) foto in una cartella sbagliata e ruolo vecchio rifiutati (attesi 2 errori)'
select as_user('P1'), admin_set_avatar(pid('P2'), pid('P3')::text || '/' || gen_random_uuid() || '.jpg');
reset role; update profiles set field_role = 'pivot' where id = pid('P4'); set role authenticated;
\set ON_ERROR_STOP 1
\echo '--- 5) il Leader modifica profilo e foto di P2, e imposta il valore a mano (90)'
select as_user('P1'), admin_update_profile(pid('P2'), '{"nickname": "Il Muro", "field_role": "punta", "weight_kg": "82"}');
select as_user('P1'), admin_set_avatar(pid('P2'), pid('P2')::text || '/' || gen_random_uuid() || '.jpg') as foto_precedente;
reset role; select nickname, field_role, weight_kg, avatar_path like id::text || '/%.jpg' as foto_nuova from profiles where id = pid('P2'); set role authenticated;
select as_user('P1'), (set_player_ratings(pid('P2'), (select to_jsonb(r) - 'user_id' - 'gk' - 'override' - 'updated_at' - 'updated_by' from player_ratings r where user_id = pid('P2')), 'green', 90)) ->> 'role_value' as valore_a_mano;
\echo '--- 6) valori incompleti: niente scheda (solo pallino)'
select as_user('P1'), (set_player_ratings(pid('P4'), '{"finishing": 70}', 'yellow', null)) ->> 'has' as scheda_completa;
reset role;
