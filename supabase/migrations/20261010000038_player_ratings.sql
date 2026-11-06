-- =====================================================================
-- Valori dei giocatori (Aggiornamento 6)
--  * ruoli in campo: solo difensore, centrocampista, attaccante
--    (portiere -> difensore con il pallino del portiere verde; laterale -> centrocampista;
--     pivot -> attaccante; jolly -> nessun ruolo, lo sceglie il Leader);
--  * 13 caratteristiche da 0 a 100 + pallino del portiere (+2 / +1 / 0 sulla media
--    generale) + eventuale valore impostato a mano: le vede SOLO il Leader;
--  * i giocatori vedono la scheda calcolata: valore nel ruolo, esagono (attacco, tiro,
--    difesa, velocità, tecnica, forza) e i valori per fascia del campo;
--  * valori per posizione con i coefficienti Punta / Esterno / Centrale
--    (difensore = Centrale, centrocampista = Esterno, attaccante = Punta,
--     centrocampo centrale = media dei tre, portiere = media generale + bonus);
--  * il Leader modifica profilo e foto degli altri giocatori.
-- =====================================================================

-- ---------------------------------------------------------------- ruoli
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%field_role%' loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;

-- ---------------------------------------------------------------- caratteristiche (solo Leader)
create table public.player_ratings (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  shot_accuracy   smallint check (shot_accuracy between 0 and 100),     -- precisione tiro
  shot_power      smallint check (shot_power between 0 and 100),        -- potenza tiro
  finishing       smallint check (finishing between 0 and 100),         -- finalizzazione
  dribbling       smallint check (dribbling between 0 and 100),
  speed           smallint check (speed between 0 and 100),             -- velocità
  agility         smallint check (agility between 0 and 100),           -- agilità
  stamina         smallint check (stamina between 0 and 100),           -- corsa
  marking         smallint check (marking between 0 and 100),           -- marcatura
  ball_protection smallint check (ball_protection between 0 and 100),   -- protezione della palla
  strength        smallint check (strength between 0 and 100),          -- forza fisica
  positioning     smallint check (positioning between 0 and 100),       -- posizione
  ball_control    smallint check (ball_control between 0 and 100),      -- controllo palla
  passing         smallint check (passing between 0 and 100),           -- passaggio
  gk              text check (gk in ('green', 'yellow', 'red')),        -- pallino del portiere
  override        smallint check (override between 0 and 100),          -- valore impostato a mano dal Leader
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null
);
alter table public.player_ratings enable row level security;
create policy "solo il Leader legge i valori" on public.player_ratings for select to authenticated using (has_leader_powers());
revoke all on public.player_ratings from anon, authenticated;
grant select on public.player_ratings to authenticated;
grant all on public.player_ratings to service_role;

-- conversione dei ruoli (i portieri prendono il pallino verde)
insert into public.player_ratings (user_id, gk) select id, 'green' from public.profiles where field_role = 'portiere' on conflict do nothing;
update public.profiles set field_role = case field_role
  when 'portiere' then 'difensore' when 'laterale' then 'centrocampista' when 'pivot' then 'attaccante'
  when 'difensore' then 'difensore' else null end
where field_role is not null;
alter table public.profiles add constraint profiles_field_role_check check (field_role in ('difensore', 'centrocampista', 'attaccante'));

-- ---------------------------------------------------------------- coefficienti (percentuali, ogni colonna fa 100)
create table public.rating_weights (
  attr     text primary key,
  label    text not null,
  sort     int not null,
  punta    numeric(5,2) not null,
  esterno  numeric(5,2) not null,
  centrale numeric(5,2) not null
);
insert into public.rating_weights (attr, label, sort, punta, esterno, centrale) values
  ('shot_accuracy',   'Precisione tiro',        1, 10,  5,  2),
  ('shot_power',      'Potenza tiro',           2,  8,  6,  3),
  ('finishing',       'Finalizzazione',         3, 14,  8,  2),
  ('dribbling',       'Dribbling',              4,  9,  9,  5),
  ('speed',           'Velocità',               5, 13, 13,  8),
  ('agility',         'Agilità',                6, 10, 10, 10),
  ('stamina',         'Corsa',                  7,  7, 20,  8),
  ('marking',         'Marcatura',              8,  2,  7, 19),
  ('ball_protection', 'Protezione della palla', 9,  5,  1,  5),
  ('strength',        'Forza fisica',          10,  5,  5, 12),
  ('positioning',     'Posizione',             11,  4,  4, 16),
  ('ball_control',    'Controllo palla',       12,  8,  7,  5),
  ('passing',         'Passaggio',             13,  5,  5,  5);
