-- =====================================================================
-- Foto profilo
-- Le immagini stanno nello Storage di Supabase, in un contenitore PRIVATO "avatars":
-- le vedono solo i membri attivi (tramite link temporanei firmati).
-- Percorso di ogni foto: <id utente>/<uuid>.jpg — ognuno scrive solo nella propria cartella.
-- =====================================================================

-- Percorso della foto nel profilo: deve stare nella cartella dell'utente stesso
alter table public.profiles add column avatar_path text;
alter table public.profiles add constraint profiles_avatar_path_own_folder check (
  avatar_path is null
  or (avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and split_part(avatar_path, '/', 1) = id::text)
);
grant update (avatar_path) on public.profiles to authenticated;

-- La foto si può nascondere agli altri, come gli altri dati (REQ-003). Predefinito: visibile.
update public.profiles set visibility = visibility || '{"avatar": true}'::jsonb where not visibility ? 'avatar';
alter table public.profiles alter column visibility set default
  '{"last_name":true,"nickname":true,"field_role":true,"birth_date":false,"weight_kg":false,"height_cm":false,"avatar":true}';

-- Vista dei membri: stessa definizione di prima, più la foto (in fondo, come richiede "create or replace view")
create or replace view public.members as
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
  case when p.id = me.uid or coalesce((p.visibility->>'avatar')::boolean, true) then p.avatar_path end as avatar_path
from public.profiles p cross join me
where me.uid is not null
  and (p.active or me.staff or exists (select 1 from public.bookings b where b.user_id = p.id));

revoke all on public.members from anon;
grant select on public.members to authenticated;

-- ---------------------------------------------------------------------
-- Contenitore privato: solo JPEG, al massimo 512 KB (l'app carica circa 30 KB)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/jpeg'])
on conflict (id) do nothing;

create policy "foto profilo: le vedono i membri attivi" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_active_member());

create policy "foto profilo: ognuno carica la propria" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_member()
  );

create policy "foto profilo: si cancella la propria, lo staff tutte" on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
  );

-- ---------------------------------------------------------------------
-- Leader e Premier possono togliere una foto inappropriata.
-- Restituisce il percorso: il file lo cancella poi l'app tramite l'API dello Storage
-- (cancellarlo in SQL lascerebbe il file orfano nello spazio di archiviazione).
-- ---------------------------------------------------------------------
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
      display_name(auth.uid()) || ' ha rimosso la tua foto profilo. Puoi caricarne un''altra dal Profilo.', '/profilo');
  end if;
  return v_path;
end $$;

revoke execute on function public.remove_member_avatar(uuid) from public, anon;
grant execute on function public.remove_member_avatar(uuid) to authenticated;
