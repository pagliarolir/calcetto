-- Sicurezza: la password temporanea data dal Leader (Edge Function admin-reset-password) scade dopo 24 ore
-- se non è stata cambiata. Alla scadenza si sostituisce con una casuale che nessuno conosce:
-- chi la doveva usare chiede una nuova password al Leader (o usa il recupero via email).

alter table public.profiles add column if not exists password_reset_at timestamptz;

create or replace function public.mark_password_reset(p_target uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set must_change_password = true, password_reset_at = now() where id = p_target;
  perform notify(array[p_target], 'password_reset', 'Password reimpostata',
    display_name(p_actor) || ' ha reimpostato la tua password. Al prossimo accesso ne sceglierai una nuova: quella temporanea vale 24 ore.', '/profilo?scheda=sicurezza');
  if not has_leader_powers(p_actor) then
    perform notify(array[titular_leader()], 'password_reset_staff', 'Password reimpostata',
      display_name(p_actor) || ' ha reimpostato la password di ' || display_name(p_target) || '.', '/gestione');
  end if;
end $$;
revoke execute on function public.mark_password_reset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_password_reset(uuid, uuid) to service_role;

create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change_password = false, password_reset_at = null where id = auth.uid()
$$;

-- ogni ora: le password temporanee non cambiate entro 24 ore diventano inutilizzabili
create or replace function public.expire_temp_passwords() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0;
  has_pw boolean := exists (select 1 from information_schema.columns
                            where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password');
begin
  for r in select id from profiles
           where must_change_password and password_reset_at is not null and password_reset_at < now() - interval '24 hours' loop
    if has_pw then
      execute 'update auth.users set encrypted_password = crypt($1, gen_salt(''bf'')) where id = $2'
        using encode(gen_random_bytes(24), 'base64'), r.id;
    end if;
    update profiles set password_reset_at = null where id = r.id;
    perform notify(array[r.id], 'password_reset', 'Password temporanea scaduta',
      'Sono passate 24 ore: la password temporanea non vale più. Chiedine una nuova al Leader.', '/');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.expire_temp_passwords() from public, anon, authenticated;

select cron.schedule('temp-passwords', '7 * * * *', $$select public.expire_temp_passwords()$$);
