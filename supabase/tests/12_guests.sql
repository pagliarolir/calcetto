\set ON_ERROR_STOP 1
\pset footer off
\i seed_demo.sql
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function as_id(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', p::text, false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
grant select on ids to authenticated, anon; grant execute on function as_user(text), as_id(uuid), pid(text) to authenticated, anon;
create temp table g (n text, id uuid); grant select, insert on g to authenticated, anon;
create function gid(p text) returns uuid language sql as $$ select id from g where n = p $$; grant execute on function gid(text) to authenticated, anon;

\echo '--- 1) il Leader crea due giocatori senza account; un giocatore normale no (atteso errore)'
set role authenticated; select as_user('Marco');
insert into g select 'Gianni', create_guest('Gianni', 'Esposito', null, 'pivot');
insert into g select 'Tonio', create_guest('Tonio', null, 'Il Muro', 'difensore');
\set ON_ERROR_STOP 0
select as_user('Paolo'), create_guest('Abusivo');
\set ON_ERROR_STOP 1
select as_user('Marco');
select first_name, guest, active from members where guest order by first_name;

\echo '--- 2) Gianni in lista e in formazione nella prossima partita; partita giocata, votato da altri; in classifica'
create temp table nx as select id from matches where status = 'scheduled' limit 1; grant select on nx to authenticated, anon;
select leader_book((select id from nx), gid('Gianni'), 'present');
reset role;
update matches set starts_at = now() - interval '2 hours', bookings_close_at = now() - interval '3 hours' where id = (select id from nx);
insert into lineup (match_id, user_id, team, field_slot)
  select (select id from nx), user_id, case when row_number() over (order by sort_key) % 2 = 0 then 'white' else 'black' end, null
  from bookings where match_id = (select id from nx) and list = 'team';
insert into results (match_id, diff, white_goals, black_goals, status) values ((select id from nx), 1, 3, 2, 'homologated');
update matches set status = 'played' where id = (select id from nx);
insert into scorers (match_id, user_id, goals) values ((select id from nx), gid('Gianni'), 2);
set role authenticated;
select as_user('Luca'), submit_votes((select id from nx), jsonb_build_array(jsonb_build_object('target_id', gid('Gianni'), 'score', 8)), gid('Gianni'), null);
select as_user('Simone'), submit_votes((select id from nx), jsonb_build_array(jsonb_build_object('target_id', gid('Gianni'), 'score', 7.5)), gid('Gianni'), null);
select as_user('Matteo'), submit_votes((select id from nx), jsonb_build_array(jsonb_build_object('target_id', gid('Gianni'), 'score', 7)), gid('Gianni'), null);
select as_user('Marco');
select played, goals, attendances, avg_vote from stats_table() where user_id = gid('Gianni');
reset role;
select count(*) as avvisi_a_gianni from notifications where user_id = gid('Gianni');
select count(*) as voti_ricevuti from player_votes where target_id = gid('Gianni');

\set ON_ERROR_STOP 0
\echo '--- 3) servono un account (attesi 5 errori): Premier, delega, passaggio da Leader, squadre affidate, punizione'
set role authenticated; select as_user('Marco');
select set_member_role(gid('Tonio'), 'premier2');
select delegate_leadership(gid('Tonio'), null);
select transfer_leadership(gid('Tonio'));
select set_lineup_delegate((select id from nx), gid('Tonio'));
select punish_member(gid('Tonio'), null, null);
\set ON_ERROR_STOP 1
select can_reset_password(gid('Tonio')) as password_reimpostabile;

\echo '--- 4) invito: si legge anche senza accedere; scaduto non vale'
select (create_guest_invite(gid('Gianni'))->>'token') is not null as invito_creato;
reset role;
create temp table tok as select invite_token t from profiles where id = gid('Gianni'); grant select on tok to anon, authenticated;
set role anon;
select invite_info((select t from tok))->>'first_name' as visto_da_anonimo, invite_info('sbagliato') is null as token_sbagliato;
reset role;

\echo '--- 5) registrazione dall invito con codice di gruppo attivo: entra subito ed eredita tutto'
update app_settings set invite_code = 'segreto';
insert into auth.users (email, raw_user_meta_data) values ('giovanni@x.it', jsonb_build_object('first_name', 'Giovanni', 'link_token', (select t from tok)));
create temp table nuovo as select id from auth.users where email = 'giovanni@x.it'; grant select on nuovo to authenticated;
select first_name, last_name, field_role, active, pending, guest from profiles where id = (select id from nuovo);
select (select count(*) from profiles where id = gid('Gianni')) as profilo_senza_account_rimasto,
       (select count(*) from bookings where user_id = (select id from nuovo)) as prenotazioni,
       (select count(*) from lineup where user_id = (select id from nuovo)) as formazioni,
       (select goals from scorers where user_id = (select id from nuovo)) as gol,
       (select count(*) from player_votes where target_id = (select id from nuovo)) as voti_ricevuti,
       (select count(*) from notifications where kind = 'guest_linked') as avvisi_allo_staff;
set role authenticated; select as_user('Marco');
select played, goals, attendances, avg_vote from stats_table() where user_id = (select id from nuovo);
reset role;

\echo '--- 6) account esistente (Paolo) si unisce a Tonio; partita in comune: resta il dato di Paolo'
set role authenticated; select as_user('Marco');
select create_guest_invite(gid('Tonio')) is not null;
reset role;
-- Tonio e Paolo nella stessa partita giocata: due righe di formazione per la stessa partita
insert into bookings (match_id, user_id, choice, list) values ((select id from nx), gid('Tonio'), 'present', 'team') on conflict do nothing;
insert into bookings (match_id, user_id, choice, list) values ((select id from nx), pid('Paolo'), 'present', 'team') on conflict do nothing;
insert into lineup (match_id, user_id, team) values ((select id from nx), gid('Tonio'), 'white') on conflict do nothing;
insert into lineup (match_id, user_id, team) values ((select id from nx), pid('Paolo'), 'black') on conflict (match_id, user_id) do update set team = 'black';
select count(*) as righe_paolo_tonio_prima from lineup where match_id = (select id from nx) and user_id in (pid('Paolo'), gid('Tonio'));
create temp table tok2 as select invite_token t from profiles where id = gid('Tonio'); grant select on tok2 to authenticated;
set role authenticated; select as_user('Paolo');
select claim_guest_profile((select t from tok2)) as collegato_a;
reset role;
select (select count(*) from lineup where match_id = (select id from nx) and user_id = pid('Paolo')) as righe_paolo_dopo,
       (select team from lineup where match_id = (select id from nx) and user_id = pid('Paolo')) as squadra_di_paolo,
       (select nickname from profiles where id = pid('Paolo')) as soprannome_ereditato,
       (select count(*) from profiles where id = gid('Tonio')) as profilo_tonio_rimasto;

\set ON_ERROR_STOP 0
\echo '--- 7) invito gia usato o inventato (attesi 2 errori)'
set role authenticated; select as_user('Luca');
select claim_guest_profile((select t from tok2));
select claim_guest_profile('inventato');
\set ON_ERROR_STOP 1
reset role;

\echo '--- 8) eliminazione: un giocatore senza account sparisce con i suoi dati; un account eliminato porta via il profilo'
set role authenticated; select as_user('Marco');
insert into g select 'Usa e getta', create_guest('Usa e getta');
reset role;
create temp table m8 as select create_match(now() + interval '5 days') id; grant select on m8 to authenticated;
set role authenticated; select as_user('Marco');
select leader_book((select id from m8), gid('Usa e getta'), 'present') is not null;
select delete_guest(gid('Usa e getta'));
reset role;
select (select count(*) from profiles where id = gid('Usa e getta')) as profilo, (select count(*) from bookings where user_id = gid('Usa e getta')) as prenotazioni;
delete from auth.users where email = 'giovanni@x.it';
select count(*) as profilo_di_giovanni_dopo_eliminazione_account from profiles where id = (select id from nuovo);
