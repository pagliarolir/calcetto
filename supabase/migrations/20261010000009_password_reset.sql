-- =====================================================================
-- Recupero password
--  1. via email: gestito da Supabase Auth (serve un SMTP, vedi README)
--  2. dal Leader: password temporanea generata dalla Edge Function
--     "admin-reset-password", da cambiare al primo accesso
-- =====================================================================

alter table public.profiles add column must_change_password boolean not null default false;

-- Stesse regole della cancellazione: Leader e Premier per i giocatori,
-- solo chi ha i poteri del Leader per i Premier. Il Leader titolare usa l'email.
create or replace function public.can_reset_password(p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when p_target is null or p_target = auth.uid() then false
      when p_target = titular_leader() then false
      when not exists (select 1 from profiles where id = p_target and active) then false
      when (select role from profiles where id = p_target) = 'user' then is_staff()
      else has_leader_powers()
    end, false)
$$;

-- Chiamata dalla Edge Function dopo aver cambiato la password.
-- Avvisa l'interessato e, se a farlo è stato un Premier, anche il Leader.
create or replace function public.mark_password_reset(p_target uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set must_change_password = true where id = p_target;
  perform notify(array[p_target], 'password_reset', 'Password reimpostata',
    display_name(p_actor) || ' ha reimpostato la tua password. Al prossimo accesso ne sceglierai una nuova.', '/profilo');
  if not has_leader_powers(p_actor) then
    perform notify(array[titular_leader()], 'password_reset_staff', 'Password reimpostata',
      display_name(p_actor) || ' ha reimpostato la password di ' || display_name(p_target) || '.', '/gestione');
  end if;
end $$;

-- L'utente ha scelto la sua nuova password
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid()
$$;

revoke execute on function public.can_reset_password(uuid), public.password_changed(), public.mark_password_reset(uuid, uuid)
  from public, anon;
revoke execute on function public.mark_password_reset(uuid, uuid) from authenticated;
grant execute on function public.can_reset_password(uuid), public.password_changed() to authenticated;
grant execute on function public.mark_password_reset(uuid, uuid) to service_role;
