-- =====================================================================
-- Permessi espliciti e vista dei membri senza "security definer"
--
-- 1) Dal 30 ottobre 2026 Supabase non dà più in automatico i permessi sulle
--    nuove tabelle di "public" (nuovi progetti, rami di anteprima, db reset).
--    authenticated e anon hanno già solo permessi espliciti; mancavano quelli di
--    service_role, usato dalle funzioni server (notifiche push, azioni rapide,
--    reimpostazione password). Qui vengono dati esplicitamente.
--    Regola per il futuro: ogni nuova tabella dichiara i suoi grant nella
--    stessa migrazione che la crea.
--
-- 2) La vista members leggeva i profili con i permessi di chi l'ha creata
--    (avviso "security definer view" del controllo di sicurezza di Supabase).
--    Le stesse regole di visibilità passano a una funzione protetta e la vista
--    diventa "security_invoker": l'app continua a leggere members come prima.
-- =====================================================================

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Stesse regole della vista precedente (testo originale)
create or replace function public.members_list()
returns table (
  id uuid, first_name text, last_name text, nickname text, field_role text, birth_date date,
  weight_kg numeric, height_cm smallint, role text, active boolean, pending boolean,
  created_at timestamptz, last_seen_at timestamptz, avatar_path text, guest boolean
)
language sql stable security definer set search_path = public as $$
with me as (select auth.uid() as uid, public.is_staff() as staff)
select
  p.id,
  p.first_name,
  case when p.id = me.uid or (p.visibility->>'last_name')::boolean  then p.last_name  end as last_name,
  case when p.id = me.uid or (p.visibility->>'nickname')::boolean   then p.nickname   end as nickname,
  case when p.id = me.uid or (p.visibility->>'field_role')::boolean then p.field_role end as field_role,
  case when p.id = me.uid or (p.visibility->>'birth_date')::boolean then p.birth_date end as birth_date,
  case when p.id = me.uid or (p.visibility->>'weight_kg')::boolean  then p.weight_kg  end as weight_kg,
  case when p.id = me.uid or (p.visibility->>'height_cm')::boolean  then p.height_cm  end as height_cm,
  p.role, p.active, p.pending, p.created_at,
  case when me.staff or p.id = me.uid then p.last_seen_at end as last_seen_at,
  case when p.id = me.uid or coalesce((p.visibility->>'avatar')::boolean, true) then p.avatar_path end as avatar_path,
  p.guest
from public.profiles p cross join me
where me.uid is not null
  and (p.active or me.staff or exists (select 1 from public.bookings b where b.user_id = p.id))
$$;

revoke execute on function public.members_list() from public, anon;
grant execute on function public.members_list() to authenticated, service_role;

create or replace view public.members with (security_invoker = true) as
  select * from public.members_list();

revoke all on public.members from anon;
grant select on public.members to authenticated, service_role;
