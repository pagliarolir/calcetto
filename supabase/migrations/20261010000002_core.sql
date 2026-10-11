-- =====================================================================
-- Funzioni di base: orari, leadership, notifiche, utenti
-- =====================================================================

-- ---------------------------------------------------------------------
-- Orari derivati di una partita (esposti anche come "colonne calcolate" via API)
-- ---------------------------------------------------------------------
create or replace function public.tz() returns text
language sql stable as $$ select timezone from public.app_settings where id = 1 $$;

create or replace function public.compute_open_at(p_starts timestamptz) returns timestamptz
language sql stable as $$
  select (((p_starts at time zone s.timezone)::date - s.booking_days_before) + s.booking_open_time) at time zone s.timezone
  from public.app_settings s where s.id = 1
$$;

create or replace function public.ends_at(m public.matches) returns timestamptz
language sql stable as $$ select m.starts_at + make_interval(mins => m.duration_min) $$;

-- Data in italiano per i testi delle notifiche: "giovedì 15/10 alle 20:00"
create or replace function public.fmt_when(p timestamptz) returns text
language sql stable as $$
  select (array['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'])
           [extract(dow from p at time zone public.tz())::int + 1]
         || ' ' || to_char(p at time zone public.tz(), 'DD/MM "alle" HH24:MI')
$$;

-- REQ-033: alle 21:30, mezz'ora dopo la fine
create or replace function public.result_opens_at(m public.matches) returns timestamptz
language sql stable as $$ select m.starts_at + make_interval(mins => m.duration_min + 30) $$;

-- REQ-040: mezzanotte successiva all'apertura del risultato
create or replace function public.lock_at(m public.matches) returns timestamptz
language sql stable as $$
  select (((public.result_opens_at(m) at time zone public.tz())::date + 1)::timestamp) at time zone public.tz()
$$;

create or replace function public.votes_close_at(m public.matches) returns timestamptz
language sql stable as $$
  select public.result_opens_at(m) + make_interval(hours => (select vote_hours from public.app_settings where id = 1))
$$;

-- REQ-027: formazioni dalle 24 ore prima
create or replace function public.lineup_opens_at(m public.matches) returns timestamptz
language sql stable as $$ select m.starts_at - interval '24 hours' $$;

-- REQ-025: chat da 24h prima a 24h dopo
create or replace function public.chat_opens_at(m public.matches) returns timestamptz
language sql stable as $$ select m.starts_at - interval '24 hours' $$;

create or replace function public.chat_closes_at(m public.matches) returns timestamptz
language sql stable as $$ select public.ends_at(m) + interval '24 hours' $$;

-- ---------------------------------------------------------------------
-- Leadership (REQ-004..REQ-008)
-- ---------------------------------------------------------------------
create or replace function public.titular_leader() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where role = 'leader' and active
$$;

-- Chi esercita i poteri del Leader in questo momento secondo la regola dei 15 giorni:
-- Leader se si è connesso di recente, altrimenti Premier 1, altrimenti Premier 2.
create or replace function public.acting_leader() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_cut timestamptz;
  r record;
begin
  select now() - make_interval(days => inactivity_days) into v_cut from app_settings where id = 1;
  for r in
    select id, last_seen_at from profiles
    where active and role in ('leader','premier1','premier2')
    order by case role when 'leader' then 1 when 'premier1' then 2 else 3 end
  loop
    if r.last_seen_at >= v_cut then return r.id; end if;
  end loop;
  return (select id from profiles where active and role in ('leader','premier1','premier2')
          order by case role when 'leader' then 1 when 'premier1' then 2 else 3 end limit 1);
end $$;

