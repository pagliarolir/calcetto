-- =====================================================================
-- Configurazione delle partite
-- Ogni partita ha la sua configurazione: giocatori per squadra (5-8), colori delle
-- due squadre, apertura e chiusura delle prenotazioni, apertura e chiusura delle
-- votazioni. La configurazione predefinita sta in app_settings. Gli orari assoluti
-- si ricalcolano da soli quando cambiano data, ora o configurazione.
-- Nota: nelle tabelle le due squadre restano 'white' (squadra A) e 'black' (squadra B);
-- nomi e colori veri vengono da team_a_kit e team_b_kit della partita.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tavolozza delle divise
-- ---------------------------------------------------------------------
create or replace function public.kit_name(p_kit text) returns text
language sql immutable as $$
  select case p_kit
    when 'white' then 'Bianchi' when 'black' then 'Neri' when 'red' then 'Rossi' when 'blue' then 'Blu'
    when 'sky' then 'Azzurri' when 'yellow' then 'Gialli' when 'green' then 'Verdi' when 'orange' then 'Arancioni'
    when 'purple' then 'Viola' when 'grey' then 'Grigi' else p_kit end
$$;

create or replace function public.is_kit(p_kit text) returns boolean
language sql immutable as $$
  select p_kit = any (array['white','black','red','blue','sky','yellow','green','orange','purple','grey'])
$$;

-- ---------------------------------------------------------------------
-- Configurazione predefinita
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column players_per_team smallint not null default 5 check (players_per_team between 5 and 8),
  add column team_a_kit text not null default 'white',
  add column team_b_kit text not null default 'black',
  add column booking_close_days smallint not null default 0 check (booking_close_days between 0 and 14),
  add column booking_close_time time not null default '17:00',
  add column votes_open_after_min smallint not null default 30 check (votes_open_after_min between 0 and 2880),
  add constraint app_settings_kits check (is_kit(team_a_kit) and is_kit(team_b_kit) and team_a_kit <> team_b_kit);

-- ---------------------------------------------------------------------
-- Configurazione di ogni partita e orari calcolati
-- ---------------------------------------------------------------------
alter table public.matches
  add column players_per_team smallint check (players_per_team between 5 and 8),
  add column team_a_kit text,
  add column team_b_kit text,
  add column booking_open_days smallint check (booking_open_days between 0 and 14),
  add column booking_open_time time,
  add column booking_close_days smallint check (booking_close_days between 0 and 14),
  add column booking_close_time time,
  add column votes_open_after_min smallint check (votes_open_after_min between 0 and 2880),
  add column votes_hours smallint check (votes_hours between 1 and 336),
  add column bookings_close_at timestamptz,
  add column votes_opens_at timestamptz,
  add column votes_closes_at timestamptz,
  add column sent_votes boolean not null default false,
  add constraint matches_kits check (team_a_kit is null or (is_kit(team_a_kit) and is_kit(team_b_kit) and team_a_kit <> team_b_kit));

create or replace function public.team_name(m public.matches, p_team text) returns text
language sql stable as $$
  select kit_name(case p_team when 'white' then m.team_a_kit else m.team_b_kit end)
$$;

-- Completa la configurazione mancante con quella predefinita e calcola gli orari.
-- In un aggiornamento, un orario impostato esplicitamente nella stessa istruzione viene rispettato.
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

create trigger matches_config
before insert or update on public.matches
for each row execute function public.trg_matches_config();

-- partite esistenti: configurazione predefinita e orari calcolati
update public.matches set players_per_team = null;
update public.matches set sent_votes = (sent_result or votes_closes_at < now());
alter table public.matches
  alter column players_per_team set not null, alter column team_a_kit set not null, alter column team_b_kit set not null,
  alter column booking_open_days set not null, alter column booking_open_time set not null,
  alter column booking_close_days set not null, alter column booking_close_time set not null,
  alter column votes_open_after_min set not null, alter column votes_hours set not null,
  alter column bookings_close_at set not null, alter column votes_opens_at set not null, alter column votes_closes_at set not null;

-- chiusura delle votazioni: ora è salvata nella partita (la colonna calcolata resta per compatibilità)
create or replace function public.votes_close_at(m public.matches) returns timestamptz
language sql stable as $$ select m.votes_closes_at $$;

-- ---------------------------------------------------------------------
-- Formazioni fino a 8 contro 8
-- ---------------------------------------------------------------------
alter table public.lineup drop constraint if exists lineup_field_slot_check;
alter table public.lineup add constraint lineup_field_slot_check check (field_slot between 1 and 8);

