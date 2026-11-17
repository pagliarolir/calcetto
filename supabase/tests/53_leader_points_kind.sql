\set ON_ERROR_STOP 1
\pset footer off
-- Punti Leader (migrazione 71): avviso a tutti di tipo 'leader_points_all' (voce «Obiettivi sbloccati»); chi li assegna non lo riceve, chi li prende ha solo il suo avviso personale.
insert into auth.users (email, raw_user_meta_data) select 'u'||g||'@x.it', jsonb_build_object('first_name', 'P'||g) from generate_series(1,3) g;
create temp table ids as select first_name n, id from profiles; grant select on ids to authenticated, anon;
create function pid(p text) returns uuid language sql as $$ select id from ids where n = p $$;
update profiles set active = true where true;
select set_config('request.jwt.claim.sub', pid('P1')::text, false);
select award_leader_points(pid('P2'), 3, 'Ha portato il pallone') is not null as assegnati;
select i.n, x.kind, x.title from notifications x join ids i on i.id = x.user_id where x.kind like 'leader_points%' order by i.n;
do $$ begin
  if exists (select 1 from notifications where title like 'Punti Leader:%' and kind <> 'leader_points_all') then raise exception 'tipo sbagliato'; end if;
  if exists (select 1 from notifications where kind like 'leader_points%' and user_id = pid('P1')) then raise exception 'chi assegna non va avvisato'; end if;
  if (select array_agg(kind) from notifications where user_id = pid('P2') and kind like 'leader_points%') <> array['leader_points'] then raise exception 'chi riceve: solo l''avviso personale'; end if;
  if (select count(*) from notifications where user_id = pid('P3') and kind = 'leader_points_all') <> 1 then raise exception 'gli altri ricevono l''avviso'; end if;
  if notify_category('leader_points_all') is distinct from 'achievements' or notify_category('leader_points') is not null then raise exception 'voce delle preferenze sbagliata'; end if;
end $$;
\echo 'esito: avvisi dei Punti Leader a posto'