-- Il Leader titolare che si connette riprende subito i poteri (REQ-007);
-- il delegato li ha finché dura la delega (REQ-005).
create or replace function public.has_leader_powers(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null
     and exists (select 1 from profiles where id = p_uid and active)
     and (
          p_uid = titular_leader()
       or p_uid = acting_leader()
       or exists (select 1 from leadership_delegation d
                  where d.delegate_id = p_uid and (d.until is null or d.until > now()))
     )
$$;

create or replace function public.is_staff(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_leader_powers(p_uid)
      or exists (select 1 from profiles where id = p_uid and active and role in ('premier1','premier2'))
$$;

create or replace function public.is_active_member(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_uid and active)
$$;

create or replace function public.staff_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select id from profiles where active and role <> 'user'
    union
    select delegate_id from leadership_delegation where delegate_id is not null and (until is null or until > now())
  ) s
$$;

create or replace function public.display_name(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(case when (visibility->>'nickname')::boolean then nullif(nickname, '') end, first_name)
  from profiles where id = p_uid
$$;

-- ---------------------------------------------------------------------
-- Notifiche: si accodano qui, il dispatcher le spedisce come push
-- ---------------------------------------------------------------------
create or replace function public.notify(
  p_users uuid[], p_kind text, p_title text, p_body text,
  p_url text default null, p_match uuid default null, p_actions jsonb default null
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, url, match_id, actions)
  select p.id, p_kind, p_title, p_body, p_url, p_match, p_actions
  from profiles p
  where p.active and p.id = any (p_users)
$$;

-- Un'unica chiamata HTTP per ogni insert in coda (trigger a livello di statement)
create or replace function public.kick_dispatcher() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'dispatch_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'dispatch_secret';
  exception when others then
    return;   -- vault non configurato: le notifiche restano in coda (visibili in app)
  end;
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret)
  );
end $$;

create or replace function public.trg_notifications_dispatch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform kick_dispatcher();
  return null;
end $$;

create trigger notifications_dispatch
after insert on public.notifications
for each statement execute function public.trg_notifications_dispatch();

-- Usata dal dispatcher: prende in carico le notifiche non ancora spedite
create or replace function public.claim_notifications(p_limit int default 200)
returns setof public.notifications
language sql security definer set search_path = public as $$
  update notifications n set push_claimed_at = now()
  where n.id in (
    select id from notifications
    where push_claimed_at is null
    order by id
    limit p_limit
    for update skip locked
  )
  returning n.*
$$;

-- ---------------------------------------------------------------------
-- Registrazione: crea il profilo. Il primo utente diventa Leader.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text;
  v_first boolean := not exists (select 1 from profiles);
  v_code text;
  v_ok boolean;
begin
  v_name := coalesce(
    nullif(trim(v_meta->>'first_name'), ''),
    nullif(split_part(trim(coalesce(v_meta->>'full_name', v_meta->>'name', '')), ' ', 1), ''),
    split_part(new.email, '@', 1),
    'Giocatore'
  );
  select invite_code into v_code from app_settings where id = 1;
  v_ok := v_first or v_code is null or v_code = '' or (v_meta->>'invite_code') = v_code;

  insert into profiles (id, first_name, last_name, role, active, pending)
  values (new.id, left(v_name, 40), nullif(trim(v_meta->>'last_name'), ''),
          case when v_first then 'leader' else 'user' end, v_ok, not v_ok);

  if not v_ok then
    perform notify(staff_ids(), 'member_pending', 'Nuova richiesta di accesso',
                   v_name || ' vuole unirsi al gruppo.', '/gestione');
  end if;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Sessione: aggiorna "ultimo accesso" e restituisce profilo e poteri
-- ---------------------------------------------------------------------
create or replace function public.touch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_profile profiles;
  d leadership_delegation;
begin
  if v_uid is null then raise exception 'Accesso richiesto'; end if;
  update profiles set last_seen_at = now() where id = v_uid and active returning * into v_profile;
  if not found then
    select * into v_profile from profiles where id = v_uid;
  end if;
  select * into d from leadership_delegation where id = 1;
  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'leader_powers', has_leader_powers(v_uid),
    'staff', is_staff(v_uid),
    'acting_leader', acting_leader(),
    'titular_leader', titular_leader(),
    'delegation', case when d.delegate_id is not null and (d.until is null or d.until > now())
                       then jsonb_build_object('delegate_id', d.delegate_id, 'until', d.until) end
  );