create or replace function public.trg_lineup_slot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.field_slot is not null
     and new.field_slot > (select players_per_team from matches where id = new.match_id) then
    raise exception 'Posizione % non prevista con questo numero di giocatori', new.field_slot;
  end if;
  return new;
end $$;
create trigger lineup_slot before insert or update on public.lineup
for each row execute function public.trg_lineup_slot();

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
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
      (select mm.players_per_team * 2 from public.matches mm where mm.id = b.match_id)
      + case when l.leader_in then 0 else 1 end
      + row_number() over (partition by b.match_id, b.list order by b.sort_key)
  end::int as slot
from base b
join lead l using (match_id);

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

create or replace function public.ensure_next_match() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_next timestamptz;
  v_nominal date;
begin
  -- se c'è già una partita in programma non si crea nulla (niente doppioni in giorni diversi)
  select id into v_id from matches where status = 'scheduled' and starts_at > now() order by starts_at limit 1;
  if v_id is not null then return v_id; end if;
  v_next := next_game_start(now());
  v_nominal := (v_next at time zone tz())::date;
  select id into v_id from matches where nominal_date = v_nominal;
  if v_id is null then
    v_id := create_match(v_next, v_nominal);
  end if;
  return v_id;
end $$;

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
    moved = true,
    sent_lineup_window = false, sent_reserve_reminder = false, sent_result = false
  where id = p_match;
  perform notify(array(select id from profiles where active), 'match_moved', 'La partita si sposta',
    'Si gioca ' || fmt_when(p_starts) || '.',
    '/partita/' || p_match, p_match);
end $$;

