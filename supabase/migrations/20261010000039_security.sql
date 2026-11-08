-- =====================================================================
-- Sicurezza
--  * le funzioni del FantaLeader non sono chiamabili senza accesso (prima: classifiche vuote,
--    ma fl_current_price restituiva la quotazione a chiunque conoscesse l'id di un giocatore);
--  * limiti contro gli abusi: al massimo 12 messaggi al minuto in chat e 20 cambi di risposta
--    ogni 10 minuti per giocatore (non valgono per le azioni dello staff su altri giocatori).
-- =====================================================================
revoke execute on function public.fl_team_match_points() from public, anon;
revoke execute on function public.fl_team_ranking() from public, anon;
revoke execute on function public.fl_player_ranking() from public, anon;
revoke execute on function public.fl_current_price(uuid) from public, anon;
grant execute on function public.fl_team_match_points(), public.fl_team_ranking(), public.fl_player_ranking(), public.fl_current_price(uuid) to authenticated;

-- registro delle azioni recenti per i limiti (si pulisce da solo dopo un giorno)
create table public.rate_events (
  user_id uuid not null,
  kind    text not null,
  at      timestamptz not null default now()
);
create index rate_events_lookup on public.rate_events (user_id, kind, at);
alter table public.rate_events enable row level security;   -- nessuna politica: lo usano solo le funzioni qui sotto
revoke all on public.rate_events from anon, authenticated;
grant all on public.rate_events to service_role;

create or replace function public.rate_limit(p_kind text, p_max int, p_window interval, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;   -- lavori pianificati e funzioni di sistema: nessun limite
  if (select count(*) from rate_events where user_id = me and kind = p_kind and at > now() - p_window) >= p_max then
    raise exception '%', p_message using errcode = 'P0429';
  end if;
  insert into rate_events (user_id, kind) values (me, p_kind);
  delete from rate_events where at < now() - interval '1 day';
end $$;
revoke execute on function public.rate_limit(text, int, interval, text) from public, anon, authenticated;

create or replace function public.trg_rate_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform rate_limit('chat', 12, interval '1 minute', 'Stai scrivendo troppo in fretta: aspetta un momento.');
  return new;
end $$;
create trigger rate_chat before insert on public.chat_messages for each row execute function public.trg_rate_chat();

create or replace function public.trg_rate_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- solo quando è il giocatore a cambiare la propria risposta (non lo staff, non i lavori pianificati)
  if auth.uid() is not null and new.user_id = auth.uid()
     and (tg_op = 'INSERT' or new.choice is distinct from old.choice) then
    perform rate_limit('booking', 20, interval '10 minutes', 'Troppi cambi di risposta: riprova tra qualche minuto.');
  end if;
  return new;
end $$;
create trigger rate_booking before insert or update on public.bookings for each row execute function public.trg_rate_booking();

-- le funzioni dei trigger non si chiamano a mano (i trigger scattano comunque)
revoke execute on function public.trg_rate_chat() from public, anon, authenticated;
revoke execute on function public.trg_rate_booking() from public, anon, authenticated;
