-- =====================================================================
-- Votazioni
--  * il Leader (o chi ne fa le veci) vota anche se non ha giocato;
--  * i voti, una volta inviati, non si possono più modificare da nessuno;
--  * un invio del tutto vuoto viene rifiutato (l'app invia ogni compagno, 6 se non toccato).
-- Le regole di lettura restano quelle di prima: i propri voti e le medie per tutti,
-- i voti dei singoli solo al Leader, ai delegati e a chi riceve il permesso.
-- =====================================================================

create or replace function public.submit_votes_unchecked(
  p_match uuid, p_votes jsonb, p_white_pick uuid default null, p_black_pick uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
begin
  select * into m from matches where id = p_match;
  -- vota chi ha giocato; il Leader (o chi ne fa le veci) anche se non ha giocato
  if not (is_participant(p_match, v_uid) or has_leader_powers(v_uid)) then raise exception 'Vota solo chi ha giocato'; end if;
  if now() < m.votes_opens_at then raise exception 'Si vota da %', fmt_when(m.votes_opens_at); end if;
  if now() > m.votes_closes_at then raise exception 'Le votazioni sono chiuse'; end if;
  -- i voti, una volta inviati, non si cambiano più: per nessuno
  if exists (select 1 from player_votes where match_id = p_match and voter_id = v_uid)
     or exists (select 1 from mvp_votes where match_id = p_match and voter_id = v_uid) then
    raise exception 'Hai già votato: i voti non si possono modificare';
  end if;
  if coalesce(jsonb_array_length(p_votes), 0) = 0 and p_white_pick is null and p_black_pick is null then
    raise exception 'Nessun voto da inviare';
  end if;
  if p_white_pick is not null and not exists (select 1 from lineup where match_id = p_match and user_id = p_white_pick and team = 'white') then
    raise exception 'Il migliore dei % deve essere un giocatore dei %', team_name(m, 'white'), team_name(m, 'white');
  end if;
  if p_black_pick is not null and not exists (select 1 from lineup where match_id = p_match and user_id = p_black_pick and team = 'black') then
    raise exception 'Il migliore dei % deve essere un giocatore dei %', team_name(m, 'black'), team_name(m, 'black');
  end if;

  insert into player_votes as v (match_id, voter_id, target_id, score)
  select p_match, v_uid, x.target_id, x.score
  from jsonb_to_recordset(p_votes) as x(target_id uuid, score numeric)
  where x.target_id <> v_uid and is_participant(p_match, x.target_id) and x.score is not null
  on conflict (match_id, voter_id, target_id) do nothing;

  insert into mvp_votes (match_id, voter_id, white_pick, black_pick)
  values (p_match, v_uid, nullif(p_white_pick, v_uid), nullif(p_black_pick, v_uid))
  on conflict (match_id, voter_id) do nothing;
end $$;
