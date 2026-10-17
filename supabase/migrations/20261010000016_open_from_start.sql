-- =====================================================================
-- Chat e formazioni aperte da subito
-- La chat di una partita si apre quando la partita viene creata (si chiude
-- sempre 24 ore dopo la fine); le formazioni si possono fare e pubblicare
-- da subito. L'avviso "si fanno le squadre" diventa un promemoria a 24 ore
-- dalla partita, mandato solo se le squadre non sono ancora ufficiali.
-- =====================================================================

create or replace function public.chat_opens_at(m public.matches) returns timestamptz
language sql stable as $$ select m.created_at $$;

create or replace function public.lineup_opens_at(m public.matches) returns timestamptz
language sql stable as $$ select m.created_at $$;

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

    -- formazioni: si fanno da subito; a 24 ore dalla partita, promemoria solo se non sono ancora ufficiali
    if not m.sent_lineup_window and now() >= m.starts_at - interval '24 hours' then
      if m.lineup_status <> 'official' then
        perform notify(staff_ids() || array_remove(array[m.lineup_delegate], null), 'lineup_window',
          'Squadre da fare', 'Manca un giorno alla partita e le squadre non sono ancora ufficiali.', v_url || '/squadre', m.id);
      end if;
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

revoke execute on function public.run_scheduler() from authenticated, anon, public;