create or replace function public.announce_lineup(p_match uuid, p_update boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text;
  v_m matches;
begin
  select * into v_m from matches where id = p_match;
  foreach t in array array['white','black'] loop
    perform notify(
      array(select user_id from lineup where match_id = p_match and team = t),
      case when p_update then 'lineup_change' else 'lineup_official' end,
      case when p_update then 'Formazioni aggiornate' else 'Formazioni ufficiali' end,
      'Giochi con i ' || team_name(v_m, t) || '. Guarda come vi siete disposti in campo.',
      '/partita/' || p_match || '/squadre', p_match);
  end loop;
  -- chi è in squadra ma non ancora assegnato a un colore
  perform notify(
    array(select b.user_id from bookings b where b.match_id = p_match and b.list = 'team'
          and not exists (select 1 from lineup l where l.match_id = p_match and l.user_id = b.user_id)),
    'lineup_official', case when p_update then 'Formazioni aggiornate' else 'Formazioni ufficiali' end,
    'Le squadre sono fatte, il tuo colore deve ancora essere deciso.',
    '/partita/' || p_match || '/squadre', p_match);
end $$;

create or replace function public.scorer_issues(p_match uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  r results;
  m matches;
  v_issues text[] := '{}';
  w_cred int; b_cred int; w_ast int; b_ast int; w_g int; b_g int;
begin
  select * into r from results where match_id = p_match;
  select * into m from matches where id = p_match;
  select
    coalesce(sum(case when l.team = 'white' then s.goals else 0 end), 0)
      + coalesce(sum(case when l.team = 'black' then s.own_goals else 0 end), 0),
    coalesce(sum(case when l.team = 'black' then s.goals else 0 end), 0)
      + coalesce(sum(case when l.team = 'white' then s.own_goals else 0 end), 0),
    coalesce(sum(case when l.team = 'white' then s.assists else 0 end), 0),
    coalesce(sum(case when l.team = 'black' then s.assists else 0 end), 0),
    coalesce(sum(case when l.team = 'white' then s.goals else 0 end), 0),
    coalesce(sum(case when l.team = 'black' then s.goals else 0 end), 0)
  into w_cred, b_cred, w_ast, b_ast, w_g, b_g
  from scorers s join lineup l on l.match_id = s.match_id and l.user_id = s.user_id
  where s.match_id = p_match;

  if w_ast > w_g then v_issues := v_issues || format('I %s hanno più assist che gol segnati', team_name(m, 'white')); end if;
  if b_ast > b_g then v_issues := v_issues || format('I %s hanno più assist che gol segnati', team_name(m, 'black')); end if;
  if r.white_goals is not null then
    if w_cred > r.white_goals then
      v_issues := v_issues || format('Ai %s risultano %s gol, ma ne hanno segnati %s', team_name(m, 'white'), w_cred, r.white_goals);
    end if;
    if b_cred > r.black_goals then
      v_issues := v_issues || format('Ai %s risultano %s gol, ma ne hanno segnati %s', team_name(m, 'black'), b_cred, r.black_goals);
    end if;
  end if;
  return v_issues;
end $$;

create or replace function public.submit_result_unchecked(
  p_match uuid, p_diff int, p_white int default null, p_black int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  r results;
  v_uid uuid := auth.uid();
  v_leader boolean := has_leader_powers(v_uid);
  v_staff boolean := is_staff(v_uid);
  v_agree int; v_disagree int;
  v_text text;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  if not (is_participant(p_match, v_uid) or v_staff) then raise exception 'Il risultato lo inserisce chi ha giocato'; end if;
  if now() < result_opens_at(m) then
    raise exception 'Il risultato si inserisce da %', fmt_when(result_opens_at(m));
  end if;
  if m.locked and not v_leader then raise exception 'Risultato chiuso: solo il Leader può modificarlo'; end if;
  if (p_white is null) <> (p_black is null) then raise exception 'Indica i gol di entrambe le squadre'; end if;
  if p_white is not null then p_diff := p_white - p_black; end if;
  if p_diff is null then raise exception 'Indica il risultato'; end if;

  select * into r from results where match_id = p_match;
  if found and not v_staff then
    if r.status = 'homologated' then raise exception 'Il risultato è già omologato'; end if;
    select count(*) filter (where agree), count(*) filter (where not agree) into v_agree, v_disagree
    from result_reviews where match_id = p_match;
    -- un risultato già inserito si può sostituire solo se è più contestato che confermato
    if v_disagree <= v_agree then raise exception 'C''è già un risultato: confermalo o contestalo'; end if;
  end if;

  insert into results as x (match_id, diff, white_goals, black_goals, entered_by, entered_at, status, homologated_by, homologated_at)
  values (p_match, p_diff, p_white, p_black, v_uid, now(),
          case when m.locked then 'homologated' else 'pending' end,
          case when m.locked then 'leader' end,
          case when m.locked then now() end)
  on conflict (match_id) do update set
    diff = excluded.diff, white_goals = excluded.white_goals, black_goals = excluded.black_goals,
    entered_by = excluded.entered_by, entered_at = excluded.entered_at,
    status = excluded.status, homologated_by = excluded.homologated_by, homologated_at = excluded.homologated_at;
  delete from result_reviews where match_id = p_match;

  v_text := case
    when p_white is not null then format('%s %s - %s %s', team_name(m, 'white'), p_white, p_black, team_name(m, 'black'))
    when p_diff = 0 then 'Pareggio'
    when p_diff > 0 then format('%s vincono di %s', team_name(m, 'white'), p_diff)
    else format('%s vincono di %s', team_name(m, 'black'), -p_diff) end;

  if m.locked then
    perform notify(array(select user_id from bookings where match_id = p_match and list = 'team'),
      'result_final', 'Risultato corretto dal Leader', v_text, '/partita/' || p_match || '/risultato', p_match);
  else
    perform notify(array(select user_id from bookings where match_id = p_match and list = 'team' and user_id <> v_uid),
      'result_review', 'Risultato inserito: ' || v_text,
      display_name(v_uid) || ' ha inserito il risultato. Confermi?', '/partita/' || p_match || '/risultato', p_match,
      '[{"action":"confirm_result","title":"Confermo"}]'::jsonb);
  end if;
end $$;

create or replace function public.submit_votes_unchecked(
  p_match uuid, p_votes jsonb, p_white_pick uuid default null, p_black_pick uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
begin
  select * into m from matches where id = p_match;
  if not is_participant(p_match, v_uid) then raise exception 'Vota solo chi ha giocato'; end if;
  if now() < m.votes_opens_at then raise exception 'Si vota da %', fmt_when(m.votes_opens_at); end if;
  if now() > m.votes_closes_at then raise exception 'Le votazioni sono chiuse'; end if;
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
  on conflict (match_id, voter_id, target_id) do update set score = excluded.score;

  insert into mvp_votes (match_id, voter_id, white_pick, black_pick)
  values (p_match, v_uid, nullif(p_white_pick, v_uid), nullif(p_black_pick, v_uid))
  on conflict (match_id, voter_id) do update set white_pick = excluded.white_pick, black_pick = excluded.black_pick;
end $$;

create or replace function public.run_scheduler() returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  w record;
  v_url text;
begin
  perform ensure_next_match();

  for m in select * from matches where status = 'scheduled' order by starts_at loop
    v_url := '/partita/' || m.id;

    -- REQ-021: il Leader è sempre il numero 1
    if titular_leader() is not null and m.starts_at > now()
       and not exists (select 1 from bookings where match_id = m.id and user_id = titular_leader()) then
      perform _book(titular_leader(), titular_leader(), m.id, 'present', true);
    end if;

    -- REQ-023: avviso a chi ha una finestra esclusiva
    for w in select * from priority_windows where match_id = m.id and not notified and opens_at <= now() loop
      perform notify(array[w.user_id], 'priority_open', 'Hai la precedenza',
        'Puoi prenotarti prima degli altri per ' || fmt_when(m.starts_at) || '.', v_url, m.id,
        '[{"action":"present","title":"Ci sono"},{"action":"reserve","title":"Riserva"},{"action":"absent","title":"Non ci sono"}]'::jsonb);
      update priority_windows set notified = true where match_id = w.match_id and user_id = w.user_id;
    end loop;

    -- REQ-010: lunedì a mezzogiorno si aprono le prenotazioni
    if not m.sent_open and now() >= m.bookings_open_at then
      perform notify(
        array(select id from profiles where active
              and id not in (select user_id from bookings where match_id = m.id and list <> 'out')),
        'booking_open', 'Si gioca ' || fmt_when(m.starts_at),
        'Prenotazioni aperte. Ci sei?', v_url, m.id,
        '[{"action":"present","title":"Ci sono"},{"action":"reserve","title":"Riserva"},{"action":"absent","title":"Non ci sono"}]'::jsonb);
      update matches set sent_open = true where id = m.id;
    end if;

    -- REQ-027: si possono fare le formazioni
    if not m.sent_lineup_window and now() >= lineup_opens_at(m) then
      perform notify(staff_ids() || array_remove(array[m.lineup_delegate], null), 'lineup_window',
        'Si fanno le squadre', 'Da adesso puoi assegnare Bianchi e Neri.', v_url || '/squadre', m.id);
      update matches set sent_lineup_window = true where id = m.id;
    end if;

    -- REQ-020: alle riserve si chiede conferma (entro 12 ore prima, gradita)
    if not m.sent_reserve_reminder and now() >= m.starts_at - interval '16 hours' then
      perform notify(
        array(select user_id from bookings where match_id = m.id and list = 'reserve' and reserve_reply is null),
        'reserve_check', 'Sei di riserva: ci sei?',
        'Faccelo sapere entro 12 ore dalla partita, così ci organizziamo.', v_url, m.id,
        '[{"action":"reserve_yes","title":"Disponibile"},{"action":"reserve_no","title":"Non posso"}]'::jsonb);
      update matches set sent_reserve_reminder = true where id = m.id;
    end if;

    -- REQ-033: a fine partita il risultato
    if not m.sent_result and now() >= result_opens_at(m) then
      perform notify(array(select user_id from bookings where match_id = m.id and list = 'team'),
        'result_open', 'Com''è finita?', 'Inserisci o conferma il risultato e i marcatori.',
        v_url || '/risultato', m.id);
      update matches set sent_result = true where id = m.id;
    end if;
  end loop;

  -- REQ-041: le votazioni si aprono all'orario impostato per ogni partita (anche dopo la chiusura di mezzanotte)
  for m in select * from matches
           where not sent_votes and status <> 'cancelled' and now() >= votes_opens_at and now() < votes_closes_at loop
    perform notify(array(select user_id from bookings where match_id = m.id and list = 'team'),
      'votes_open', 'Pagelle aperte', 'Vota i compagni e scegli il migliore in campo di ogni squadra.',
      '/partita/' || m.id || '/voti', m.id);
    update matches set sent_votes = true where id = m.id;
  end loop;

  -- REQ-040: a mezzanotte si chiude tutto
  for m in select * from matches where status = 'scheduled' and not locked loop
    if now() >= lock_at(m) then
      update matches set locked = true, status = 'played' where id = m.id;
      if exists (select 1 from results where match_id = m.id and status = 'pending')
         or not exists (select 1 from results where match_id = m.id) then
        -- REQ-039: niente quorum, tocca a Leader e Premier
        perform notify(staff_ids(), 'homologate_needed', 'Risultato da omologare',
          'Non si è raggiunto il quorum: puoi omologare tu il risultato.', '/partita/' || m.id || '/risultato', m.id);
      end if;
    end if;
  end loop;

  -- rete di sicurezza: rilancia il dispatcher se qualcosa è rimasto in coda
  if exists (select 1 from notifications where push_claimed_at is null and created_at < now() - interval '2 minutes') then
    perform kick_dispatcher();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Riassesta squadra e riserve dopo un cambio di numero di giocatori
-- ---------------------------------------------------------------------
create or replace function public.rebalance_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_size int;
  v_leader uuid := titular_leader();
  v_moved uuid;
  v_url text := '/partita/' || p_match;
begin
  select * into m from matches where id = p_match;
  v_size := m.players_per_team * 2;
  -- troppi: l'ultimo arrivato non inserito dal Leader scende in testa alle riserve
  loop
    exit when (select count(*) from bookings where match_id = p_match and list = 'team') <= v_size;
    select user_id into v_moved from bookings
     where match_id = p_match and list = 'team' and user_id is distinct from v_leader
     order by (placed_by is not null), sort_key desc limit 1;
    exit when v_moved is null;
    update bookings
       set list = 'reserve', updated_at = now(),
           sort_key = coalesce((select min(sort_key) from bookings where match_id = p_match and list = 'reserve'),
                               clock_timestamp()) - interval '1 millisecond'
     where match_id = p_match and user_id = v_moved;
    perform notify(array[v_moved], 'demoted', 'Sei passato tra le riserve',
      'Si gioca ' || m.players_per_team || ' contro ' || m.players_per_team || ': sei il primo della lista delle riserve.', v_url, p_match);
    v_moved := null;
  end loop;
  -- c'è spazio: le riserve salgono in ordine
  loop
    exit when (select count(*) from bookings where match_id = p_match and list = 'team') >= v_size;
    select user_id into v_moved from bookings where match_id = p_match and list = 'reserve' order by sort_key limit 1;
    exit when v_moved is null;
    update bookings set list = 'team', sort_key = clock_timestamp(), updated_at = now()
     where match_id = p_match and user_id = v_moved;
    perform notify(array[v_moved], 'promoted', 'Sei dentro!',
      'Si gioca ' || m.players_per_team || ' contro ' || m.players_per_team || ': si è liberato un posto, sei in squadra.', v_url, p_match);
    v_moved := null;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Validazione di una configurazione inviata dall'app
-- ---------------------------------------------------------------------
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
end $$;

-- ---------------------------------------------------------------------
-- Il Leader crea una o più partite. Le date sono giorni di calendario: l'ora
-- si applica nel fuso del gruppo, quindi l'ora legale non sposta nulla.
-- Le date in cui c'è già una partita vengono saltate.
-- ---------------------------------------------------------------------
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
                         booking_close_days, booking_close_time, votes_open_after_min, votes_hours)
    values (d, v_start, s.duration_min, v_start,
            (p_config->>'players_per_team')::smallint, p_config->>'team_a_kit', p_config->>'team_b_kit',
            (p_config->>'booking_open_days')::smallint, (p_config->>'booking_open_time')::time,
            (p_config->>'booking_close_days')::smallint, (p_config->>'booking_close_time')::time,
            (p_config->>'votes_open_after_min')::smallint, (p_config->>'votes_hours')::smallint)
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

-- Configurazione predefinita (giorno, ora e regole per le nuove partite)
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
    votes_open_after_min = (p_config->>'votes_open_after_min')::smallint, vote_hours = (p_config->>'votes_hours')::smallint
  where id = 1;
end $$;

-- ---------------------------------------------------------------------
-- Applica alcune impostazioni a partite già create (solo quelle ancora da giocare).
-- p_fields: 'time', 'players_per_team', 'kits', 'booking_open', 'booking_close', 'votes_open', 'votes_close'
-- ---------------------------------------------------------------------
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
      votes_hours = case when 'votes_close' = any (p_fields) then (p_config->>'votes_hours')::smallint else votes_hours end
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
      perform rebalance_match(m.id);
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
-- Permessi
-- ---------------------------------------------------------------------
revoke execute on function public.leader_create_matches(date[], time, jsonb, boolean), public.update_default_match_config(jsonb, int, time),
  public.update_matches_config(uuid[], jsonb, text[], time), public.kit_name(text), public.is_kit(text),
  public.team_name(public.matches, text), public.check_match_config(jsonb), public.rebalance_match(uuid),
  public.trg_matches_config(), public.trg_lineup_slot()
from public, anon;
grant execute on function public.leader_create_matches(date[], time, jsonb, boolean), public.update_default_match_config(jsonb, int, time),
  public.update_matches_config(uuid[], jsonb, text[], time), public.kit_name(text), public.is_kit(text),
  public.team_name(public.matches, text)
to authenticated;
revoke execute on function public.rebalance_match(uuid), public.trg_matches_config(), public.trg_lineup_slot() from authenticated;
