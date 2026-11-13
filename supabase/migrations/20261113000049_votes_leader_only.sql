-- Pagelle «Per votante»: i voti dei singoli li vede solo chi ha i poteri del Leader (decisione del proprietario, 13/11/2026).
-- Le autorizzazioni date in passato (vote_grants) non valgono più; ognuno continua a vedere i propri voti.
create or replace function public.can_see_votes(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_leader_powers()
$$;
revoke execute on function public.can_see_votes(uuid) from public, anon;
grant execute on function public.can_see_votes(uuid) to authenticated;

-- mostrare i voti a un giocatore non è più possibile
create or replace function public.grant_vote_visibility(p_match uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'I voti dei singoli li vede solo il Leader';
end $$;
revoke execute on function public.grant_vote_visibility(uuid, uuid[]) from public, anon;
grant execute on function public.grant_vote_visibility(uuid, uuid[]) to authenticated;
