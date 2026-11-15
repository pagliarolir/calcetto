-- Pagamenti: chi vuole pagare qualcuno che non ha ancora messo PayPal o IBAN glielo chiede con un avviso.
-- L'avviso porta a Conti con il foglio «I miei dati di pagamento» già aperto (?dati=1).
-- Al massimo un avviso ogni 12 ore per la stessa coppia, così aprire «Salda» più volte non inonda nessuno.

create or replace function public.pay_ask_methods(p_to uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); who text := display_name(auth.uid());
begin
  perform assert_not_punished();
  perform pay_require();
  if p_to is null or p_to = me then return false; end if;
  if not pay_can_see(p_to) then return false; end if;
  -- ha già i dati: niente da chiedere
  if exists (select 1 from pay_methods where user_id = p_to and (paypal is not null or iban is not null)) then return false; end if;
  if exists (select 1 from notifications where user_id = p_to and kind = 'pay_ask_methods'
             and created_at > now() - interval '12 hours' and body like who || ' %') then return false; end if;
  perform notify(array[p_to], 'pay_ask_methods', 'Aggiungi i dati di pagamento',
    who || ' vuole pagarti: aggiungi PayPal o IBAN in Conti.', '/pagamenti?dati=1');
  return true;
end $$;
revoke execute on function public.pay_ask_methods(uuid) from public, anon;
grant execute on function public.pay_ask_methods(uuid) to authenticated;

-- l'invito ad aggiungere i dati è un invito ad agire: chi è in punizione non lo riceve (come gli altri inviti)
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
                          'lineup_delegate','homologate_needed','member_pending','pay_ask_methods'])
      and public.is_punished(p.id)
    )
$$;
