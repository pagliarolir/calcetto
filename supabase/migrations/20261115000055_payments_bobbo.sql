-- Pagamenti: chi si chiama «Bobbo» (di solito come soprannome, con il nome vuoto o nascosto) li vede sempre,
-- insieme al Leader. Vale sia il soprannome sia il nome.
-- Prima l'elenco si riempiva una volta sola, quando si applicava la migrazione 54; ora il controllo è sul
-- soprannome (o nome) attuale: maiuscole, spazi ed emoji non contano.
-- L'elenco scelto dal Leader e l'apertura a tutti continuano a valere.

-- «Bobbo» ripulito da maiuscole, spazi, emoji e segni
create or replace function public.pay_is_bobbo(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = p_uid
                 and 'bobbo' in (regexp_replace(lower(coalesce(p.nickname, '')), '[^a-z]', '', 'g'),
                                 regexp_replace(lower(coalesce(p.first_name, '')), '[^a-z]', '', 'g')))
$$;
revoke execute on function public.pay_is_bobbo(uuid) from public, anon, authenticated;

create or replace function public.pay_can_see(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_active_member(p_uid) and (
           has_leader_powers(p_uid)
           or pay_is_bobbo(p_uid)
           or exists (select 1 from pay_settings where id = 1 and (public or p_uid = any (preview_users)))), false)
$$;
revoke execute on function public.pay_can_see(uuid) from public, anon;
grant execute on function public.pay_can_see(uuid) to authenticated;

-- e lo aggiunge all'elenco, così compare anche tra le persone scelte nella pagina
update public.pay_settings
   set preview_users = array(select distinct u from unnest(preview_users || coalesce(
         (select array_agg(id) from public.profiles where active and public.pay_is_bobbo(id)), '{}')) u)
 where id = 1;
