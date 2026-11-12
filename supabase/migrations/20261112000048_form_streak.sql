-- =====================================================================
-- Forma dei giocatori a serie (decisione del proprietario, 12/11/2026).
-- Si contano solo le partite con risultato omologato dal momento in cui la regola è partita
-- (app_settings.form_since: le partite già giocate non contano). Per ogni giornata del gruppo:
--   vittoria             -> provvisorio +1; a +4 diventa +1 DEFINITIVO e il provvisorio riparte da 0
--   sconfitta o pareggio -> provvisorio -1; a -4 diventa -1 DEFINITIVO e il provvisorio riparte da 0
--   assenza              -> solo se il provvisorio è positivo: la prima scende di 1,
--                           la seconda di fila lo azzera; a 0 o in negativo non cambia nulla
-- Il valore mostrato è: valore dei ruoli + definitivi + provvisorio (il provvisorio va da -3 a +3).
-- =====================================================================
alter table public.app_settings add column if not exists form_since timestamptz;
update public.app_settings set form_since = now() where form_since is null;

create or replace function public.player_form_state(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s int := 0; d int := 0; prev_abs boolean := false; last text := null; r record;
begin
  for r in
    select case
             when l.user_id is null then 'N'
             when coalesce(res.white_goals - res.black_goals, res.diff) = 0 then 'P'
             when (coalesce(res.white_goals - res.black_goals, res.diff) > 0) = (l.team = 'white') then 'V'
             else 'S' end as esito
    from matches m
    join results res on res.match_id = m.id and res.status = 'homologated'
    left join lineup l on l.match_id = m.id and l.user_id = p_user
    where m.status <> 'cancelled'
      and m.starts_at >= coalesce((select form_since from app_settings limit 1), 'infinity')
    order by m.starts_at
  loop
    last := r.esito;
    if r.esito = 'N' then
      if s > 0 then s := case when prev_abs then 0 else s - 1 end; end if;
      prev_abs := true;
      continue;
    end if;
    prev_abs := false;
    if r.esito = 'V' then
      s := s + 1;
      if s >= 4 then d := d + 1; s := 0; end if;
    else
      s := s - 1;
      if s <= -4 then d := d - 1; s := 0; end if;
    end if;
  end loop;
  return jsonb_build_object('s', s, 'd', d, 'last', last);
end $$;
revoke execute on function public.player_form_state(uuid) from public, anon, authenticated;

-- Schede dei giocatori: i definitivi sono già compresi nei valori; 'form' è il provvisorio (da -3 a +3),
-- 'form_def' i definitivi, 'form_last' l'esito dell'ultima giornata (V, P, S, N) per il simbolo «–».
create or replace function public.player_cards(p_users uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb := '[]'::jsonb; r record; v jsonb; f jsonb; fd int;
  dc numeric; ed numeric; eo numeric; pu numeric; cen numeric; overall numeric; best text; bestv numeric; rv numeric; n int;
begin
  if not is_active_member() then raise exception 'Accesso riservato ai membri del gruppo'; end if;
  for r in
    select p.id, p.field_role, pr.* from profiles p left join player_ratings pr on pr.user_id = p.id
    where p.id = any (coalesce(p_users, '{}'))
  loop
    v := to_jsonb(r);
    f := player_form_state(r.id);
    fd := (f ->> 'd')::int;
    -- servono tutte e 13 le caratteristiche
    select count(*) into n from rating_weights rw where v ->> rw.attr is not null;
    if n < 13 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.id, 'has', false, 'role', r.field_role, 'gk', r.gk,
        'form', (f ->> 's')::int, 'form_def', fd, 'form_last', f ->> 'last'));
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
      'form', (f ->> 's')::int, 'form_def', fd, 'form_last', f ->> 'last',
      'role_value', least(100, greatest(0, round(rv) + fd)), 'overall', least(100, greatest(0, round(overall) + fd)), 'gk', r.gk,
      'dc', least(100, greatest(0, round(dc) + fd)), 'ed', least(100, greatest(0, round(ed) + fd)),
      'eo', least(100, greatest(0, round(eo) + fd)), 'pu', least(100, greatest(0, round(pu) + fd)),
      'cen', least(100, greatest(0, round(cen) + fd)),
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
