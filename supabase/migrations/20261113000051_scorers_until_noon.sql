-- Marcatori fino a mezzogiorno del giorno dopo (decisione del proprietario, 13/11/2026).
-- La partita si chiude sempre a mezzanotte (risultato, conferme, omologazione), ma gol, assist
-- e autogol ognuno può inserire i propri fino alle 12 del giorno dopo; poi solo il Leader.
-- Stesso calcolo nell'app: lock_at + 12 ore (match-store.ts, scorersOpen).

create or replace function public.scorers_close_at(m public.matches) returns timestamptz
language sql stable set search_path = public as $$
  select public.lock_at(m) + interval '12 hours'
$$;

revoke execute on function public.scorers_close_at(public.matches) from public, anon;
grant execute on function public.scorers_close_at(public.matches) to authenticated;

create or replace function public.save_scorers_unchecked(p_match uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
  v_leader boolean := has_leader_powers(v_uid);
  v_issues text[];
begin
  select * into m from matches where id = p_match for update;
  if not (is_participant(p_match, v_uid) or v_leader) then raise exception 'Solo chi ha giocato'; end if;
  if now() < result_opens_at(m) then raise exception 'I marcatori si inseriscono a fine partita'; end if;
  if now() >= scorers_close_at(m) and not v_leader then
    raise exception 'Marcatori chiusi alle 12 del giorno dopo la partita: ora solo il Leader può modificarli';
  end if;

  -- ognuno inserisce solo i propri gol, assist e autogol; il Leader quelli di tutti
  if not v_leader then
    if exists (select 1 from jsonb_to_recordset(p_rows) as x(user_id uuid) where x.user_id is distinct from v_uid) then
      raise exception 'Puoi inserire solo i tuoi gol, assist e autogol';
    end if;
    -- i dati inseriti dal Leader non si cambiano
    if exists (select 1 from scorers where match_id = p_match and user_id = v_uid and set_by_leader) then
      raise exception 'I tuoi dati li ha inseriti il Leader: non si possono cambiare';
    end if;
  end if;

  insert into scorers as s (match_id, user_id, goals, assists, own_goals, updated_by, updated_at, set_by_leader)
  select p_match, x.user_id, coalesce(x.goals, 0), coalesce(x.assists, 0), coalesce(x.own_goals, 0), v_uid, now(), v_leader
  from jsonb_to_recordset(p_rows) as x(user_id uuid, goals int, assists int, own_goals int)
  where is_participant(p_match, x.user_id)
  on conflict (match_id, user_id) do update set
    goals = excluded.goals, assists = excluded.assists, own_goals = excluded.own_goals,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at, set_by_leader = excluded.set_by_leader;
  -- le righe a zero si tolgono, tranne quelle fissate dal Leader (restano bloccate)
  delete from scorers where match_id = p_match and goals = 0 and assists = 0 and own_goals = 0 and not set_by_leader;

  v_issues := scorer_issues(p_match);
  if array_length(v_issues, 1) > 0 then
    raise exception '%', array_to_string(v_issues, '. ');
  end if;
end $$;

revoke execute on function public.save_scorers_unchecked(uuid, jsonb) from public, anon, authenticated;
