\set ON_ERROR_STOP 1
\pset footer off
insert into auth.users (email, raw_user_meta_data)
select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,12) g;
update profiles set created_at = now() - interval '1 year';
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated;
create function as_user(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', (select id::text from ids where n = p), false) $$;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
create function chi(c text) returns text language sql as $$
  select coalesce(string_agg((select n from ids where id = pa.user_id), ',' order by (select n from ids where id = pa.user_id)), '-')
  from player_achievements pa join achievements a on a.id = pa.achievement_id where a.code = c $$;
grant execute on function as_user(text), pid(text), chi(text) to authenticated;
grant select on ids to authenticated;
delete from matches;

-- 7 partite giocate, una a settimana. Bianchi (vincono sempre 3-1): P1, P2, P4, P8, P9. Neri: P5, P6, P10, P11 e P12,
-- poi dalla sesta P3 al posto di P12. P4 fa 3 gol a partita, P5 un autogol nella prima.
do $$
declare i int; m uuid; whites text[] := array['P1','P2','P4','P8','P9']; blacks text[]; p text;
begin
  for i in 1..7 loop
    m := create_match(now() - make_interval(days => 7 * (8 - i)));
    blacks := case when i >= 6 then array['P5','P6','P10','P11','P3'] else array['P5','P6','P10','P11','P12'] end;
    delete from bookings where match_id = m;
    foreach p in array whites || blacks loop
      insert into bookings (match_id, user_id, choice, list) values (m, pid(p), 'present', 'team');
      insert into lineup (match_id, user_id, team) values (m, pid(p), case when p = any (whites) then 'white' else 'black' end);
    end loop;
    insert into scorers (match_id, user_id, goals, own_goals) values (m, pid('P4'), 3, 0), (m, pid('P10'), 1, 0);
    if i = 1 then update scorers set goals = 2 where match_id = m and user_id = pid('P4');
                  insert into scorers (match_id, user_id, goals, own_goals) values (m, pid('P5'), 0, 1); end if;
    update matches set status = 'played', lineup_status = 'official' where id = m;
    insert into results (match_id, diff, white_goals, black_goals, status) values (m, 2, 3, 1, 'homologated');
  end loop;
end $$;

\echo '--- 1) premi automatici dopo 7 partite'
select a.number, a.name, chi(a.code) as sbloccato_da from achievements a where a.code is not null order by a.number;

\echo '--- 2) Monnezza: P7, nella formazione ufficiale della partita in programma, si ritira da sé'
select create_match(now() + interval '5 days') is not null as in_programma;
update matches set bookings_open_at = now() - interval '1 day', lineup_status = 'official' where status = 'scheduled';
insert into bookings (match_id, user_id, choice, list) values ((select id from matches where status = 'scheduled' limit 1), pid('P7'), 'present', 'team');
insert into lineup (match_id, user_id, team) values ((select id from matches where status = 'scheduled' limit 1), pid('P7'), 'white');
set role authenticated; select as_user('P7'), book((select id from matches where status = 'scheduled' limit 1), 'absent'); reset role;
select chi('ritiro') as monnezza;

\echo '--- 3) un avviso a tutti per ogni sticker sbloccato'
select count(distinct title) as avvisi_diversi, count(*) filter (where user_id = pid('P12')) as ricevuti_da_p12,
       (select title from notifications where kind = 'achievement' and title like 'P7%' limit 1) as esempio
from notifications where kind = 'achievement';

\echo '--- 4) missioni segrete: P2 vede solo quelle che ha sbloccato; il Leader tutte'
set role authenticated;
select as_user('P2'); select string_agg(a.name, ', ' order by a.number) as missioni_viste_da_p2 from achievement_missions() m join achievements a on a.id = m.id;
select as_user('P1'); select count(*) as missioni_viste_dal_leader from achievement_missions();
\set ON_ERROR_STOP 0
\echo '--- 5) la missione non si legge dalla tabella (atteso errore di permesso)'
select as_user('P2'); select mission from achievements limit 1;
\set ON_ERROR_STOP 1

\echo '--- 6) il Leader crea un obiettivo, lo assegna a P9; P9 ne vede la missione'
select as_user('P1');
create temp table nuovo as select create_achievement('Il Profeta', 'Indovinare il risultato esatto') as id;
reset role; grant select on nuovo to authenticated; set role authenticated; select as_user('P1');
select award_achievement((select id from nuovo), pid('P9'));
select number, name from achievements where id = (select id from nuovo);
select as_user('P9'); select mission as missione_vista_da_p9 from achievement_missions() where id = (select id from nuovo);
\set ON_ERROR_STOP 0
\echo '--- 7) casi vietati (attesi 3 errori): un giocatore crea un obiettivo, assegna uno sticker; il Leader elimina un premio automatico'
select as_user('P2'), create_achievement('Furbo', null);
select as_user('P2'), award_achievement((select id from nuovo), pid('P2'));
select as_user('P1'), delete_achievement((select id from achievements where code = 'autogol'));
\set ON_ERROR_STOP 1
\echo '--- 8) il Leader toglie lo sticker e poi elimina il suo obiettivo'
select as_user('P1'), revoke_achievement((select id from nuovo), pid('P9'));
select as_user('P1'), delete_achievement((select id from nuovo)) is null as senza_immagine;
reset role;
select count(*) as obiettivi_creati_rimasti from achievements where code is null;
