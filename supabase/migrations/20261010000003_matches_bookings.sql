-- =====================================================================
-- Partite e prenotazioni
-- =====================================================================

-- Prossimo giorno di gioco (default giovedì 20:00) strettamente dopo p_after
create or replace function public.next_game_start(p_after timestamptz) returns timestamptz
language plpgsql stable as $$
declare
  s app_settings;
  d date;
  t timestamptz;
begin
  select * into s from app_settings where id = 1;
  d := (p_after at time zone s.timezone)::date;
  for i in 0..7 loop
    if extract(dow from d + i) = s.game_weekday then
      t := ((d + i) + s.game_time) at time zone s.timezone;
      if t > p_after then return t; end if;
    end if;
  end loop;
  return ((d + 7) + s.game_time) at time zone s.timezone;
end $$;

create or replace function public.create_match(p_starts timestamptz, p_nominal date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_leader uuid := titular_leader();
begin
  insert into matches (nominal_date, starts_at, duration_min, bookings_open_at)
  values (coalesce(p_nominal, (p_starts at time zone tz())::date), p_starts,
          (select duration_min from app_settings where id = 1), compute_open_at(p_starts))
  returning id into v_id;
  -- REQ-021: il Leader è sempre presente come numero 1
  if v_leader is not null then
    insert into bookings (match_id, user_id, choice, list) values (v_id, v_leader, 'present', 'team');
  end if;
  return v_id;
end $$;

-- Garantisce che esista la partita della prossima settimana di gioco
create or replace function public.ensure_next_match() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_next timestamptz := next_game_start(now());
  v_nominal date := (v_next at time zone tz())::date;
  v_id uuid;
begin
  select id into v_id from matches where nominal_date = v_nominal;
  if v_id is null then
    v_id := create_match(v_next, v_nominal);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Tabellone con i numeri di slot (REQ-012..REQ-014, REQ-021, REQ-022)
--   Leader presente: 1 = Leader, 2..10 squadra, riserve da 11
--   Leader assente:  il numero 1 resta vuoto, 2..11 squadra, riserve da 12
-- ---------------------------------------------------------------------
create or replace view public.booking_board with (security_invoker = true) as
with base as (
  select b.*, coalesce(b.user_id = public.titular_leader(), false) as is_leader
  from public.bookings b
),
lead as (
  select match_id, bool_or(is_leader and list = 'team') as leader_in
  from base group by match_id
)
select
  b.match_id, b.user_id, b.choice, b.list, b.placed_by, b.late_withdrawal, b.reserve_reply,
  b.updated_at, b.is_leader,
  case
    when b.list = 'team' and b.is_leader then 1
    when b.list = 'team' then 1 + row_number() over (partition by b.match_id, b.list, b.is_leader order by b.sort_key)
    when b.list = 'reserve' then
      (select team_size from public.app_settings where id = 1)
      + case when l.leader_in then 0 else 1 end
      + row_number() over (partition by b.match_id, b.list order by b.sort_key)
  end::int as slot
from base b
join lead l using (match_id);

-- Notifica variazioni a chi gioca quando le formazioni sono già ufficiali (REQ-032)
create or replace function public.notify_lineup_change(p_match uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select lineup_status from matches where id = p_match) = 'official' then
    perform notify(
      array(select user_id from bookings where match_id = p_match and list = 'team'),
      'lineup_change', 'Cambio nelle formazioni', p_text, '/partita/' || p_match || '/squadre', p_match);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Motore delle prenotazioni
--   p_actor : chi compie l'azione (diverso da p_user = il Leader prenota per altri)
--   p_system: chiamata interna (scavalca orari di apertura)
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
begin
  if p_choice not in ('present','absent','reserve') then raise exception 'Scelta non valida'; end if;
  select * into s from app_settings where id = 1;

  -- blocco sulla partita: le prenotazioni concorrenti vengono serializzate
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
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

  -- REQ-021: il Leader titolare ha sempre la sua riga (anche se la partita è nata prima di lui)
  if v_leader is not null and not exists (select 1 from bookings where match_id = p_match and user_id = v_leader) then
    insert into bookings (match_id, user_id, choice, list, sort_key) values (p_match, v_leader, 'present', 'team', '-infinity');
  end if;

  select * into cur from bookings where match_id = p_match and user_id = p_user;
  select count(*) into v_team_before from bookings where match_id = p_match and list = 'team';
  v_late := now() > m.starts_at - interval '24 hours';

  -- dove finisce l'utente
  if p_choice = 'present' then
    if cur.list = 'team' or v_team_before < s.team_size or v_is_leader or v_forced then
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
  while (select count(*) from bookings where match_id = p_match and list = 'team') > s.team_size loop
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
    exit when (select count(*) from bookings where match_id = p_match and list = 'team') >= s.team_size;
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
  if v_team_before >= s.team_size and v_team_after = s.team_size - 1 then
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

-- API pubbliche ---------------------------------------------------------

-- REQ-011: presente / assente / riserva
create or replace function public.book(p_match uuid, p_choice text) returns jsonb
language sql security definer set search_path = public as $$
  select public._book(auth.uid(), auth.uid(), p_match, p_choice, false)
$$;

-- REQ-023: il Leader inserisce direttamente un giocatore
create or replace function public.leader_book(p_match uuid, p_user uuid, p_choice text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può prenotare per altri'; end if;
  return _book(auth.uid(), p_user, p_match, p_choice, false);
end $$;

-- REQ-023: finestre di prenotazione esclusive
create or replace function public.set_priority_window(p_match uuid, p_users uuid[], p_opens_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può aprire finestre esclusive'; end if;
  insert into priority_windows (match_id, user_id, opens_at)
  select p_match, u, p_opens_at from unnest(p_users) u
  on conflict (match_id, user_id) do update set opens_at = excluded.opens_at, notified = false;
end $$;

create or replace function public.clear_priority_window(p_match uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può modificare le finestre'; end if;
  delete from priority_windows where match_id = p_match and user_id = p_user;
end $$;

-- REQ-020: la riserva conferma o declina. "Non posso" la registra come assente.
create or replace function public.reserve_reply(p_match uuid, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if p_reply not in ('confirmed','declined') then raise exception 'Risposta non valida'; end if;
  if not exists (select 1 from bookings where match_id = p_match and user_id = v_uid and list = 'reserve') then
    raise exception 'Non sei tra le riserve di questa partita';
  end if;
  if p_reply = 'declined' then
    perform _book(v_uid, v_uid, p_match, 'absent', true);
  end if;
  update bookings set reserve_reply = p_reply where match_id = p_match and user_id = v_uid;
  perform notify(staff_ids(), 'reserve_reply',
    case when p_reply = 'confirmed' then 'Riserva disponibile' else 'Riserva non disponibile' end,
    display_name(v_uid) || case when p_reply = 'confirmed' then ' c''è se serve.' else ' non può: ora risulta assente.' end,
    '/partita/' || p_match, p_match);
end $$;

-- REQ-024: spostare la partita in un altro giorno
create or replace function public.move_match(p_match uuid, p_starts timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può spostare la partita'; end if;
  select * into m from matches where id = p_match for update;
  if m.status <> 'scheduled' then raise exception 'La partita non è più modificabile'; end if;
  if p_starts <= now() then raise exception 'Scegli una data futura'; end if;
  update matches set
    starts_at = p_starts,
    bookings_open_at = compute_open_at(p_starts),
    moved = true,
    sent_lineup_window = false, sent_reserve_reminder = false, sent_result = false
  where id = p_match;
  perform notify(array(select id from profiles where active), 'match_moved', 'La partita si sposta',
    'Si gioca ' || fmt_when(p_starts) || '.',
    '/partita/' || p_match, p_match);
end $$;

create or replace function public.cancel_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può annullare la partita'; end if;
  update matches set status = 'cancelled' where id = p_match and status = 'scheduled';
  if not found then raise exception 'La partita non è annullabile'; end if;
  perform notify(array(select user_id from bookings where match_id = p_match and list <> 'out'),
    'match_cancelled', 'Partita annullata', 'Questa settimana non si gioca.', '/partita/' || p_match, p_match);
end $$;
