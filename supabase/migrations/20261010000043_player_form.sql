-- =====================================================================
-- Stato di forma (come PES), calcolato dalle pagelle; si legge con player_cards (campo «form»).
--  * forma recente = media voto delle ultime 3 partite giocate con pagelle chiuse,
--    pesata 50% / 30% / 20% (la più recente conta di più);
--  * riferimento   = media voto delle ultime 10 partite giocate;
--  * differenza >= +0,6 'up' | >= +0,2 'upright' | > -0,2 'flat' | > -0,6 'downright' | altrimenti 'down';
--  * 'idle' (?) se non ha giocato nessuna delle ultime 3 giornate del gruppo o non ha ancora pagelle.
-- Restituisce solo lo stato: i voti restano segreti.
-- =====================================================================
create or replace function public.player_form(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare recent numeric[]; base numeric; w numeric := 0; s numeric := 0; k int; d numeric;
begin
  -- ultime 3 giornate del gruppo con pagelle chiuse: se non ne ha giocata nessuna, «non gioca da un po'»
  if not exists (
    select 1 from (select m.id from matches m join results r on r.match_id = m.id and r.status = 'homologated'
                   where m.status <> 'cancelled' and m.votes_closes_at < now() order by m.starts_at desc limit 3) g
    join lineup l on l.match_id = g.id and l.user_id = p_user) then
    return 'idle';
  end if;
  with mine as (
    select m.starts_at, (select avg(v.score) from player_votes v where v.match_id = m.id and v.target_id = p_user having count(*) >= 2) as vote
    from matches m join lineup l on l.match_id = m.id and l.user_id = p_user
    join results r on r.match_id = m.id and r.status = 'homologated'
    where m.status <> 'cancelled' and m.votes_closes_at < now()
    order by m.starts_at desc limit 10)
  select array(select vote from mine where vote is not null order by starts_at desc limit 3), avg(vote) into recent, base from mine;
  if coalesce(array_length(recent, 1), 0) = 0 or base is null then return 'idle'; end if;
  for k in 1 .. array_length(recent, 1) loop
    s := s + recent[k] * (array[0.5, 0.3, 0.2])[k]; w := w + (array[0.5, 0.3, 0.2])[k];
  end loop;
  d := s / w - base;
  return case when d >= 0.6 then 'up' when d >= 0.2 then 'upright' when d > -0.2 then 'flat' when d > -0.6 then 'downright' else 'down' end;
end $$;
revoke execute on function public.player_form(uuid) from public, anon, authenticated;

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
      v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.id, 'has', false, 'role', r.field_role, 'gk', r.gk, 'form', player_form(r.id)));
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
      'user_id', r.id, 'has', true, 'role', r.field_role, 'best', best, 'form', player_form(r.id),
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
