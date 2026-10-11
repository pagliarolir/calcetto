-- =====================================================================
-- Scheduler: gira ogni 5 minuti con pg_cron (gratuito su Supabase)
-- =====================================================================

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

    -- REQ-033 e REQ-041: a fine partita risultato e voti
    if not m.sent_result and now() >= result_opens_at(m) then
      perform notify(array(select user_id from bookings where match_id = m.id and list = 'team'),
        'result_open', 'Com''è finita?', 'Inserisci o conferma il risultato e i marcatori.',
        v_url || '/risultato', m.id);
      perform notify(array(select user_id from bookings where match_id = m.id and list = 'team'),
        'votes_open', 'Pagelle aperte', 'Vota i compagni e scegli il migliore in campo di ogni squadra.',
        v_url || '/voti', m.id);
      update matches set sent_result = true where id = m.id;
    end if;
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

select cron.schedule('calcetto-scheduler', '*/5 * * * *', $$select public.run_scheduler()$$);

-- pulizia: avvisi letti più vecchi di 90 giorni
select cron.schedule('calcetto-cleanup', '17 4 * * *',
  $$delete from public.notifications where created_at < now() - interval '90 days'$$);

-- crea subito la prima partita
select public.ensure_next_match();