alter table public.rating_weights enable row level security;
create policy "membri leggono i coefficienti" on public.rating_weights for select to authenticated using (is_active_member());
revoke all on public.rating_weights from anon, authenticated;
grant select on public.rating_weights to authenticated;
grant all on public.rating_weights to service_role;

-- ---------------------------------------------------------------- scheda visibile ai giocatori (solo valori calcolati)
create or replace function public.player_cards(p_users uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb := '[]'::jsonb; r record; v jsonb; w record;
  dif numeric; est numeric; att numeric; cen numeric; overall numeric; best text; bestv numeric; rv numeric; n int;
begin
  if not is_active_member() then raise exception 'Accesso riservato ai membri del gruppo'; end if;
  for r in
    select p.id, p.field_role, pr.* from profiles p left join player_ratings pr on pr.user_id = p.id
    where p.id = any (coalesce(p_users, '{}'))
  loop
    v := to_jsonb(r);
    -- servono tutte e 13 le caratteristiche
    select count(*) into n from rating_weights rw where v ->> rw.attr is not null;
    if n < 13 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', r.id, 'has', false, 'role', r.field_role, 'gk', r.gk));
      continue;
    end if;
    select sum((v ->> attr)::numeric * centrale) / 100, sum((v ->> attr)::numeric * esterno) / 100, sum((v ->> attr)::numeric * punta) / 100,
           avg((v ->> attr)::numeric)
      into dif, est, att, overall from rating_weights;
    cen := (dif + est + att) / 3;
    overall := least(100, overall + case r.gk when 'green' then 2 when 'yellow' then 1 else 0 end);
    bestv := greatest(dif, est, att);
    best := case when bestv = att then 'attaccante' when bestv = est then 'centrocampista' else 'difensore' end;
    rv := coalesce(r.override, case coalesce(r.field_role, best) when 'difensore' then dif when 'centrocampista' then est else att end);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_id', r.id, 'has', true, 'role', r.field_role, 'best', best,
      'role_value', round(rv), 'overall', round(overall), 'gk', r.gk,
      'dif', round(dif), 'est', round(est), 'cen', round(cen), 'att', round(att),
      'hex', jsonb_build_object(
        'attacco', r.finishing,
        'tiro', round((r.shot_accuracy + r.shot_power) / 2.0),
        'difesa', round((r.marking + r.positioning) / 2.0),
        'velocita', round((r.speed + r.agility + r.stamina) / 3.0),
        'tecnica', round((r.dribbling + r.ball_control) / 2.0),
        'forza', r.strength)));
  end loop;
  return v_out;
end $$;
revoke execute on function public.player_cards(uuid[]) from public, anon;
grant execute on function public.player_cards(uuid[]) to authenticated;

