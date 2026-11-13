-- Ripristino (decisione del proprietario, 13/11/2026): la migrazione 49 aveva tolto anche «Mostra i voti a qualcuno».
-- Torna com'era: «Per votante» lo vedono chi ha i poteri del Leader e chi il Leader autorizza (vote_grants).
create or replace function public.can_see_votes(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_leader_powers()
      or exists (select 1 from vote_grants where match_id = p_match and user_id = auth.uid() and until > now())
$$;
revoke execute on function public.can_see_votes(uuid) from public, anon;
grant execute on function public.can_see_votes(uuid) to authenticated;


-- REQ-046: il Leader concede a qualcuno di vedere i voti di una partita
create or replace function public.grant_vote_visibility(p_match uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_until timestamptz;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può mostrare i voti'; end if;
  select * into m from matches where id = p_match;
  if now() > ends_at(m) + interval '24 hours' then
    raise exception 'I voti si possono condividere solo nelle 24 ore dopo la partita';
  end if;
  select starts_at - interval '24 hours' into v_until from matches
  where starts_at > m.starts_at and status <> 'cancelled' order by starts_at limit 1;
  v_until := coalesce(v_until, m.starts_at + interval '6 days');

  insert into vote_grants (match_id, user_id, until)
  select p_match, u, v_until from unnest(p_users) u
  on conflict (match_id, user_id) do update set until = excluded.until;

  perform notify(p_users, 'vote_grant', 'Puoi vedere i voti',
    'Il Leader ti mostra chi ha votato cosa, fino a ' || fmt_when(v_until) || '.',
    '/partita/' || p_match || '/voti', p_match);
end $$;

revoke execute on function public.grant_vote_visibility(uuid, uuid[]) from public, anon;
grant execute on function public.grant_vote_visibility(uuid, uuid[]) to authenticated;
