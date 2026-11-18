-- =====================================================================
-- FantaLeader visibile solo a Bobbo (decisione del proprietario, 18/11/2026): neanche il Leader.
-- fl_visible() è la domanda dell'app «mostro la voce Fanta?»: ora risponde sì solo a Bobbo (soprannome o nome,
-- come pay_is_bobbo). fl_can_see() non cambia: le funzioni del Leader e le letture restano com'erano.
-- Bobbo entra (o resta) nell'elenco dell'anteprima, così può leggere i dati.
-- =====================================================================
create or replace function public.fl_visible() returns boolean
language sql stable security definer set search_path = public as $$
  select fl_can_see() and pay_is_bobbo(auth.uid())
$$;
revoke execute on function public.fl_visible() from public, anon;
grant execute on function public.fl_visible() to authenticated;

update public.fl_settings
   set preview_users = (select coalesce(array_agg(distinct u), '{}') from unnest(
         preview_users || coalesce((select array_agg(id) from public.profiles where active and not guest and pay_is_bobbo(id)), '{}')) u)
 where id = 1;
