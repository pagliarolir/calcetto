-- =====================================================================
-- Azioni rapide dalle notifiche push (REQ-011)
-- Chiamata solo dalla Edge Function "quick-action" dopo aver verificato
-- il token firmato: impersona l'utente per la durata della transazione.
-- =====================================================================

create or replace function public.quick_action(p_user uuid, p_match uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_res jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);

  case p_action
    when 'present', 'absent', 'reserve' then
      v_res := book(p_match, p_action);
      return case
        when v_res->>'list' = 'team' then 'Sei dentro con il numero ' || (v_res->>'slot') || '.'
        when v_res->>'list' = 'reserve' then 'Sei tra le riserve con il numero ' || (v_res->>'slot') || '.'
        else 'Segnato come assente.' end;
    when 'reserve_yes' then
      perform reserve_reply(p_match, 'confirmed');
      return 'Grazie, sei disponibile come riserva.';
    when 'reserve_no' then
      perform reserve_reply(p_match, 'declined');
      return 'Ok, risulti assente.';
    when 'confirm_result' then
      perform review_result(p_match, true);
      return 'Risultato confermato.';
    else
      raise exception 'Azione sconosciuta';
  end case;
end $$;

revoke execute on function public.quick_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.quick_action(uuid, uuid, text) to service_role;
