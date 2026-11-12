-- =====================================================================
-- Stato di forma: chi non ha giocato l'ultima giornata ha un suo stato, 'none' (simbolo –),
-- distinto dal pareggio 'equal' (simbolo =). Il resto della logica (migrazione 44) non cambia.
--   ultima V e penultima V                 -> 'up'
--   ultima V e penultima non vittoria      -> 'upright'
--   ultima P                               -> 'equal'
--   ultima N (non ha giocato) o nessuna    -> 'none'
--   ultima S e penultima non sconfitta     -> 'downright'
--   ultima S e penultima S                 -> 'down'
-- =====================================================================
create or replace function public.player_form(p_user uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare o text[];
begin
  select array(
    select case
             when l.user_id is null then 'N'
             when coalesce(r.white_goals - r.black_goals, r.diff) = 0 then 'P'
             when (coalesce(r.white_goals - r.black_goals, r.diff) > 0) = (l.team = 'white') then 'V'
             else 'S' end
    from matches m
    join results r on r.match_id = m.id and r.status = 'homologated'
    left join lineup l on l.match_id = m.id and l.user_id = p_user
    where m.status <> 'cancelled'
    order by m.starts_at desc
    limit 2) into o;
  if coalesce(array_length(o, 1), 0) = 0 or o[1] = 'N' then return 'none'; end if;
  if o[1] = 'V' then return case when o[2] = 'V' then 'up' else 'upright' end; end if;
  if o[1] = 'S' then return case when o[2] = 'S' then 'down' else 'downright' end; end if;
  return 'equal';
end $$;
revoke execute on function public.player_form(uuid) from public, anon, authenticated;
