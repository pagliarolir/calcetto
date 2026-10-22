-- =====================================================================
-- Due loghi e migliore in campo obbligatorio
--  * logo del tabellone (header_logo_id, trasparente) e icona dell'app
--    (logo_id) separati; entrambi nel contenitore pubblico "branding";
--  * nelle partite a migliore unico, scegliere il migliore in campo è obbligatorio.
-- =====================================================================

alter table public.app_settings add column header_logo_id uuid;

create or replace function public.set_header_logo(p_logo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader cambia il logo'; end if;
  update app_settings set header_logo_id = p_logo where id = 1;
end $$;

create or replace function public.app_branding() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('logo_id', logo_id, 'header_logo_id', header_logo_id) from app_settings where id = 1
$$;

-- ---------------------------------------------------------------------
-- Voto: migliore in campo obbligatorio (testo originale con una modifica mirata)
-- ---------------------------------------------------------------------
create or replace function public.submit_votes_unchecked(
  p_match uuid, p_votes jsonb, p_white_pick uuid default null, p_black_pick uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
  v_pick uuid;
  v_pick_team text;
begin
  select * into m from matches where id = p_match;
  -- un solo migliore in campo: si salva nella colonna della sua squadra
  if m.mvp_mode = 'single' then
    if p_white_pick is not null and p_black_pick is not null then raise exception 'Si sceglie un solo migliore in campo'; end if;
    v_pick := coalesce(p_white_pick, p_black_pick);
    select l.team into v_pick_team from lineup l where l.match_id = p_match and l.user_id = v_pick;
    if v_pick is not null and v_pick_team is null then raise exception 'Il migliore in campo deve essere uno dei giocatori'; end if;
    p_white_pick := case when v_pick_team = 'white' then v_pick end;
    p_black_pick := case when v_pick_team = 'black' then v_pick end;
  end if;
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
  -- il migliore in campo è obbligatorio (se le squadre sono state fatte): controllato dopo gli altri, così il messaggio è quello giusto
  if m.mvp_mode = 'single' and coalesce(p_white_pick, p_black_pick) is null and exists (select 1 from lineup where match_id = p_match) then
    raise exception 'Scegli il migliore in campo';
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

revoke execute on function public.set_header_logo(uuid) from public, anon;
grant execute on function public.set_header_logo(uuid) to authenticated;
grant execute on function public.app_branding() to anon, authenticated;
