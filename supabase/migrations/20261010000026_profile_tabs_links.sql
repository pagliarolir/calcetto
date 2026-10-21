-- =====================================================================
-- Profilo a schede: gli avvisi che rimandano al profilo aprono la scheda giusta
-- (foto rimossa dallo staff -> Foto; password reimpostata -> Sicurezza).
-- Testo originale delle funzioni con il solo indirizzo cambiato.
-- =====================================================================

create or replace function public.remove_member_avatar(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  if not is_staff() then raise exception 'Solo Leader e Premier possono rimuovere una foto'; end if;
  select avatar_path into v_path from profiles where id = p_user;
  if v_path is null then return null; end if;
  update profiles set avatar_path = null where id = p_user;
  if p_user is distinct from auth.uid() then
    perform notify(array[p_user], 'avatar_removed', 'Foto profilo rimossa',
      display_name(auth.uid()) || ' ha rimosso la tua foto profilo. Puoi caricarne un''altra dal Profilo.', '/profilo?scheda=foto');
  end if;
  return v_path;
end $$;

create or replace function public.mark_password_reset(p_target uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set must_change_password = true where id = p_target;
  perform notify(array[p_target], 'password_reset', 'Password reimpostata',
    display_name(p_actor) || ' ha reimpostato la tua password. Al prossimo accesso ne sceglierai una nuova.', '/profilo?scheda=sicurezza');
  if not has_leader_powers(p_actor) then
    perform notify(array[titular_leader()], 'password_reset_staff', 'Password reimpostata',
      display_name(p_actor) || ' ha reimpostato la password di ' || display_name(p_target) || '.', '/gestione');
  end if;
end $$;
