-- =====================================================================
-- Giocatori senza account
-- Il Leader crea profili di giocatori che non hanno (ancora) un account: si
-- mettono in lista, entrano nelle formazioni, vengono votati e restano nelle
-- statistiche. Con un invito personale, chi crea l'account (o ne ha già uno)
-- prende il posto del profilo, statistiche comprese.
-- =====================================================================

-- Un profilo non deve più per forza avere un account
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles
  add column guest boolean not null default false,
  add column invite_token text unique,
  add column invite_expires_at timestamptz;

-- Eliminando un account si elimina il suo profilo, come faceva il vincolo tolto
create or replace function public.handle_deleted_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from profiles where id = old.id;
  return old;
end $$;
create trigger on_auth_user_deleted after delete on auth.users
for each row execute function public.handle_deleted_user();

-- ---------------------------------------------------------------------
-- Unisce il profilo p_from in p_into: tutto ciò che apparteneva a p_from passa a p_into.
-- Dove esistono entrambi per la stessa partita resta il dato di p_into.
-- ---------------------------------------------------------------------
create or replace function public.merge_profiles(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g profiles;
begin
  if p_from = p_into then return; end if;
  select * into g from profiles where id = p_from;
  if not found then raise exception 'Profilo da collegare non trovato'; end if;

  -- prenotazioni, finestre, formazioni, conferme, marcatori, permessi sui voti: una riga per partita
  delete from bookings x where x.user_id = p_from and exists (select 1 from bookings y where y.user_id = p_into and y.match_id = x.match_id);
  update bookings set user_id = p_into where user_id = p_from;
  update bookings set placed_by = p_into where placed_by = p_from;
  delete from priority_windows x where x.user_id = p_from and exists (select 1 from priority_windows y where y.user_id = p_into and y.match_id = x.match_id);
  update priority_windows set user_id = p_into where user_id = p_from;
  delete from lineup x where x.user_id = p_from and exists (select 1 from lineup y where y.user_id = p_into and y.match_id = x.match_id);
  update lineup set user_id = p_into where user_id = p_from;
  delete from result_reviews x where x.user_id = p_from and exists (select 1 from result_reviews y where y.user_id = p_into and y.match_id = x.match_id);
  update result_reviews set user_id = p_into where user_id = p_from;
  delete from scorers x where x.user_id = p_from and exists (select 1 from scorers y where y.user_id = p_into and y.match_id = x.match_id);
  update scorers set user_id = p_into where user_id = p_from;
  update scorers set updated_by = p_into where updated_by = p_from;
  delete from vote_grants x where x.user_id = p_from and exists (select 1 from vote_grants y where y.user_id = p_into and y.match_id = x.match_id);
  update vote_grants set user_id = p_into where user_id = p_from;

  -- voti: niente voti a sé stessi e niente doppioni dello stesso votante
  delete from player_votes where (voter_id = p_into and target_id = p_from) or (voter_id = p_from and target_id = p_into);
  delete from player_votes x where x.target_id = p_from
    and exists (select 1 from player_votes y where y.match_id = x.match_id and y.voter_id = x.voter_id and y.target_id = p_into);
  update player_votes set target_id = p_into where target_id = p_from;
  delete from player_votes x where x.voter_id = p_from
    and exists (select 1 from player_votes y where y.match_id = x.match_id and y.voter_id = p_into and y.target_id = x.target_id);
  update player_votes set voter_id = p_into where voter_id = p_from;
  update mvp_votes set white_pick = null where voter_id = p_into and white_pick = p_from;
  update mvp_votes set black_pick = null where voter_id = p_into and black_pick = p_from;
  update mvp_votes set white_pick = p_into where white_pick = p_from;
  update mvp_votes set black_pick = p_into where black_pick = p_from;
  delete from mvp_votes x where x.voter_id = p_from and exists (select 1 from mvp_votes y where y.voter_id = p_into and y.match_id = x.match_id);
  update mvp_votes set white_pick = null where voter_id = p_from and white_pick = p_into;
  update mvp_votes set black_pick = null where voter_id = p_from and black_pick = p_into;
  update mvp_votes set voter_id = p_into where voter_id = p_from;

  -- tutto il resto
  update chat_messages set user_id = p_into where user_id = p_from;
  update notifications set user_id = p_into where user_id = p_from;
  update punishments set user_id = p_into where user_id = p_from;
  update punishments set created_by = p_into where created_by = p_from;
  update punishments set revoked_by = p_into where revoked_by = p_from;
  update matches set lineup_delegate = p_into where lineup_delegate = p_from;
  update matches set lineup_proposed_by = p_into where lineup_proposed_by = p_from;
  update results set entered_by = p_into where entered_by = p_from;
  update leadership_delegation set delegate_id = p_into where delegate_id = p_from;

  -- dati anagrafici: restano quelli dell'account, i mancanti si prendono dal profilo
  update profiles p set
    last_name = coalesce(p.last_name, g.last_name),
    nickname = coalesce(p.nickname, g.nickname),
    field_role = coalesce(p.field_role, g.field_role),
    birth_date = coalesce(p.birth_date, g.birth_date),
    weight_kg = coalesce(p.weight_kg, g.weight_kg),
    height_cm = coalesce(p.height_cm, g.height_cm),
    stats_since = coalesce(p.stats_since, g.stats_since),
    active = true, pending = false
  where p.id = p_into;

  delete from profiles where id = p_from;
end $$;

-- ---------------------------------------------------------------------
-- Il Leader crea, modifica ed elimina i giocatori senza account
-- ---------------------------------------------------------------------
create or replace function public.create_guest(p_first text, p_last text default null, p_nickname text default null, p_field_role text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può aggiungere giocatori senza account'; end if;
  if nullif(trim(p_first), '') is null then raise exception 'Il nome è obbligatorio'; end if;
  insert into profiles (first_name, last_name, nickname, field_role, guest, active, pending)
  values (left(trim(p_first), 40), nullif(trim(p_last), ''), nullif(trim(p_nickname), ''), nullif(p_field_role, ''), true, true, false)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_guest(p_user uuid, p_first text, p_last text default null, p_nickname text default null, p_field_role text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può modificare i giocatori senza account'; end if;
  if nullif(trim(p_first), '') is null then raise exception 'Il nome è obbligatorio'; end if;
  update profiles set first_name = left(trim(p_first), 40), last_name = nullif(trim(p_last), ''),
                      nickname = nullif(trim(p_nickname), ''), field_role = nullif(p_field_role, '')
   where id = p_user and guest;
  if not found then raise exception 'Giocatore senza account non trovato'; end if;
end $$;

-- Elimina il giocatore e i suoi dati (prenotazioni, formazioni, gol, voti ricevuti)
create or replace function public.delete_guest(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può eliminare i giocatori senza account'; end if;
  delete from profiles where id = p_user and guest;
  if not found then raise exception 'Giocatore senza account non trovato'; end if;
end $$;

-- Invito personale (valido 14 giorni): un nuovo invito sostituisce il precedente
create or replace function public.create_guest_invite(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può invitare'; end if;
  update profiles set invite_token = v_token, invite_expires_at = now() + interval '14 days'
   where id = p_user and guest;
  if not found then raise exception 'Giocatore senza account non trovato'; end if;
  return jsonb_build_object('token', v_token, 'expires_at', now() + interval '14 days');
end $$;

-- Chi apre l'invito (anche senza essere collegato) vede solo il nome del profilo
create or replace function public.invite_info(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('first_name', first_name, 'nickname', nickname, 'expires_at', invite_expires_at)
  from profiles
  where guest and invite_token is not null and invite_token = p_token and invite_expires_at > now()
$$;

-- Chi ha già un account si collega al profilo dall'invito
create or replace function public.claim_guest_profile(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_guest profiles;
begin
  if v_uid is null then raise exception 'Accedi prima di collegare il profilo'; end if;
  if not exists (select 1 from profiles where id = v_uid) then raise exception 'Profilo non trovato'; end if;
  select * into v_guest from profiles
   where guest and invite_token is not null and invite_token = p_token and invite_expires_at > now();
  if not found then raise exception 'Invito non valido o scaduto: chiedine uno nuovo al Leader'; end if;
  perform merge_profiles(v_guest.id, v_uid);
  perform notify(staff_ids(), 'guest_linked', 'Account collegato',
    display_name(v_uid) || ' ha collegato il suo account al profilo di ' || v_guest.first_name || '.', '/giocatore/' || v_uid);
  return v_guest.first_name;
end $$;

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text;
  v_first boolean := not exists (select 1 from profiles where not guest);   -- i giocatori senza account non contano
  v_guest uuid;
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
  -- invito personale a collegarsi a un giocatore senza account: entra subito nel gruppo
  select id into v_guest from profiles
   where guest and invite_token is not null and invite_token = (v_meta->>'link_token') and invite_expires_at > now();
  v_ok := v_first or v_guest is not null or v_code is null or v_code = '' or (v_meta->>'invite_code') = v_code;

  insert into profiles (id, first_name, last_name, role, active, pending)
  values (new.id, left(v_name, 40), nullif(trim(v_meta->>'last_name'), ''),
          case when v_first then 'leader' else 'user' end, v_ok, not v_ok);

  -- il nuovo account prende il posto del giocatore senza account (statistiche comprese);
  -- se qualcosa va storto la registrazione riesce comunque e il collegamento si può rifare dall'invito
  if v_guest is not null then
    begin
      perform merge_profiles(v_guest, new.id);
      perform notify(staff_ids(), 'guest_linked', 'Account collegato',
        v_name || ' ha creato il suo account dall''invito ed è collegato al suo profilo.', '/giocatore/' || new.id);
    exception when others then
      raise warning 'Collegamento non riuscito: %', sqlerrm;
    end;
  end if;

  if not v_ok then
    perform notify(staff_ids(), 'member_pending', 'Nuova richiesta di accesso',
                   v_name || ' vuole unirsi al gruppo.', '/gestione');
  end if;
  return new;
end $$;

create or replace function public.notify(
  p_users uuid[], p_kind text, p_title text, p_body text,
  p_url text default null, p_match uuid default null, p_actions jsonb default null
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, url, match_id, actions)
  select p.id, p_kind, p_title, p_body, p_url, p_match, p_actions
  from profiles p
  where p.active and not p.guest and p.id = any (p_users)   -- chi non ha account non riceve avvisi
    and not (
      p_kind = any (array['booking_open','priority_open','need_one','reserve_check','booking_reset',
                          'result_open','votes_open','result_review','lineup_window','lineup_review',
                          'lineup_delegate','homologate_needed','member_pending'])
      and public.is_punished(p.id)
    )
$$;

create or replace view public.members as
with me as (select auth.uid() as uid, public.is_staff() as staff)
select
  p.id,
  p.first_name,
  case when p.id = me.uid or (p.visibility->>'last_name')::boolean  then p.last_name  end as last_name,
  case when p.id = me.uid or (p.visibility->>'nickname')::boolean   then p.nickname   end as nickname,
  case when p.id = me.uid or (p.visibility->>'field_role')::boolean then p.field_role end as field_role,
  case when p.id = me.uid or (p.visibility->>'birth_date')::boolean then p.birth_date end as birth_date,
  case when p.id = me.uid or (p.visibility->>'weight_kg')::boolean  then p.weight_kg  end as weight_kg,
  case when p.id = me.uid or (p.visibility->>'height_cm')::boolean  then p.height_cm  end as height_cm,
  p.role, p.active, p.pending, p.created_at,
  case when me.staff or p.id = me.uid then p.last_seen_at end as last_seen_at,
  case when p.id = me.uid or coalesce((p.visibility->>'avatar')::boolean, true) then p.avatar_path end as avatar_path,
  p.guest
from public.profiles p cross join me
where me.uid is not null
  and (p.active or me.staff or exists (select 1 from public.bookings b where b.user_id = p.id));

create or replace function public.can_reset_password(p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when p_target is null or p_target = auth.uid() then false
      when p_target = titular_leader() then false
      when exists (select 1 from profiles where id = p_target and guest) then false   -- senza account non c'è password
      when not exists (select 1 from profiles where id = p_target and active) then false
      when (select role from profiles where id = p_target) = 'user' then is_staff()
      else has_leader_powers()
    end, false)
$$;

create or replace function public.set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = p_user and guest) then
    raise exception '% non ha un account: prima va collegato tramite invito', display_name(p_user);
  end if;
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
  if exists (select 1 from profiles where id = p_user and guest) then
    raise exception '% non ha un account: prima va collegato tramite invito', display_name(p_user);
  end if;
  if v_me is distinct from titular_leader() then raise exception 'Solo il Leader titolare può cedere il ruolo'; end if;
  if p_user = v_me then return; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Utente non trovato'; end if;
  update profiles set role = 'user' where id = v_me;
  update profiles set role = 'leader' where id = p_user;
  update leadership_delegation set delegate_id = null, until = null where id = 1;
  perform notify(array[p_user], 'role', 'Sei il nuovo Leader', 'Il gruppo è nelle tue mani.', '/gestione');
end $$;

create or replace function public.delegate_leadership(p_user uuid, p_until timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = p_user and guest) then
    raise exception '% non ha un account: prima va collegato tramite invito', display_name(p_user);
  end if;
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

create or replace function public.set_lineup_delegate(p_match uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from profiles where id = p_user and guest) then
    raise exception '% non ha un account: prima va collegato tramite invito', display_name(p_user);
  end if;
  if not has_leader_powers() then raise exception 'Solo il Leader può affidare le formazioni'; end if;
  update matches set lineup_delegate = p_user where id = p_match;
  if p_user is not null then
    perform notify(array[p_user], 'lineup_delegate', 'Fai tu le squadre',
      'Il Leader ti ha affidato le formazioni di questa partita.', '/partita/' || p_match || '/squadre', p_match);
  end if;
end $$;

create or replace function public.punish_member(p_user uuid, p_until timestamptz, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(p_reason), '');
  v_id bigint;
  v_booked int;
begin
  if exists (select 1 from profiles where id = p_user and guest) then
    raise exception '% non ha un account: prima va collegato tramite invito', display_name(p_user);
  end if;
  if not has_leader_powers(v_actor) then raise exception 'Solo il Leader può mettere in punizione'; end if;
  if p_user = v_actor then raise exception 'Non puoi punire te stesso'; end if;
  if p_user = titular_leader() then raise exception 'Il Leader non può essere punito'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Giocatore non trovato'; end if;
  if p_until is not null and p_until <= now() then raise exception 'Scegli una scadenza futura'; end if;

  -- una sola punizione attiva: la nuova sostituisce l'eventuale precedente
  update punishments set revoked_at = now(), revoked_by = v_actor
   where user_id = p_user and revoked_at is null and (ends_at is null or ends_at > now());
  insert into punishments (user_id, ends_at, reason, created_by)
  values (p_user, p_until, v_reason, v_actor) returning id into v_id;

  select count(*) into v_booked
  from bookings b join matches m on m.id = b.match_id
  where b.user_id = p_user and b.list in ('team', 'reserve') and m.status = 'scheduled' and m.starts_at > now();

  perform notify(array[p_user], 'punished', 'Sei in punizione',
    display_name(v_actor) || ' ti ha messo in punizione '
      || case when p_until is null then 'fino a nuovo ordine' else 'fino a ' || fmt_when(p_until) end
      || coalesce('. Motivo: ' || v_reason, '') || '. Puoi consultare l''app, ma non partecipare.', '/');

  return jsonb_build_object('id', v_id, 'booked_matches', v_booked);
end $$;

revoke execute on function public.merge_profiles(uuid, uuid), public.handle_deleted_user() from public, anon, authenticated;
revoke execute on function public.create_guest(text, text, text, text), public.update_guest(uuid, text, text, text, text),
  public.delete_guest(uuid), public.create_guest_invite(uuid), public.claim_guest_profile(text) from public, anon;
grant execute on function public.create_guest(text, text, text, text), public.update_guest(uuid, text, text, text, text),
  public.delete_guest(uuid), public.create_guest_invite(uuid), public.claim_guest_profile(text) to authenticated;
-- l'invito si legge anche prima di accedere, per mostrare a chi è rivolto
grant execute on function public.invite_info(text) to anon, authenticated;
