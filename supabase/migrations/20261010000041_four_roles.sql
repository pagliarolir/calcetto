-- =====================================================================
-- Ruoli in campo: 4 invece di 3 (Aggiornamento 6, seconda parte)
--  difensore centrale, esterno difensivo, esterno offensivo, punta.
--  Conversione: difensore -> difensore centrale; centrocampista -> esterno offensivo
--  (i suoi vecchi coefficienti erano i più vicini); attaccante -> punta.
--  Coefficienti nuovi (ogni colonna 100%) e modificabili dal Leader (set_rating_weights).
-- =====================================================================
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%field_role%' loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;
update public.profiles set field_role = case field_role
  when 'difensore' then 'difensore_centrale' when 'centrocampista' then 'esterno_offensivo' when 'attaccante' then 'punta' else field_role end
where field_role is not null;
alter table public.profiles add constraint profiles_field_role_check
  check (field_role in ('difensore_centrale', 'esterno_difensivo', 'esterno_offensivo', 'punta'));

-- coefficienti: Punta, Centrale, Esterno offensivo, Esterno difensivo
alter table public.rating_weights rename column esterno to est_off;
alter table public.rating_weights add column est_dif numeric(5,2) not null default 0;
update public.rating_weights w set punta = v.pu, centrale = v.dc, est_off = v.eo, est_dif = v.ed
from (values
  ('shot_accuracy',   10.0,  2.0,  7.0,  3.8),
  ('shot_power',       8.0,  3.0,  6.8,  4.8),
  ('finishing',       14.0,  2.0, 10.4,  5.5),
  ('dribbling',        9.0,  4.0,  9.0,  7.0),
  ('speed',           13.0,  7.0, 13.0, 11.0),
  ('agility',         10.0,  9.0, 10.0, 10.0),
  ('stamina',          7.0,  7.0, 14.8, 15.0),
  ('marking',          2.0, 19.0,  5.0, 12.0),
  ('ball_protection',  5.0,  5.0,  2.6,  2.6),
  ('strength',         5.0, 11.0,  5.0,  8.0),
  ('positioning',      4.0, 16.0,  4.0,  9.0),
  ('ball_control',     8.0,  5.0,  7.4,  6.3),
  ('passing',          5.0, 10.0,  5.0,  5.0)
) as v(attr, pu, dc, eo, ed)
where w.attr = v.attr;
alter table public.rating_weights alter column est_dif drop default;

create or replace function public.player_cards(p_users uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb := '[]'::jsonb; r record; v jsonb; w record;
  dc numeric; ed numeric; eo numeric; pu numeric; cen numeric; overall numeric; best text; bestv numeric; rv numeric; n int;
begin
  if not is_active_member() then raise exception 'Accesso riservato ai membri del gruppo'; end if;
  for r in
    select p.id, p.field_role, pr.* from profiles p left join player_ratings pr on pr.user_id = p.id
    where p.id = any (coalesce(p_users, '{}'))
  loop
    v := to_jsonb(r);
    -- servono tutte e 13 le caratteristiche
    select count(*) into n from rating_weights rw where v ->> rw.attr is not null;
    if n < 13 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.id, 'has', false, 'role', r.field_role, 'gk', r.gk));
      continue;
    end if;
    select sum((v ->> attr)::numeric * centrale) / 100, sum((v ->> attr)::numeric * est_dif) / 100,
           sum((v ->> attr)::numeric * est_off) / 100, sum((v ->> attr)::numeric * punta) / 100, avg((v ->> attr)::numeric)
      into dc, ed, eo, pu, overall from rating_weights;
    cen := (dc + ed + eo + pu) / 4;
    overall := least(100, overall + case r.gk when 'green' then 2 when 'yellow' then 1 else 0 end);
    bestv := greatest(dc, ed, eo, pu);
    best := case when bestv = pu then 'punta' when bestv = eo then 'esterno_offensivo' when bestv = ed then 'esterno_difensivo' else 'difensore_centrale' end;
    rv := coalesce(r.override, case coalesce(r.field_role, best) when 'difensore_centrale' then dc when 'esterno_difensivo' then ed
                                    when 'esterno_offensivo' then eo else pu end);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_id', r.id, 'has', true, 'role', r.field_role, 'best', best,
      'role_value', round(rv), 'overall', round(overall), 'gk', r.gk,
      'dc', round(dc), 'ed', round(ed), 'eo', round(eo), 'pu', round(pu), 'cen', round(cen),
      'hex', jsonb_build_object(
        'attacco', r.finishing,
        'tiro', round((r.shot_accuracy + r.shot_power) / 2.0),
        'difesa', round((r.marking + r.positioning) / 2.0),
        'velocita', round((r.speed + r.agility + r.stamina) / 3.0),
        'tecnica', round((r.dribbling + r.ball_control) / 2.0),
        'forza', r.strength)));
  end loop;
  return v_out;
end $$;
revoke execute on function public.player_cards(uuid[]) from public, anon;
grant execute on function public.player_cards(uuid[]) to authenticated;

-- il Leader modifica i coefficienti: ogni colonna deve fare 100%
create or replace function public.set_rating_weights(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; c text;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader modifica i coefficienti'; end if;
  for k in select jsonb_object_keys(p) loop
    if not exists (select 1 from rating_weights where attr = k) then raise exception 'Caratteristica sconosciuta: %', k; end if;
    foreach c in array array['punta', 'centrale', 'est_off', 'est_dif'] loop
      if (p -> k ->> c) is null or (p -> k ->> c)::numeric < 0 or (p -> k ->> c)::numeric > 100 then
        raise exception 'Valore non valido per %: da 0 a 100', k;
      end if;
    end loop;
  end loop;
  foreach c in array array['punta', 'centrale', 'est_off', 'est_dif'] loop
    if abs((select sum((p -> attr ->> c)::numeric) from rating_weights) - 100) > 0.05 then
      raise exception 'La colonna % deve fare 100%%', case c when 'punta' then 'Punta' when 'centrale' then 'Difensore centrale' when 'est_off' then 'Esterno offensivo' else 'Esterno difensivo' end;
    end if;
  end loop;
  update rating_weights w set punta = (p -> w.attr ->> 'punta')::numeric, centrale = (p -> w.attr ->> 'centrale')::numeric,
         est_off = (p -> w.attr ->> 'est_off')::numeric, est_dif = (p -> w.attr ->> 'est_dif')::numeric
  where p ? w.attr;
end $$;
revoke execute on function public.set_rating_weights(jsonb) from public, anon;
grant execute on function public.set_rating_weights(jsonb) to authenticated;