-- ---------------------------------------------------------------- il Leader inserisce i valori
create or replace function public.set_player_ratings(p_user uuid, p_vals jsonb, p_gk text, p_override int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader inserisce i valori dei giocatori'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Giocatore non trovato'; end if;
  for k in select jsonb_object_keys(coalesce(p_vals, '{}')) loop
    if not exists (select 1 from rating_weights where attr = k) then raise exception 'Caratteristica sconosciuta: %', k; end if;
    if p_vals ->> k is not null and ((p_vals ->> k)::numeric < 0 or (p_vals ->> k)::numeric > 100) then raise exception 'I valori vanno da 0 a 100'; end if;
  end loop;
  if p_gk is not null and p_gk not in ('green', 'yellow', 'red') then raise exception 'Pallino del portiere non valido'; end if;
  if p_override is not null and (p_override < 0 or p_override > 100) then raise exception 'Il valore va da 0 a 100'; end if;
  insert into player_ratings as t (user_id, shot_accuracy, shot_power, finishing, dribbling, speed, agility, stamina, marking,
                                   ball_protection, strength, positioning, ball_control, passing, gk, override, updated_at, updated_by)
  values (p_user, (p_vals ->> 'shot_accuracy')::smallint, (p_vals ->> 'shot_power')::smallint, (p_vals ->> 'finishing')::smallint,
          (p_vals ->> 'dribbling')::smallint, (p_vals ->> 'speed')::smallint, (p_vals ->> 'agility')::smallint, (p_vals ->> 'stamina')::smallint,
          (p_vals ->> 'marking')::smallint, (p_vals ->> 'ball_protection')::smallint, (p_vals ->> 'strength')::smallint,
          (p_vals ->> 'positioning')::smallint, (p_vals ->> 'ball_control')::smallint, (p_vals ->> 'passing')::smallint,
          p_gk, p_override, now(), auth.uid())
  on conflict (user_id) do update set
    shot_accuracy = excluded.shot_accuracy, shot_power = excluded.shot_power, finishing = excluded.finishing, dribbling = excluded.dribbling,
    speed = excluded.speed, agility = excluded.agility, stamina = excluded.stamina, marking = excluded.marking,
    ball_protection = excluded.ball_protection, strength = excluded.strength, positioning = excluded.positioning,
    ball_control = excluded.ball_control, passing = excluded.passing, gk = excluded.gk, override = excluded.override,
    updated_at = now(), updated_by = auth.uid();
  return player_cards(array[p_user]) -> 0;
end $$;
revoke execute on function public.set_player_ratings(uuid, jsonb, text, int) from public, anon;
grant execute on function public.set_player_ratings(uuid, jsonb, text, int) to authenticated;

-- ---------------------------------------------------------------- il Leader modifica il profilo e la foto degli altri
create or replace function public.admin_update_profile(p_user uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader modifica il profilo degli altri'; end if;
  if p ? 'first_name' and nullif(trim(p ->> 'first_name'), '') is null then raise exception 'Il nome è obbligatorio'; end if;
  update profiles set
    first_name = case when p ? 'first_name' then trim(p ->> 'first_name') else first_name end,
    last_name  = case when p ? 'last_name'  then nullif(trim(p ->> 'last_name'), '') else last_name end,
    nickname   = case when p ? 'nickname'   then nullif(trim(p ->> 'nickname'), '') else nickname end,
    field_role = case when p ? 'field_role' then nullif(p ->> 'field_role', '') else field_role end,
    birth_date = case when p ? 'birth_date' then nullif(p ->> 'birth_date', '')::date else birth_date end,
    weight_kg  = case when p ? 'weight_kg'  then nullif(p ->> 'weight_kg', '')::numeric else weight_kg end,
    height_cm  = case when p ? 'height_cm'  then nullif(p ->> 'height_cm', '')::numeric else height_cm end
  where id = p_user;
  if not found then raise exception 'Giocatore non trovato'; end if;
end $$;
revoke execute on function public.admin_update_profile(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_profile(uuid, jsonb) to authenticated;

create or replace function public.admin_set_avatar(p_user uuid, p_path text) returns text
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader cambia la foto degli altri'; end if;
  -- stesso formato della regola profiles_avatar_path_own_folder: <id del giocatore>/<uuid>.jpg
  if p_path is null or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' or split_part(p_path, '/', 1) <> p_user::text then
    raise exception 'Percorso della foto non valido';
  end if;
  select avatar_path into v_old from profiles where id = p_user;
  update profiles set avatar_path = p_path where id = p_user;
  return v_old;
end $$;
revoke execute on function public.admin_set_avatar(uuid, text) from public, anon;
grant execute on function public.admin_set_avatar(uuid, text) to authenticated;

create policy "foto profilo: il Leader carica per tutti" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.has_leader_powers());
