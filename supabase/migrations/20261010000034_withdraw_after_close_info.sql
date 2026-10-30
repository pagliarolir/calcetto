-- =====================================================================
-- Ritiro dopo la chiusura, regola di Monnezza, pagina Info
--  * chi è prenotato può ritirarsi anche dopo la chiusura delle prenotazioni;
--    «in ordine di arrivo» la prima riserva sale da sola (come prima);
--  * Monnezza: si vince ritirandosi da titolare quando i titolari sono già scelti
--    (dopo la chiusura «in ordine di arrivo», dopo la conferma delle liste «sceglie
--    il Leader», o dalla formazione ufficiale);
--  * pagina Info («GIOVEDÌ DEL LEADER»): testo scritto solo dal Leader.
-- (bookings.left_official_lineup ora vuol dire «ritirato da titolare già scelto»)
-- =====================================================================

alter table public.app_settings add column info_text text check (info_text is null or length(info_text) <= 20000);
alter table public.app_settings add column info_updated_at timestamptz;

create or replace function public.set_info_text(p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader scrive le Info'; end if;
  update app_settings set info_text = nullif(trim(p_text), ''), info_updated_at = now() where id = 1;
end $$;
revoke execute on function public.set_info_text(text) from public, anon;
grant execute on function public.set_info_text(text) to authenticated;

update public.achievements set mission = 'Ritirarsi da titolare quando i titolari sono già stati scelti.' where code = 'ritiro';

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------
create or replace function public._book(
  p_actor uuid, p_user uuid, p_match uuid, p_choice text, p_system boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s app_settings;
  m matches;
  cur bookings;
  v_leader uuid := titular_leader();
  v_is_leader boolean := (p_user = v_leader);
  v_forced boolean := (p_actor is distinct from p_user) and not p_system;
  v_team_before int;
  v_team_after int;
  v_late boolean;
  v_new_list text;
  v_moved uuid;
  v_name text := display_name(p_user);
  v_url text := '/partita/' || p_match;
  v_slot int;
  v_size int;
  v_after_close boolean := false;
begin
  if p_choice not in ('present','absent','reserve') then raise exception 'Scelta non valida'; end if;
  select * into s from app_settings where id = 1;

  -- blocco sulla partita: le prenotazioni concorrenti vengono serializzate
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  v_size := m.players_per_team * 2;   -- 5 contro 5 = 10 posti, 6 contro 6 = 12, ...
  if m.status <> 'scheduled' then raise exception 'Le prenotazioni per questa partita sono chiuse'; end if;
  if now() >= m.starts_at then raise exception 'La partita è già iniziata'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Utente non attivo'; end if;
  if v_forced and not has_leader_powers(p_actor) then raise exception 'Solo il Leader può prenotare per altri'; end if;
  if v_is_leader and p_choice = 'reserve' then
    raise exception 'Il Leader è sempre il numero 1: scegli presente o assente';
  end if;

  if not (p_system or v_forced or v_is_leader) and now() < m.bookings_open_at
     and not exists (select 1 from priority_windows w
                     where w.match_id = p_match and w.user_id = p_user and w.opens_at <= now()) then
    raise exception 'Le prenotazioni aprono %',
      fmt_when(m.bookings_open_at);
  end if;

  -- chiusura delle prenotazioni: dopo, cambia solo il Leader (fino all'inizio)
  if not (p_system or v_forced or v_is_leader or has_leader_powers(p_actor)) and now() >= m.bookings_close_at then
    -- chi non aveva ancora risposto può ancora prenotarsi, ma solo come riserva (o dire che non c'è);
    -- chi aveva già risposto, per cambiare passa dal Leader
    -- chi è prenotato può sempre ritirarsi (la prima riserva sale, se è «in ordine di arrivo»);
    -- per gli altri cambi passa dal Leader
    if exists (select 1 from bookings where match_id = p_match and user_id = p_user) and p_choice <> 'absent' then
      raise exception 'Le prenotazioni si sono chiuse %. Per cambiare, scrivi al Leader.', fmt_when(m.bookings_close_at);
    end if;
    v_after_close := true;
  end if;

  -- REQ-021: il Leader titolare ha sempre la sua riga (anche se la partita è nata prima di lui)
  if v_leader is not null and not exists (select 1 from bookings where match_id = p_match and user_id = v_leader) then
    insert into bookings (match_id, user_id, choice, list, sort_key) values (p_match, v_leader, 'present', 'team', '-infinity');
  end if;

  -- Modalità "sceglie il Leader": nessun ordine. I giocatori dicono solo se ci sono
  -- (diventano disponibili); titolari e riserve li decide il Leader.
  if m.booking_mode = 'free' then
    select * into cur from bookings where match_id = p_match and user_id = p_user;
    if p_choice = 'reserve' and not (v_forced or p_system or v_after_close) then
      raise exception 'In questa partita titolari e riserve li sceglie il Leader: rispondi Ci sono o Non ci sono';
    end if;
    v_new_list := case
      when p_choice = 'absent' then 'out'
      when v_is_leader then 'team'
      when v_forced then case p_choice when 'present' then 'team' else 'reserve' end
      when cur.list in ('team', 'reserve') then cur.list      -- già scelto dal Leader: resta dov'è
      else 'pending' end;
    if v_after_close and v_new_list in ('team', 'pending') then v_new_list := 'reserve'; end if;   -- dopo la chiusura: riserva
    if v_new_list = 'team' and coalesce(cur.list, '') <> 'team'
       and (select count(*) from bookings where match_id = p_match and list = 'team') >= v_size then
      raise exception 'I titolari sono già % su %: sposta prima qualcuno tra le riserve', v_size, v_size;
    end if;
    insert into bookings as b (match_id, user_id, choice, list, sort_key, placed_by, updated_at)
    values (p_match, p_user, p_choice, v_new_list, clock_timestamp(), case when v_forced then p_actor end, now())
    on conflict (match_id, user_id) do update set
      choice = excluded.choice, list = excluded.list, updated_at = now(),
      withdrew = b.withdrew or (b.list = 'team' and excluded.list <> 'team'),
      sort_key = case when b.list = excluded.list then b.sort_key else excluded.sort_key end,
      placed_by = case when v_forced then excluded.placed_by when excluded.list = 'out' then null else b.placed_by end;
    if v_new_list <> 'team' and coalesce(cur.list, '') = 'team' then
      delete from lineup where match_id = p_match and user_id = p_user;
      perform notify_lineup_change(p_match, v_name || ' non c''è più.');
    end if;
    if v_forced then
      perform notify(array[p_user], 'placed_by_leader', 'Il Leader ha aggiornato la tua presenza',
        case v_new_list when 'team' then 'Sei titolare' when 'reserve' then 'Sei tra le riserve' else 'Sei segnato assente' end
          || ' per ' || fmt_when(m.starts_at) || '.', v_url, p_match);
    end if;
    return jsonb_build_object('list', v_new_list, 'slot', null);
  end if;

  -- dopo la chiusura chi non aveva risposto è una riserva «se serve»: non occupa da solo i posti liberi
  -- (entra se un titolare si ritira, come le altre riserve, o se lo sposta il Leader)
  if v_after_close and p_choice = 'present' then p_choice := 'reserve'; end if;

  select * into cur from bookings where match_id = p_match and user_id = p_user;
  select count(*) into v_team_before from bookings where match_id = p_match and list = 'team';
  v_late := now() > m.starts_at - interval '24 hours';

  -- dove finisce l'utente
  if p_choice = 'present' then
    if cur.list = 'team' or v_team_before < v_size or v_is_leader or v_forced then
      v_new_list := 'team';           -- REQ-017: se c'è posto entra subito
    else
      v_new_list := 'reserve';        -- REQ-014: oltre i 10 si scala tra le riserve
    end if;
  elsif p_choice = 'reserve' then
    v_new_list := 'reserve';          -- REQ-013
  else
    v_new_list := 'out';
  end if;
  if v_after_close and v_new_list = 'team' then v_new_list := 'reserve'; end if;   -- dopo la chiusura: riserva, in coda

  insert into bookings as b (match_id, user_id, choice, list, sort_key, placed_by, updated_at)
  values (p_match, p_user, p_choice, v_new_list, clock_timestamp(),
          case when v_forced then p_actor end, now())
  on conflict (match_id, user_id) do update set
    choice     = excluded.choice,
    list       = excluded.list,
    -- chi resta nella stessa lista mantiene la posizione; chi cambia lista va in coda
    sort_key   = case when b.list = excluded.list then b.sort_key else excluded.sort_key end,
    placed_by  = case when v_forced then excluded.placed_by
                      when excluded.list = 'out' then null else b.placed_by end,
    late_withdrawal = b.late_withdrawal or (v_late and b.list = 'team' and excluded.list <> 'team'),
    withdrew        = b.withdrew or (b.list = 'team' and excluded.list <> 'team'),   -- rinuncia in qualsiasi momento
    reserve_reply   = case when excluded.list = 'reserve' then b.reserve_reply end,
    updated_at = now();

  -- troppi in squadra (Leader che rientra o inserimento forzato):
  -- l'ultimo arrivato non "protetto" scende in testa alle riserve
  while (select count(*) from bookings where match_id = p_match and list = 'team') > v_size loop
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'team' and user_id is distinct from v_leader and user_id <> p_user
    order by (placed_by is not null), sort_key desc
    limit 1;
    exit when v_moved is null;
    update bookings
       set list = 'reserve', updated_at = now(),
           sort_key = coalesce((select min(sort_key) from bookings where match_id = p_match and list = 'reserve'),
                               clock_timestamp()) - interval '1 millisecond'
     where match_id = p_match and user_id = v_moved;
    perform notify(array[v_moved], 'demoted', 'Sei passato tra le riserve',
                   'Sei il primo della lista: se si libera un posto entri tu.', v_url, p_match);
    perform notify_lineup_change(p_match, display_name(v_moved) || ' è passato tra le riserve.');
    delete from lineup where match_id = p_match and user_id = v_moved;
    v_moved := null;
  end loop;

  -- REQ-016: chi esce dalla squadra libera il posto e le riserve scalano
  if cur.list = 'team' and v_new_list <> 'team' then
    delete from lineup where match_id = p_match and user_id = p_user;
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'reserve' and user_id <> p_user
    order by sort_key limit 1;
    if v_moved is not null then
      update bookings set list = 'team', sort_key = clock_timestamp(), updated_at = now()
       where match_id = p_match and user_id = v_moved;
      perform notify(array[v_moved], 'promoted', 'Sei dentro!',
                     'Si è liberato un posto: sei in squadra.', v_url, p_match);
      perform notify_lineup_change(p_match,
        v_name || ' non c''è più, entra ' || display_name(v_moved) || '.');
    else
      perform notify_lineup_change(p_match, v_name || ' non c''è più.');
    end if;
  elsif v_new_list = 'team' and cur.list is distinct from 'team' then
    perform notify_lineup_change(p_match, v_name || ' entra in squadra.');
  end if;

  -- chi si è dichiarato presente ma è in riserva entra se c'è spazio
  loop
    exit when (select count(*) from bookings where match_id = p_match and list = 'team') >= v_size;
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'reserve' and choice = 'present'
    order by sort_key limit 1;
    exit when v_moved is null;
    update bookings set list = 'team', sort_key = clock_timestamp(), updated_at = now()
     where match_id = p_match and user_id = v_moved;
    perform notify(array[v_moved], 'promoted', 'Sei dentro!', 'Si è liberato un posto: sei in squadra.', v_url, p_match);
    v_moved := null;
  end loop;

  select count(*) into v_team_after from bookings where match_id = p_match and list = 'team';

  -- REQ-018: rinuncia nelle 24 ore, avvisati Leader e Premier
  if v_late and cur.list = 'team' and v_new_list <> 'team' then
    perform notify(staff_ids(), 'late_withdrawal', 'Rinuncia dell''ultimo momento',
                   v_name || ' ha dato forfait a meno di 24 ore dalla partita.', v_url, p_match);
  end if;

  -- REQ-019: si scende a 9, avviso speciale a chi non è in squadra (e allo staff)
  if v_team_before >= v_size and v_team_after = v_size - 1 then
    perform notify(
      array_remove(
        array(select id from profiles where active
                and id not in (select user_id from bookings where match_id = p_match and list = 'team'))
        || staff_ids(), p_user),
      'need_one', 'Manca un giocatore!',
      'Siamo in ' || v_team_after || ' per ' ||
        fmt_when(m.starts_at) || '. Ti unisci?',
      v_url, p_match,
      '[{"action":"present","title":"Ci sono"}]'::jsonb);
  end if;

  select slot into v_slot from booking_board where match_id = p_match and user_id = p_user;
  return jsonb_build_object(
    'list', (select list from bookings where match_id = p_match and user_id = p_user),
    'slot', v_slot);
end $$;

create or replace function public.trg_bookings_flags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- il ritiro si registra prima che il giocatore esca dalla formazione: qui la riga c'è ancora
  -- Monnezza: un titolare si ritira da sé quando i titolari sono già stati scelti:
  --  * dalla formazione ufficiale (regola di prima);
  --  * «in ordine di arrivo»: dopo la chiusura delle prenotazioni (i titolari li fissa la chiusura);
  --  * «sceglie il Leader»: dopo che il Leader ha confermato le liste.
  if tg_op = 'UPDATE' and old.list = 'team' and new.list <> 'team' and auth.uid() = new.user_id and (
       (exists (select 1 from matches m where m.id = new.match_id and m.lineup_status = 'official')
        and exists (select 1 from lineup l where l.match_id = new.match_id and l.user_id = new.user_id))
    or exists (select 1 from matches m where m.id = new.match_id and (
         (m.booking_mode = 'order' and now() >= m.bookings_close_at)
      or (m.booking_mode = 'free' and m.lists_confirmed_at is not null)))
  ) then
    new.left_official_lineup := true;
  end if;
  -- «ci sono» detto dal giocatore stesso (non l'inserimento automatico del Leader alla creazione della partita)
  if new.choice = 'present' and (tg_op = 'INSERT' or old.choice is distinct from 'present')
     and auth.uid() = new.user_id and new.sort_key is distinct from '-infinity'::timestamptz then
    new.present_at := now();
  end if;
  return new;
end $$;
