-- =====================================================================
-- Il Leader elimina definitivamente un ex giocatore (già cancellato dal gruppo):
-- profilo e account, con i suoi dati (prenotazioni, formazioni, gol, voti dati e
-- ricevuti). Restituisce la foto, che l'app toglie dallo Storage.
-- =====================================================================

create or replace function public.delete_former_member(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_p profiles;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader elimina gli ex giocatori'; end if;
  select * into v_p from profiles where id = p_user;
  if not found then raise exception 'Giocatore non trovato'; end if;
  if p_user = titular_leader() or p_user = auth.uid() then raise exception 'Questo profilo non si può eliminare'; end if;
  if v_p.active or v_p.pending then
    raise exception '% fa ancora parte del gruppo: prima va cancellato dal gruppo', v_p.first_name;
  end if;
  delete from profiles where id = p_user;                 -- con i suoi dati
  if not v_p.guest then
    delete from auth.users where id = p_user;             -- e l'account
  end if;
  return v_p.avatar_path;
end $$;

revoke execute on function public.delete_former_member(uuid) from public, anon;
grant execute on function public.delete_former_member(uuid) to authenticated;
