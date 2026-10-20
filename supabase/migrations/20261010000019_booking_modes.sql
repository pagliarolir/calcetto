-- =====================================================================
-- Due modalità di prenotazione
--  * 'order' (predefinita): fa fede l'ordine di prenotazione, come sempre.
--  * 'free': nessun ordine. I giocatori rispondono solo "ci sono" (disponibili,
--    lista 'pending') o "non ci sono"; dopo la chiusura il Leader sceglie titolari
--    e riserve (anche le riserve senza ordine) e conferma, avvisando tutti.
-- La modalità fa parte della configurazione della partita e di quella predefinita.
-- =====================================================================

alter table public.app_settings add column booking_mode text not null default 'order' check (booking_mode in ('order', 'free'));
alter table public.matches
  add column booking_mode text check (booking_mode in ('order', 'free')),
  add column lists_confirmed_at timestamptz;
update public.matches set booking_mode = 'order';
alter table public.matches alter column booking_mode set not null;

-- nuova lista: disponibile, in attesa della scelta del Leader
alter table public.bookings drop constraint if exists bookings_list_check;
alter table public.bookings add constraint bookings_list_check check (list in ('team', 'reserve', 'out', 'pending'));

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------

create or replace function public.trg_matches_config() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s app_settings;
  d date;
  v_recalc boolean;
  v_open timestamptz;
  v_close timestamptz;
  v_vopen timestamptz;
begin
  select * into s from app_settings where id = 1;
  new.players_per_team := coalesce(new.players_per_team, s.players_per_team);
  new.booking_mode := coalesce(new.booking_mode, s.booking_mode);
  new.team_a_kit := coalesce(new.team_a_kit, s.team_a_kit);
  new.team_b_kit := coalesce(new.team_b_kit, s.team_b_kit);
  new.booking_open_days := coalesce(new.booking_open_days, s.booking_days_before);
  new.booking_open_time := coalesce(new.booking_open_time, s.booking_open_time);
  new.booking_close_days := coalesce(new.booking_close_days, s.booking_close_days);
  new.booking_close_time := coalesce(new.booking_close_time, s.booking_close_time);
  new.votes_open_after_min := coalesce(new.votes_open_after_min, s.votes_open_after_min);
  new.votes_hours := coalesce(new.votes_hours, s.vote_hours);

  v_recalc := tg_op = 'INSERT'
    or new.starts_at is distinct from old.starts_at or new.duration_min is distinct from old.duration_min
    or new.booking_open_days is distinct from old.booking_open_days or new.booking_open_time is distinct from old.booking_open_time
    or new.booking_close_days is distinct from old.booking_close_days or new.booking_close_time is distinct from old.booking_close_time
    or new.votes_open_after_min is distinct from old.votes_open_after_min or new.votes_hours is distinct from old.votes_hours
    or old.bookings_close_at is null;
  if not v_recalc then return new; end if;

  d := (new.starts_at at time zone s.timezone)::date;
  v_open := ((d - new.booking_open_days) + new.booking_open_time) at time zone s.timezone;
  v_close := least(((d - new.booking_close_days) + new.booking_close_time) at time zone s.timezone, new.starts_at);
  v_vopen := new.starts_at + make_interval(mins => new.duration_min + new.votes_open_after_min);

  if tg_op = 'INSERT' or new.bookings_open_at is not distinct from old.bookings_open_at then new.bookings_open_at := v_open; end if;
  if tg_op = 'INSERT' or new.bookings_close_at is not distinct from old.bookings_close_at then new.bookings_close_at := v_close; end if;
  if tg_op = 'INSERT' or new.votes_opens_at is not distinct from old.votes_opens_at then new.votes_opens_at := v_vopen; end if;
  if tg_op = 'INSERT' or new.votes_closes_at is not distinct from old.votes_closes_at then
    new.votes_closes_at := new.votes_opens_at + make_interval(hours => new.votes_hours);
  end if;

  if new.bookings_close_at <= new.bookings_open_at then
    raise exception 'La chiusura delle prenotazioni deve venire dopo l''apertura';
  end if;
  return new;
