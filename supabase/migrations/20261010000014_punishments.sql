-- =====================================================================
-- Punizioni: il Leader mette in punizione un giocatore per il tempo che vuole.
-- Il punito entra nell'app e legge tutto (statistiche comprese), ma non può
-- intervenire: niente prenotazioni, chat, risultato, marcatori, voti, formazioni,
-- né poteri da Premier o da delegato finché dura la punizione.
-- Ogni tentativo bloccato solleva l'errore GDL01 con il messaggio di rimprovero,
-- che l'app riconosce e mostra al centro dello schermo.
-- =====================================================================

create table public.punishments (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,                 -- null = finché il Leader non la revoca
  reason      text check (char_length(reason) <= 200),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles (id) on delete set null
);
create index punishments_user on public.punishments (user_id) where revoked_at is null;

alter table public.punishments enable row level security;
grant select on public.punishments to authenticated;
-- le proprie le vede l'interessato; tutte le vedono Leader e Premier (non sospesi)
create policy "le mie punizioni o staff" on public.punishments for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------
-- Controlli
-- ---------------------------------------------------------------------
create or replace function public.is_punished(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null and exists (
    select 1 from punishments
    where user_id = p_uid and revoked_at is null and starts_at <= now()
      and (ends_at is null or ends_at > now())
  )
$$;

create or replace function public.assert_not_punished() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if is_punished(auth.uid()) then
    raise exception using errcode = 'GDL01', message = 'Sei in punizione per ordine del Leader, rifletti sui tuoi errori';
  end if;
end $$;

-- Per l'app: la punizione in corso dell'utente collegato (null se non c'è)
create or replace function public.my_punishment() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ends_at', ends_at, 'reason', reason, 'since', starts_at)
  from punishments
  where user_id = auth.uid() and revoked_at is null and starts_at <= now()
    and (ends_at is null or ends_at > now())
  order by created_at desc limit 1
$$;

-- ---------------------------------------------------------------------
-- Poteri sospesi durante la punizione (il Leader titolare non può essere punito)
-- ---------------------------------------------------------------------
create or replace function public.acting_leader() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_cut timestamptz;
  r record;
begin
  select now() - make_interval(days => inactivity_days) into v_cut from app_settings where id = 1;
  for r in
    select id, last_seen_at from profiles
    where active and role in ('leader','premier1','premier2') and not is_punished(id)
    order by case role when 'leader' then 1 when 'premier1' then 2 else 3 end
  loop
    if r.last_seen_at >= v_cut then return r.id; end if;
  end loop;
  return (select id from profiles where active and role in ('leader','premier1','premier2') and not is_punished(id)
          order by case role when 'leader' then 1 when 'premier1' then 2 else 3 end limit 1);
end $$;

create or replace function public.has_leader_powers(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null
     and exists (select 1 from profiles where id = p_uid and active)
     and not public.is_punished(p_uid)
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
      or (exists (select 1 from profiles where id = p_uid and active and role in ('premier1','premier2'))
          and not public.is_punished(p_uid))
$$;

-- ---------------------------------------------------------------------
-- Il punito non riceve gli inviti a fare qualcosa (resta informato del resto)
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
    and not (
      p_kind = any (array['booking_open','priority_open','need_one','reserve_check','booking_reset',
                          'result_open','votes_open','result_review','lineup_window','lineup_review',
                          'lineup_delegate','homologate_needed','member_pending'])
      and public.is_punished(p.id)
    )
$$;

-- ---------------------------------------------------------------------
-- Chat in sola lettura per il punito
-- ---------------------------------------------------------------------
drop policy "scrivo nella finestra della chat" on public.chat_messages;
create policy "scrivo nella finestra della chat" on public.chat_messages for insert to authenticated
  with check (
    user_id = auth.uid() and is_active_member() and not is_punished()
    and exists (select 1 from matches m where m.id = match_id
                and now() between chat_opens_at(m) and chat_closes_at(m))
  );
drop policy "cancello i miei messaggi" on public.chat_messages;
create policy "cancello i miei messaggi" on public.chat_messages for delete to authenticated
  using ((user_id = auth.uid() and not is_punished()) or is_staff());

-- ---------------------------------------------------------------------
-- Guardiani: le azioni dei giocatori controllano la punizione e poi chiamano
-- la funzione originale, rinominata e non più richiamabile dall'app.
-- Firme e nomi dei parametri restano identici.
-- ---------------------------------------------------------------------
alter function public.book(uuid, text) rename to book_unchecked;
alter function public.reserve_reply(uuid, text) rename to reserve_reply_unchecked;
alter function public.submit_result(uuid, int, int, int) rename to submit_result_unchecked;
alter function public.review_result(uuid, boolean, text) rename to review_result_unchecked;
alter function public.save_scorers(uuid, jsonb) rename to save_scorers_unchecked;
alter function public.submit_votes(uuid, jsonb, uuid, uuid) rename to submit_votes_unchecked;
alter function public.save_lineup(uuid, jsonb, boolean) rename to save_lineup_unchecked;

revoke execute on function
  public.book_unchecked(uuid, text), public.reserve_reply_unchecked(uuid, text),
  public.submit_result_unchecked(uuid, int, int, int), public.review_result_unchecked(uuid, boolean, text),
  public.save_scorers_unchecked(uuid, jsonb), public.submit_votes_unchecked(uuid, jsonb, uuid, uuid),
  public.save_lineup_unchecked(uuid, jsonb, boolean)
from public, anon, authenticated;

create function public.book(p_match uuid, p_choice text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform assert_not_punished();
  return book_unchecked(p_match, p_choice);
end $$;

create function public.reserve_reply(p_match uuid, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_not_punished();
  perform reserve_reply_unchecked(p_match, p_reply);
end $$;

create function public.submit_result(p_match uuid, p_diff int, p_white int default null, p_black int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_not_punished();
  perform submit_result_unchecked(p_match, p_diff, p_white, p_black);
end $$;

create function public.review_result(p_match uuid, p_agree boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_not_punished();
  perform review_result_unchecked(p_match, p_agree, p_note);
end $$;

create function public.save_scorers(p_match uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_not_punished();
  perform save_scorers_unchecked(p_match, p_rows);
end $$;

create function public.submit_votes(p_match uuid, p_votes jsonb, p_white_pick uuid default null, p_black_pick uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_not_punished();
  perform submit_votes_unchecked(p_match, p_votes, p_white_pick, p_black_pick);
end $$;

create function public.save_lineup(p_match uuid, p_entries jsonb, p_publish boolean) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform assert_not_punished();
  return save_lineup_unchecked(p_match, p_entries, p_publish);
end $$;

-- ---------------------------------------------------------------------
-- Il Leader punisce e revoca
-- ---------------------------------------------------------------------
create or replace function public.punish_member(p_user uuid, p_until timestamptz, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(trim(p_reason), '');
  v_id bigint;
  v_booked int;
begin
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

create or replace function public.pardon_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può revocare una punizione'; end if;
  update punishments set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user and revoked_at is null and (ends_at is null or ends_at > now());
  if not found then raise exception '% non è in punizione', display_name(p_user); end if;
  perform notify(array[p_user], 'pardoned', 'Punizione revocata',
    'Il Leader ha revocato la tua punizione: bentornato in campo.', '/');
end $$;

-- Per la Gestione: punizioni in corso (solo Leader e Premier)
create or replace function public.active_punishments()
returns table (user_id uuid, ends_at timestamptz, reason text, since timestamptz, created_by uuid)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.ends_at, p.reason, p.starts_at, p.created_by
  from punishments p
  where is_staff() and p.revoked_at is null and p.starts_at <= now()
    and (p.ends_at is null or p.ends_at > now())
  order by p.created_at desc
$$;

revoke execute on function
  public.punish_member(uuid, timestamptz, text), public.pardon_member(uuid), public.active_punishments(),
  public.my_punishment(), public.is_punished(uuid), public.assert_not_punished(),
  public.book(uuid, text), public.reserve_reply(uuid, text), public.submit_result(uuid, int, int, int),
  public.review_result(uuid, boolean, text), public.save_scorers(uuid, jsonb),
  public.submit_votes(uuid, jsonb, uuid, uuid), public.save_lineup(uuid, jsonb, boolean)
from public, anon;
grant execute on function
  public.punish_member(uuid, timestamptz, text), public.pardon_member(uuid), public.active_punishments(),
  public.my_punishment(), public.is_punished(uuid), public.assert_not_punished(),
  public.book(uuid, text), public.reserve_reply(uuid, text), public.submit_result(uuid, int, int, int),
  public.review_result(uuid, boolean, text), public.save_scorers(uuid, jsonb),
  public.submit_votes(uuid, jsonb, uuid, uuid), public.save_lineup(uuid, jsonb, boolean)
to authenticated;
