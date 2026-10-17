-- =====================================================================
-- Dove si gioca: nome del campo/circolo, indirizzo e link del circolo.
-- Il campo abituale sta in app_settings e ogni nuova partita lo eredita;
-- il Leader può cambiarlo per una singola partita.
-- =====================================================================

alter table public.app_settings
  add column venue_name    text check (char_length(venue_name) <= 80),
  add column venue_address text check (char_length(venue_address) <= 200),
  add column venue_url     text check (venue_url is null or (venue_url ~* '^https?://\S+$' and char_length(venue_url) <= 300));

alter table public.matches
  add column venue_name    text check (char_length(venue_name) <= 80),
  add column venue_address text check (char_length(venue_address) <= 200),
  add column venue_url     text check (venue_url is null or (venue_url ~* '^https?://\S+$' and char_length(venue_url) <= 300));

-- Ogni nuova partita parte dal campo abituale (se non ne ha già uno)
create or replace function public.trg_matches_default_venue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.venue_name is null and new.venue_address is null and new.venue_url is null then
    select venue_name, venue_address, venue_url into new.venue_name, new.venue_address, new.venue_url
    from app_settings where id = 1;
  end if;
  return new;
end $$;

create trigger matches_default_venue
before insert on public.matches
for each row execute function public.trg_matches_default_venue();

-- Il Leader imposta il campo di una partita; con p_as_default diventa anche il campo abituale
create or replace function public.set_match_venue(
  p_match uuid, p_name text, p_address text, p_url text, p_as_default boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_name text := nullif(trim(p_name), '');
  v_address text := nullif(trim(p_address), '');
  v_url text := nullif(trim(p_url), '');
  v_changed boolean;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può cambiare il campo'; end if;
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;

  if v_url is not null then
    if v_url ~ '\s' then raise exception 'Il link del circolo non può contenere spazi'; end if;
    -- solo http e https; "www.circolo.it" diventa "https://www.circolo.it"
    if v_url ~* '^[a-z][a-z0-9+.-]*:(?![0-9])' and v_url !~* '^https?://' then
      raise exception 'Il link del circolo deve iniziare con http:// o https://';
    end if;
    if v_url !~* '^https?://' then v_url := 'https://' || v_url; end if;
  end if;

  -- cambio vero (non la prima impostazione) per una partita ancora da giocare
  v_changed := m.status = 'scheduled' and m.starts_at > now()
    and (m.venue_name is not null or m.venue_address is not null)
    and (m.venue_name is distinct from v_name or m.venue_address is distinct from v_address);

  update matches set venue_name = v_name, venue_address = v_address, venue_url = v_url where id = p_match;

  if p_as_default then
    update app_settings set venue_name = v_name, venue_address = v_address, venue_url = v_url where id = 1;
    -- le prossime partite già create e ancora senza campo prendono quello abituale
    update matches set venue_name = v_name, venue_address = v_address, venue_url = v_url
     where id <> p_match and status = 'scheduled' and starts_at > now()
       and venue_name is null and venue_address is null and venue_url is null;
  end if;

  if v_changed then
    perform notify(
      array_remove(array(select user_id from bookings where match_id = p_match and list in ('team', 'reserve')), auth.uid()),
      'venue_changed', 'Cambio di campo',
      'Per ' || fmt_when(m.starts_at) || ' si gioca a ' || coalesce(nullif(concat_ws(', ', v_name, v_address), ''), 'un campo da definire') || '.',
      '/partita/' || p_match, p_match);
  end if;
end $$;

revoke execute on function public.set_match_venue(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.set_match_venue(uuid, text, text, text, boolean) to authenticated;
revoke execute on function public.trg_matches_default_venue() from public, anon, authenticated;