end $$;

create or replace function public.check_match_config(p jsonb) returns void
language plpgsql immutable as $$
begin
  if p is null or not (p ?& array['players_per_team','team_a_kit','team_b_kit','booking_open_days','booking_open_time',
                                  'booking_close_days','booking_close_time','votes_open_after_min','votes_hours']) then
    raise exception 'Configurazione incompleta';
  end if;
  if (p->>'players_per_team')::int not between 5 and 8 then raise exception 'Si gioca da 5 contro 5 a 8 contro 8'; end if;
  if not (is_kit(p->>'team_a_kit') and is_kit(p->>'team_b_kit')) then raise exception 'Colore delle squadre non valido'; end if;
  if p->>'team_a_kit' = p->>'team_b_kit' then raise exception 'Le due squadre devono avere colori diversi'; end if;
  if (p->>'booking_open_days')::int not between 0 and 14 or (p->>'booking_close_days')::int not between 0 and 14 then
    raise exception 'Apertura e chiusura delle prenotazioni: da 0 a 14 giorni prima';
  end if;
  perform (p->>'booking_open_time')::time, (p->>'booking_close_time')::time;
  if (p->>'votes_open_after_min')::int not between 0 and 2880 then raise exception 'Apertura delle votazioni: da 0 a 2880 minuti dopo la fine'; end if;
  if (p->>'votes_hours')::int not between 1 and 336 then raise exception 'Durata delle votazioni: da 1 a 336 ore'; end if;
  if coalesce(p->>'booking_mode', 'order') not in ('order', 'free') then raise exception 'Modalità di prenotazione non valida'; end if;
end $$;

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
    raise exception 'Le prenotazioni si sono chiuse %. Per cambiare, scrivi al Leader.', fmt_when(m.bookings_close_at);
  end if;

  -- REQ-021: il Leader titolare ha sempre la sua riga (anche se la partita è nata prima di lui)
  if v_leader is not null and not exists (select 1 from bookings where match_id = p_match and user_id = v_leader) then
    insert into bookings (match_id, user_id, choice, list, sort_key) values (p_match, v_leader, 'present', 'team', '-infinity');
  end if;

  -- Modalità "sceglie il Leader": nessun ordine. I giocatori dicono solo se ci sono
  -- (diventano disponibili); titolari e riserve li decide il Leader.
  if m.booking_mode = 'free' then
    select * into cur from bookings where match_id = p_match and user_id = p_user;
    if p_choice = 'reserve' and not (v_forced or p_system) then
      raise exception 'In questa partita titolari e riserve li sceglie il Leader: rispondi Ci sono o Non ci sono';
    end if;
    v_new_list := case
      when p_choice = 'absent' then 'out'
      when v_is_leader then 'team'
      when v_forced then case p_choice when 'present' then 'team' else 'reserve' end
      when cur.list in ('team', 'reserve') then cur.list      -- già scelto dal Leader: resta dov'è
      else 'pending' end;
    if v_new_list = 'team' and coalesce(cur.list, '') <> 'team'
       and (select count(*) from bookings where match_id = p_match and list = 'team') >= v_size then
      raise exception 'I titolari sono già % su %: sposta prima qualcuno tra le riserve', v_size, v_size;
    end if;
    insert into bookings as b (match_id, user_id, choice, list, sort_key, placed_by, updated_at)
    values (p_match, p_user, p_choice, v_new_list, clock_timestamp(), case when v_forced then p_actor end, now())
    on conflict (match_id, user_id) do update set
      choice = excluded.choice, list = excluded.list, updated_at = now(),
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
  if cur.list = 'team' and m.booking_mode = 'order' then   -- con "sceglie il Leader" nessuno sale da solo
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
  if v_team_before >= (m.players_per_team * 2) and v_team_after = (m.players_per_team * 2) - 1 then
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

