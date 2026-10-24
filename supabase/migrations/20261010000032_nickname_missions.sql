-- =====================================================================
-- Soprannome al posto del nome e missioni degli sticker
--  * chi nasconde il nome viene mostrato agli altri con il soprannome (nell'app
--    e negli avvisi); per nasconderlo serve un soprannome, che diventa visibile;
--  * la missione di uno sticker si vede appena qualcuno l'ha sbloccato (chi non
--    l'ha ancora continua a vedere la sagoma nera).
-- =====================================================================

-- nome nascosto => soprannome obbligatorio e visibile
create or replace function public.trg_profiles_name_visibility() returns trigger
language plpgsql set search_path = public as $$
begin
  if not coalesce((new.visibility->>'first_name')::boolean, true) then
    if nullif(trim(coalesce(new.nickname, '')), '') is null then
      raise exception 'Per nascondere il nome serve un soprannome';
    end if;
    new.visibility := new.visibility || '{"nickname": true}'::jsonb;
  end if;
  return new;
end $$;
create trigger profiles_name_visibility before insert or update of visibility, nickname on public.profiles
  for each row execute function public.trg_profiles_name_visibility();
revoke execute on function public.trg_profiles_name_visibility() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------
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
  -- nome nascosto: al suo posto gli altri vedono il soprannome
  case when p.id = me.uid or coalesce((p.visibility->>'first_name')::boolean, true) or nullif(trim(p.nickname), '') is null
       then p.first_name else p.nickname end as first_name,
  case when p.id = me.uid or (p.visibility->>'last_name')::boolean  then p.last_name  end as last_name,
  case when p.id = me.uid or (p.visibility->>'nickname')::boolean or not coalesce((p.visibility->>'first_name')::boolean, true)
       then p.nickname end as nickname,
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

create or replace function public.display_name(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(case when (visibility->>'nickname')::boolean or not coalesce((visibility->>'first_name')::boolean, true)
                       then nullif(trim(nickname), '') end, first_name)
  from profiles where id = p_uid
$$;

create or replace function public.achievement_missions() returns table (id uuid, mission text)
language sql stable security definer set search_path = public as $$
  select a.id, a.mission from achievements a
  where is_active_member()
    -- la missione si scopre appena qualcuno ha sbloccato lo sticker (il Leader la vede sempre)
    and (has_leader_powers()
         or exists (select 1 from player_achievements pa where pa.achievement_id = a.id))
$$;