end $$;

-- ---------------------------------------------------------------------
-- Gestione utenti
-- ---------------------------------------------------------------------
create or replace function public.set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può assegnare i ruoli'; end if;
  if p_role not in ('premier1','premier2','user') then raise exception 'Ruolo non valido'; end if;
  if p_user = titular_leader() then raise exception 'Per cambiare Leader usa il passaggio di consegne'; end if;
  if p_role <> 'user' then
    update profiles set role = 'user' where role = p_role and id <> p_user;
  end if;
  update profiles set role = p_role where id = p_user and active;
  if not found then raise exception 'Utente non trovato'; end if;
  perform notify(array[p_user], 'role', 'Nuovo ruolo',
    case p_role when 'premier1' then 'Ora sei il Primo Premier.'
                when 'premier2' then 'Ora sei il Secondo Premier.'
                else 'Ora sei un giocatore del gruppo.' end, '/profilo');
end $$;

create or replace function public.transfer_leadership(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is distinct from titular_leader() then raise exception 'Solo il Leader titolare può cedere il ruolo'; end if;
  if p_user = v_me then return; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Utente non trovato'; end if;
  update profiles set role = 'user' where id = v_me;
  update profiles set role = 'leader' where id = p_user;
  update leadership_delegation set delegate_id = null, until = null where id = 1;
  perform notify(array[p_user], 'role', 'Sei il nuovo Leader', 'Il gruppo è nelle tue mani.', '/gestione');
end $$;

-- REQ-005: delega temporanea. p_user null = revoca.
create or replace function public.delegate_leadership(p_user uuid, p_until timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is distinct from titular_leader() then raise exception 'Solo il Leader può delegare'; end if;
  if p_user is not null and not exists (select 1 from profiles where id = p_user and active) then
    raise exception 'Utente non trovato';
  end if;
  update leadership_delegation set delegate_id = p_user, until = p_until, created_at = now() where id = 1;
  if p_user is not null then
    perform notify(array[p_user], 'delegation', 'Hai i poteri del Leader',
      case when p_until is null then 'Fino a nuovo avviso.'
           else 'Fino a ' || fmt_when(p_until) || '.' end, '/gestione');
  end if;
end $$;

-- REQ-008: cancellazione (disattivazione: lo storico statistico resta)
create or replace function public.deactivate_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target profiles;
  m record;
begin
  if not is_staff() then raise exception 'Solo Leader e Premier possono cancellare utenti'; end if;
  select * into v_target from profiles where id = p_user;
  if not found then raise exception 'Utente non trovato'; end if;
  if p_user = titular_leader() then raise exception 'Il Leader non può essere cancellato'; end if;
  if v_target.role <> 'user' and not has_leader_powers() then
    raise exception 'Solo il Leader può cancellare un Premier';
  end if;
  -- libera i posti nelle partite future
  for m in select b.match_id from bookings b join matches x on x.id = b.match_id
           where b.user_id = p_user and b.list <> 'out' and x.status = 'scheduled' and x.starts_at > now()
  loop
    perform _book(p_user, p_user, m.match_id, 'absent', true);
  end loop;
  update profiles set active = false, pending = false, role = 'user' where id = p_user;
  delete from push_subscriptions where user_id = p_user;
  update leadership_delegation set delegate_id = null, until = null where delegate_id = p_user;
end $$;

create or replace function public.approve_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Solo Leader e Premier possono approvare'; end if;
  update profiles set active = true, pending = false where id = p_user;
  perform notify(array[p_user], 'welcome', 'Benvenuto nel gruppo', 'Ora puoi prenotarti alle partite.', '/');
end $$;
