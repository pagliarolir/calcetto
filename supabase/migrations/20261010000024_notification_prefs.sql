-- =====================================================================
-- Preferenze sulle notifiche
-- Ognuno sceglie nel profilo quali avvisi ricevere, per categoria. Le scelte
-- valgono sia per le notifiche sul telefono sia per la sezione Avvisi.
-- Gli avvisi che riguardano solo te (entri in squadra, il Leader ti sposta,
-- punizioni, punti Leader...) e i compiti dello staff arrivano sempre.
-- Nuovi avvisi: messaggi in chat, squadra al completo, rinuncia di un titolare.
-- =====================================================================

alter table public.profiles add column notify_prefs jsonb not null default '{}'::jsonb;
grant update (notify_prefs) on public.profiles to authenticated;

-- A quale voce appartiene un tipo di avviso (null = arriva sempre)
create or replace function public.notify_category(p_kind text) returns text
language sql immutable as $$
  select case
    when p_kind = 'chat' then 'chat'
    when p_kind in ('booking_open', 'priority_open') then 'booking_open'
    when p_kind = 'team_full' then 'team_full'
    when p_kind in ('withdrawal', 'need_one', 'late_withdrawal') then 'withdrawal'
    when p_kind = 'lineup_official' then 'lineup_official'
    when p_kind = 'lineup_change' then 'lineup_change'
    when p_kind in ('match_moved', 'venue_changed', 'match_cancelled') then 'match_changes'
    when p_kind in ('result_open', 'result_review', 'result_contested', 'result_final', 'result_homologated') then 'result'
    when p_kind = 'votes_open' then 'votes'
  end
$$;

-- Vuole questo avviso? Voce mancante = accesa, tranne la chat (spenta finché non la accendi)
create or replace function public.notify_wanted(p_prefs jsonb, p_kind text) returns boolean
language sql immutable as $$
  select case
    when public.notify_category(p_kind) is null then true
    else coalesce((p_prefs ->> public.notify_category(p_kind))::boolean, public.notify_category(p_kind) <> 'chat')
  end
$$;

-- ---------------------------------------------------------------------
-- La funzione degli avvisi rispetta le preferenze (testo originale con una modifica mirata)
-- ---------------------------------------------------------------------
create or replace function public.notify(
  p_users uuid[], p_kind text, p_title text, p_body text,
  p_url text default null, p_match uuid default null, p_actions jsonb default null
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, url, match_id, actions)
  select p.id, p_kind, p_title, p_body, p_url, p_match, p_actions
  from profiles p
  where p.active and not p.guest and p.id = any (p_users)   -- chi non ha account non riceve avvisi
    and public.notify_wanted(p.notify_prefs, p_kind)           -- le preferenze di chi riceve
    and not (
      p_kind = any (array['booking_open','priority_open','need_one','reserve_check','booking_reset',
                          'result_open','votes_open','result_review','lineup_window','lineup_review',
                          'lineup_delegate','homologate_needed','member_pending'])
      and public.is_punished(p.id)
    )
$$;

-- ---------------------------------------------------------------------
-- Nuovo avviso: messaggio in chat
-- A chi è in lista per la partita (squadra, riserve, disponibili) e allo staff.
-- Per non inondare gli Avvisi: niente nuovo avviso se il precedente della stessa
-- chat non è ancora stato letto ed è di meno di 10 minuti fa.
-- ---------------------------------------------------------------------
create or replace function public.trg_chat_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify(
    array(
      select u from (
        select user_id as u from bookings where match_id = new.match_id and list in ('team', 'reserve', 'pending')
        union select unnest(staff_ids())
      ) x
      where u <> new.user_id
        and not exists (select 1 from notifications n
                        where n.user_id = x.u and n.kind = 'chat' and n.match_id = new.match_id
                          and n.read_at is null and n.created_at > now() - interval '10 minutes')
    ),
    'chat', 'Chat: ' || display_name(new.user_id), left(new.body, 140),
    '/partita/' || new.match_id || '/chat', new.match_id);
  return null;
end $$;
create trigger chat_notify after insert on public.chat_messages
for each row execute function public.trg_chat_notify();

-- ---------------------------------------------------------------------
-- Nuovi avvisi sulle prenotazioni: squadra al completo e rinuncia di un titolare
-- (con un trigger valgono qualunque sia il percorso: risposta, Leader, riserve che salgono)
-- ---------------------------------------------------------------------
create or replace function public.trg_bookings_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_team int;
begin
  select * into m from matches where id = new.match_id;
  if not found or m.status <> 'scheduled' or now() >= m.starts_at then return null; end if;

  -- squadra al completo (solo "in ordine di arrivo": con "sceglie il Leader" decide lui)
  if m.booking_mode = 'order' and new.list = 'team' and (tg_op = 'INSERT' or old.list is distinct from 'team') then
    select count(*) into v_team from bookings where match_id = new.match_id and list = 'team';
    if v_team = m.players_per_team * 2 then
      -- chi ha completato la lista (il giocatore o il Leader) lo sa già
      perform notify(array_remove(array(select id from profiles where active), auth.uid()), 'team_full', 'Squadra al completo',
        'Per ' || fmt_when(m.starts_at) || ' siamo in ' || v_team || ': chi risponde ora va tra le riserve.',
        '/partita/' || m.id, m.id);
    end if;
  end if;

  -- rinuncia di un titolare (in qualsiasi momento): a chi è in lista per la partita
  if tg_op = 'UPDATE' and old.list = 'team' and new.list <> 'team' and new.withdrew then
    perform notify(
      -- né chi rinuncia né chi ha fatto la modifica (es. il Leader che lo segna assente)
      array_remove(array_remove(array(select user_id from bookings where match_id = new.match_id and list in ('team', 'reserve', 'pending')), new.user_id), auth.uid()),
      'withdrawal', 'Rinuncia', display_name(new.user_id) || ' non gioca più ' || fmt_when(m.starts_at) || '.',
      '/partita/' || m.id, m.id);
  end if;
  return null;
end $$;
create trigger bookings_events after insert or update on public.bookings
for each row execute function public.trg_bookings_events();

revoke execute on function public.trg_chat_notify(), public.trg_bookings_events() from public, anon, authenticated;
grant execute on function public.notify_category(text), public.notify_wanted(jsonb, text) to authenticated, service_role;
