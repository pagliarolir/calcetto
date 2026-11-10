-- =====================================================================
-- Stato di forma: nuova logica sulle ultime due giornate del gruppo (risultato omologato).
-- Esito del giocatore in ogni giornata: V vittoria, P pareggio, S sconfitta, N non ha giocato.
--   ultima V e penultima V                 -> 'up'        (freccia su)
--   ultima V e penultima non vittoria      -> 'upright'   (freccia in alto a destra)
--   ultima P o N (non vittoria, non sconfitta) -> 'equal' (simbolo =)
--   ultima S e penultima non sconfitta     -> 'downright' (freccia in basso a destra)
--   ultima S e penultima S                 -> 'down'      (freccia giù)
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
  if coalesce(array_length(o, 1), 0) = 0 then return 'equal'; end if;
  if o[1] = 'V' then return case when o[2] = 'V' then 'up' else 'upright' end; end if;
  if o[1] = 'S' then return case when o[2] = 'S' then 'down' else 'downright' end; end if;
  return 'equal';
end $$;
revoke execute on function public.player_form(uuid) from public, anon, authenticated;
