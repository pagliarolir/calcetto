-- =====================================================================
-- Il Leader azzera la risposta di un giocatore: torna "non ha risposto",
-- come se non si fosse mai prenotato. Le regole di scorrimento sono le stesse
-- di quando qualcuno esce dalla squadra (REQ-016, REQ-019, REQ-032), ma non
-- è una rinuncia del giocatore: niente "forfait tardivo" né avviso di rinuncia.
-- =====================================================================

create or replace function public.leader_reset_booking(p_match uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s app_settings;
  m matches;
  cur bookings;
  v_actor uuid := auth.uid();
  v_name text := display_name(p_user);
  v_url text := '/partita/' || p_match;
  v_team_before int;
  v_team_after int;
  v_moved uuid;
begin
  if not has_leader_powers(v_actor) then raise exception 'Solo il Leader può azzerare una risposta'; end if;
  select * into s from app_settings where id = 1;

  -- stesso blocco delle prenotazioni: le operazioni sulla stessa partita vanno in fila
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  if m.status <> 'scheduled' then raise exception 'Le prenotazioni per questa partita sono chiuse'; end if;
  if now() >= m.starts_at then raise exception 'La partita è già iniziata'; end if;
  if p_user = titular_leader() then
    raise exception 'Il Leader è sempre il numero 1: puoi segnarlo assente, non azzerarlo';
  end if;

  select * into cur from bookings where match_id = p_match and user_id = p_user;
  if not found then raise exception '% non ha ancora risposto', v_name; end if;

  select count(*) into v_team_before from bookings where match_id = p_match and list = 'team';

  delete from bookings where match_id = p_match and user_id = p_user;
  delete from lineup where match_id = p_match and user_id = p_user;

  -- usciva dalla squadra: la prima riserva sale (REQ-016)
  if cur.list = 'team' then
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'reserve'
    order by sort_key limit 1;
    if v_moved is not null then
      update bookings set list = 'team', sort_key = clock_timestamp(), updated_at = now()
       where match_id = p_match and user_id = v_moved;
      perform notify(array[v_moved], 'promoted', 'Sei dentro!',
                     'Si è liberato un posto: sei in squadra.', v_url, p_match);
      perform notify_lineup_change(p_match, v_name || ' non c''è più, entra ' || display_name(v_moved) || '.');
    else
      perform notify_lineup_change(p_match, v_name || ' non c''è più.');
    end if;
  end if;

  select count(*) into v_team_after from bookings where match_id = p_match and list = 'team';

  -- si scende a 9: avviso speciale (REQ-019), escluso chi è stato appena azzerato (ha già il suo avviso)
  if v_team_before >= s.team_size and v_team_after = s.team_size - 1 then
    perform notify(
      array_remove(
        array(select id from profiles where active
                and id not in (select user_id from bookings where match_id = p_match and list = 'team'))
        || staff_ids(), p_user),
      'need_one', 'Manca un giocatore!',
      'Siamo in ' || v_team_after || ' per ' || fmt_when(m.starts_at) || '. Ti unisci?',
      v_url, p_match,
      '[{"action":"present","title":"Ci sono"}]'::jsonb);
  end if;

  -- avviso al giocatore: con i pulsanti se può già rispondere, altrimenti con la data di apertura
  if p_user is distinct from v_actor then
    if now() >= m.bookings_open_at then
      perform notify(array[p_user], 'booking_reset', 'Rispondi di nuovo',
        display_name(v_actor) || ' ha azzerato la tua risposta per ' || fmt_when(m.starts_at) || '. Ci sei?',
        v_url, p_match,
        '[{"action":"present","title":"Ci sono"},{"action":"reserve","title":"Riserva"},{"action":"absent","title":"Non ci sono"}]'::jsonb);
    else
      perform notify(array[p_user], 'booking_reset', 'Risposta azzerata',
        display_name(v_actor) || ' ha azzerato la tua risposta per ' || fmt_when(m.starts_at)
          || '. Potrai rispondere quando si aprono le prenotazioni, ' || fmt_when(m.bookings_open_at) || '.',
        v_url, p_match);
    end if;
  end if;

  return jsonb_build_object('previous', cur.list, 'promoted', v_moved);
end $$;

revoke execute on function public.leader_reset_booking(uuid, uuid) from public, anon;
grant execute on function public.leader_reset_booking(uuid, uuid) to authenticated;