create or replace function public.leader_create_matches(p_dates date[], p_time time, p_config jsonb, p_save_default boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s app_settings;
  d date;
  v_start timestamptz;
  v_id uuid;
  v_created uuid[] := '{}';
  v_skipped date[] := '{}';
  v_leader uuid := titular_leader();
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può creare partite'; end if;
  perform check_match_config(p_config);
  if p_time is null then raise exception 'Indica l''ora della partita'; end if;
  if coalesce(array_length(p_dates, 1), 0) = 0 then raise exception 'Nessuna data scelta'; end if;
  if array_length(p_dates, 1) > 60 then raise exception 'Al massimo 60 partite alla volta'; end if;
  select * into s from app_settings where id = 1;

  for d in select distinct x from unnest(p_dates) x order by x loop
    v_start := (d + p_time) at time zone s.timezone;
    if v_start <= now()
       or exists (select 1 from matches where status <> 'cancelled' and (starts_at at time zone s.timezone)::date = d) then
      v_skipped := v_skipped || d;
      continue;
    end if;
    insert into matches (nominal_date, starts_at, duration_min, bookings_open_at,
                         players_per_team, team_a_kit, team_b_kit, booking_open_days, booking_open_time,
                         booking_close_days, booking_close_time, votes_open_after_min, votes_hours, booking_mode)
    values (d, v_start, s.duration_min, v_start,
            (p_config->>'players_per_team')::smallint, p_config->>'team_a_kit', p_config->>'team_b_kit',
            (p_config->>'booking_open_days')::smallint, (p_config->>'booking_open_time')::time,
            (p_config->>'booking_close_days')::smallint, (p_config->>'booking_close_time')::time,
            (p_config->>'votes_open_after_min')::smallint, (p_config->>'votes_hours')::smallint,
            coalesce(p_config->>'booking_mode', 'order'))
    returning id into v_id;
    -- REQ-021: il Leader è il numero 1
    if v_leader is not null then
      insert into bookings (match_id, user_id, choice, list, sort_key) values (v_id, v_leader, 'present', 'team', '-infinity');
    end if;
    v_created := v_created || v_id;
  end loop;

  if p_save_default then
    perform update_default_match_config(p_config, extract(dow from p_dates[1])::int, p_time);
  end if;
  return jsonb_build_object('created', to_jsonb(v_created), 'skipped', to_jsonb(v_skipped));
end $$;

create or replace function public.update_default_match_config(p_config jsonb, p_weekday int, p_time time) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può cambiare la configurazione'; end if;
  perform check_match_config(p_config);
  if p_weekday not between 0 and 6 then raise exception 'Giorno della settimana non valido'; end if;
  update app_settings set
    game_weekday = p_weekday, game_time = coalesce(p_time, game_time),
    players_per_team = (p_config->>'players_per_team')::smallint,
    team_a_kit = p_config->>'team_a_kit', team_b_kit = p_config->>'team_b_kit',
    booking_days_before = (p_config->>'booking_open_days')::smallint, booking_open_time = (p_config->>'booking_open_time')::time,
    booking_close_days = (p_config->>'booking_close_days')::smallint, booking_close_time = (p_config->>'booking_close_time')::time,
    votes_open_after_min = (p_config->>'votes_open_after_min')::smallint, vote_hours = (p_config->>'votes_hours')::smallint,
    booking_mode = coalesce(p_config->>'booking_mode', 'order')
  where id = 1;
end $$;

create or replace function public.update_matches_config(p_matches uuid[], p_config jsonb, p_fields text[], p_time time default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  n matches;
  v_count int := 0;
  v_players_changed boolean;
  v_url text;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può cambiare le partite'; end if;
  perform check_match_config(p_config);
  if 'time' = any (p_fields) and p_time is null then raise exception 'Indica l''ora della partita'; end if;

  for m in select * from matches where id = any (p_matches) order by starts_at for update loop
    if m.status <> 'scheduled' or m.starts_at <= now() then continue; end if;
    v_url := '/partita/' || m.id;

    update matches set
      starts_at = case when 'time' = any (p_fields)
                       then ((m.starts_at at time zone tz())::date + p_time) at time zone tz() else starts_at end,
      players_per_team = case when 'players_per_team' = any (p_fields) then (p_config->>'players_per_team')::smallint else players_per_team end,
      team_a_kit = case when 'kits' = any (p_fields) then p_config->>'team_a_kit' else team_a_kit end,
      team_b_kit = case when 'kits' = any (p_fields) then p_config->>'team_b_kit' else team_b_kit end,
      booking_open_days = case when 'booking_open' = any (p_fields) then (p_config->>'booking_open_days')::smallint else booking_open_days end,
      booking_open_time = case when 'booking_open' = any (p_fields) then (p_config->>'booking_open_time')::time else booking_open_time end,
      booking_close_days = case when 'booking_close' = any (p_fields) then (p_config->>'booking_close_days')::smallint else booking_close_days end,
      booking_close_time = case when 'booking_close' = any (p_fields) then (p_config->>'booking_close_time')::time else booking_close_time end,
      votes_open_after_min = case when 'votes_open' = any (p_fields) then (p_config->>'votes_open_after_min')::smallint else votes_open_after_min end,
      votes_hours = case when 'votes_close' = any (p_fields) then (p_config->>'votes_hours')::smallint else votes_hours end,
      booking_mode = case when 'booking_mode' = any (p_fields) then coalesce(p_config->>'booking_mode', 'order') else booking_mode end
    where id = m.id
    returning * into n;

    if n.starts_at <= now() then raise exception 'Con il nuovo orario la partita del % sarebbe già iniziata', to_char(m.starts_at at time zone tz(), 'DD/MM'); end if;

    v_players_changed := n.players_per_team <> m.players_per_team;
    if v_players_changed then
      -- le formazioni vanno rifatte con il nuovo numero di posizioni
      if exists (select 1 from lineup where match_id = m.id) then
        delete from lineup where match_id = m.id;
        if m.lineup_status <> 'draft' then
          update matches set lineup_status = 'draft' where id = m.id;
          perform notify(array(select user_id from bookings where match_id = m.id and list = 'team'),
            'lineup_change', 'Formazioni da rifare',
            'Si gioca ' || n.players_per_team || ' contro ' || n.players_per_team || ': le squadre verranno rifatte.', v_url || '/squadre', m.id);
        end if;
      end if;
      if n.booking_mode = 'order' then
        perform rebalance_match(m.id);
      else
        perform trim_free_team(m.id);
      end if;
    end if;

    if n.booking_mode <> m.booking_mode then
      perform convert_booking_mode(m.id);
    end if;

    if n.starts_at <> m.starts_at then
      perform notify(array(select user_id from bookings where match_id = m.id and list in ('team','reserve')),
        'match_moved', 'Cambio di orario', 'Si gioca ' || fmt_when(n.starts_at) || '.', v_url, m.id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Cambio di modalità su una partita con risposte già date
-- ---------------------------------------------------------------------
create or replace function public.convert_booking_mode(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_leader uuid := titular_leader();
  v_size int;
  v_leader_in boolean;
  r record;
begin
  select * into m from matches where id = p_match;
  v_size := m.players_per_team * 2;
  update matches set lists_confirmed_at = null where id = p_match;
  if m.booking_mode = 'free' then
    -- tutti tornano disponibili (il Leader resta titolare); le squadre vanno rifatte
    update bookings set list = 'pending', updated_at = now()
     where match_id = p_match and list in ('team', 'reserve') and user_id is distinct from v_leader;
    delete from lineup where match_id = p_match and user_id is distinct from v_leader;
    perform notify(array(select user_id from bookings where match_id = p_match and list = 'pending'),
      'booking_mode', 'Sceglie il Leader',
      'Per ' || fmt_when(m.starts_at) || ' titolari e riserve li sceglie il Leader: per ora sei disponibile.', '/partita/' || p_match, p_match);
  else
    -- la lista si ricostruisce nell'ordine in cui avevano risposto
    v_leader_in := exists (select 1 from bookings where match_id = p_match and user_id = v_leader and list = 'team');
    for r in
      select user_id, row_number() over (order by sort_key) as rn
      from bookings
      where match_id = p_match and list in ('team', 'reserve', 'pending') and choice = 'present' and user_id is distinct from v_leader
    loop
      update bookings set list = case when r.rn <= v_size - (case when v_leader_in then 1 else 0 end) then 'team' else 'reserve' end,
                          updated_at = now()
       where match_id = p_match and user_id = r.user_id;
    end loop;
    update bookings set list = 'reserve' where match_id = p_match and list = 'pending';
    delete from lineup l where l.match_id = p_match
      and not exists (select 1 from bookings b where b.match_id = p_match and b.user_id = l.user_id and b.list = 'team');
    for r in select user_id, list from bookings where match_id = p_match and list in ('team', 'reserve') and user_id is distinct from v_leader loop
      perform notify(array[r.user_id], 'booking_mode', 'Prenotazioni in ordine di arrivo',
        'Per ' || fmt_when(m.starts_at) || ' fa fede l''ordine di prenotazione: '
          || case r.list when 'team' then 'sei in squadra.' else 'sei tra le riserve.' end, '/partita/' || p_match, p_match);
    end loop;
  end if;
end $$;

-- Con "sceglie il Leader", se i posti calano i titolari in eccesso tornano disponibili
create or replace function public.trim_free_team(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_extra int;
  r record;
begin
  select * into m from matches where id = p_match;
  v_extra := (select count(*) from bookings where match_id = p_match and list = 'team') - m.players_per_team * 2;
  if v_extra <= 0 then return; end if;
  for r in select user_id from bookings
           where match_id = p_match and list = 'team' and user_id is distinct from titular_leader()
           order by updated_at desc limit v_extra loop
    update bookings set list = 'pending', updated_at = now() where match_id = p_match and user_id = r.user_id;
    perform notify(array[r.user_id], 'demoted', 'Titolari da rivedere',
      'Si gioca ' || m.players_per_team || ' contro ' || m.players_per_team || ': il Leader deve rivedere i titolari.', '/partita/' || p_match, p_match);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Il Leader sceglie titolari e riserve ("sceglie il Leader")
-- ---------------------------------------------------------------------
create or replace function public.leader_assign(p_match uuid, p_user uuid, p_list text) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  cur bookings;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader sceglie titolari e riserve'; end if;
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  if m.booking_mode <> 'free' then raise exception 'In questa partita fa fede l''ordine di prenotazione'; end if;
  if m.status <> 'scheduled' or now() >= m.starts_at then raise exception 'La partita è già iniziata'; end if;
  if p_list not in ('team', 'reserve', 'pending') then raise exception 'Scelta non valida'; end if;
  if p_user = titular_leader() and p_list <> 'team' then raise exception 'Il Leader è sempre titolare'; end if;
  select * into cur from bookings where match_id = p_match and user_id = p_user;
  if not found or cur.list = 'out' then
    raise exception '% non ha dato la sua disponibilità: per metterlo comunque usa «Cambia la risposta»', display_name(p_user);
  end if;
  if cur.list = p_list then return; end if;
  if p_list = 'team' and (select count(*) from bookings where match_id = p_match and list = 'team') >= m.players_per_team * 2 then
    raise exception 'I titolari sono già % su %: sposta prima qualcuno tra le riserve', m.players_per_team * 2, m.players_per_team * 2;
  end if;
  update bookings set list = p_list, updated_at = now() where match_id = p_match and user_id = p_user;
  if cur.list = 'team' then
    delete from lineup where match_id = p_match and user_id = p_user;
    perform notify_lineup_change(p_match, display_name(p_user) || ' non è più titolare.');
  end if;
  -- dopo la conferma ogni cambio avvisa l'interessato
  if m.lists_confirmed_at is not null and p_list <> 'pending' then
    perform notify(array[p_user], 'lists_changed', case p_list when 'team' then 'Sei titolare' else 'Sei tra le riserve' end,
      'Il Leader ha cambiato la tua posizione per ' || fmt_when(m.starts_at) || '.', '/partita/' || p_match, p_match);
  end if;
end $$;

-- Conferma: chi è ancora disponibile diventa riserva; tutti vengono avvisati; prenotazioni chiuse
create or replace function public.leader_confirm_lists(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_team int;
  v_res int;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader conferma titolari e riserve'; end if;
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  if m.booking_mode <> 'free' then raise exception 'In questa partita fa fede l''ordine di prenotazione'; end if;
  if m.lists_confirmed_at is not null then raise exception 'Titolari e riserve sono già stati comunicati: ogni cambio ora avvisa solo l''interessato'; end if;
  update bookings set list = 'reserve', updated_at = now() where match_id = p_match and list = 'pending';
  update matches set lists_confirmed_at = now(),
                     bookings_close_at = case when bookings_close_at > now() then greatest(now(), bookings_open_at + interval '1 second') else bookings_close_at end
   where id = p_match;
  select count(*) filter (where list = 'team'), count(*) filter (where list = 'reserve') into v_team, v_res from bookings where match_id = p_match;
  perform notify(array_remove(array(select user_id from bookings where match_id = p_match and list = 'team'), auth.uid()),
    'lists_confirmed', 'Sei titolare', 'Per ' || fmt_when(m.starts_at) || ' sei tra i titolari.', '/partita/' || p_match, p_match);
  perform notify(array(select user_id from bookings where match_id = p_match and list = 'reserve'),
    'lists_confirmed', 'Sei tra le riserve', 'Per ' || fmt_when(m.starts_at) || ' sei tra le riserve: se si libera un posto ti avvisa il Leader.', '/partita/' || p_match, p_match);
  return jsonb_build_object('team', v_team, 'reserve', v_res);
end $$;

-- Chiudere prima dell'orario e riaprire (vale in entrambe le modalità)
create or replace function public.leader_close_bookings(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader chiude le prenotazioni'; end if;
  select * into m from matches where id = p_match for update;
  if m.status <> 'scheduled' or now() >= m.starts_at then raise exception 'La partita è già iniziata'; end if;
  if now() < m.bookings_open_at then raise exception 'Le prenotazioni non sono ancora aperte'; end if;
  if now() >= m.bookings_close_at then raise exception 'Le prenotazioni sono già chiuse'; end if;
  update matches set bookings_close_at = greatest(now(), bookings_open_at + interval '1 second') where id = p_match;
end $$;

create or replace function public.leader_reopen_bookings(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_close timestamptz;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader riapre le prenotazioni'; end if;
  select * into m from matches where id = p_match for update;
  if m.status <> 'scheduled' or now() >= m.starts_at then raise exception 'La partita è già iniziata'; end if;
  v_close := least((((m.starts_at at time zone tz())::date - m.booking_close_days) + m.booking_close_time) at time zone tz(), m.starts_at);
  if v_close <= now() then
    raise exception 'Con la chiusura impostata (%) sarebbero già chiuse: cambiala nelle impostazioni della partita', fmt_when(v_close);
  end if;
  update matches set bookings_close_at = v_close where id = p_match;
end $$;

revoke execute on function public.convert_booking_mode(uuid), public.trim_free_team(uuid) from public, anon, authenticated;
revoke execute on function public.leader_assign(uuid, uuid, text), public.leader_confirm_lists(uuid),
  public.leader_close_bookings(uuid), public.leader_reopen_bookings(uuid) from public, anon;
grant execute on function public.leader_assign(uuid, uuid, text), public.leader_confirm_lists(uuid),
  public.leader_close_bookings(uuid), public.leader_reopen_bookings(uuid) to authenticated;
