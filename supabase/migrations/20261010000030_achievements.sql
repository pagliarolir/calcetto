-- =====================================================================
-- Obiettivi (sticker)
-- Ogni sticker ha un nome (visibile a tutti), una missione (segreta: la vede
-- solo il Leader e chi l'ha sbloccato) e un'immagine caricata dal Leader.
-- Si sbloccano da soli in base alle statistiche (i primi 8) o li assegna il
-- Leader. Quando uno sticker viene sbloccato arriva un avviso a tutti.
-- =====================================================================

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text unique,                       -- solo per quelli automatici
  number int not null unique,
  name text not null check (length(trim(name)) between 1 and 60),
  mission text check (mission is null or length(mission) <= 300),
  image_path text,
  created_at timestamptz not null default now()
);

create table public.player_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  awarded_by uuid references public.profiles(id) on delete set null,   -- null = sbloccato in automatico
  announced boolean not null default true,  -- false per quelli assegnati in silenzio dallo storico
  primary key (user_id, achievement_id)
);
create index player_achievements_recent on public.player_achievements (unlocked_at desc);

alter table public.achievements enable row level security;
alter table public.player_achievements enable row level security;
create policy "membri leggono" on public.achievements for select to authenticated using (is_active_member());
create policy "membri leggono" on public.player_achievements for select to authenticated using (is_active_member());
-- la missione non si legge dalla tabella: passa da achievement_missions()
grant select (id, code, number, name, image_path, created_at) on public.achievements to authenticated;
grant select on public.player_achievements to authenticated;
grant select, insert, update, delete on public.achievements, public.player_achievements to service_role;

insert into public.achievements (code, number, name, mission) values
  ('presenze_5',  1, 'Guasconi 2.0',        'Essere presente per 5 partite consecutive.'),
  ('zero_gol',    2, 'Tiro alla Beltramme', 'Restare a 0 gol in una partita.'),
  ('asso_5',      3, 'nAsso nella manica',  'Essere il giocatore con più gol nella singola partita per almeno 5 partite.'),
  ('autogol',     4, 'Bobomber',            'Fare un autogol.'),
  ('ritorno_5',   5, 'Gesù',                'Tornare presente dopo 5 assenze consecutive.'),
  ('gol_6',       6, 'Mjöllnir',            'Segnare almeno un gol per 6 partite di fila.'),
  ('sconfitte_4', 7, 'Gatto nero',          'Perdere 4 partite consecutive.'),
  ('ritiro',      8, 'Monnezza',            'Ritirarsi dopo aver dato la disponibilità.');

-- immagini degli sticker: pubbliche (come i loghi), le carica il Leader
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stickers', 'stickers', true, 1048576, array['image/png'])
on conflict (id) do nothing;
create policy "sticker: li carica il Leader" on storage.objects for insert to authenticated
  with check (bucket_id = 'stickers' and public.has_leader_powers());
create policy "sticker: li cambia il Leader" on storage.objects for update to authenticated
  using (bucket_id = 'stickers' and public.has_leader_powers());
create policy "sticker: li toglie il Leader" on storage.objects for delete to authenticated
  using (bucket_id = 'stickers' and public.has_leader_powers());

-- ---------------------------------------------------------------------
-- Missioni: il Leader le vede tutte, gli altri solo quelle degli sticker che hanno sbloccato
-- ---------------------------------------------------------------------
create or replace function public.achievement_missions() returns table (id uuid, mission text)
language sql stable security definer set search_path = public as $$
  select a.id, a.mission from achievements a
  where is_active_member()
    and (has_leader_powers()
         or exists (select 1 from player_achievements pa where pa.achievement_id = a.id and pa.user_id = auth.uid()))
$$;

-- ---------------------------------------------------------------------
-- Strumenti del Leader
-- ---------------------------------------------------------------------
create or replace function public.create_achievement(p_name text, p_mission text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader crea gli obiettivi'; end if;
  insert into achievements (number, name, mission)
  values ((select coalesce(max(number), 0) + 1 from achievements), trim(p_name), nullif(trim(coalesce(p_mission, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_achievement(p_id uuid, p_name text, p_mission text) returns void
language plpgsql security definer set search_path = public as $$
declare a achievements;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader modifica gli obiettivi'; end if;
  select * into a from achievements where id = p_id;
  if not found then raise exception 'Obiettivo non trovato'; end if;
  -- la missione dei premi automatici descrive un calcolo fisso: si cambia solo il nome
  update achievements set name = trim(p_name),
         mission = case when a.code is null then nullif(trim(coalesce(p_mission, '')), '') else mission end
  where id = p_id;
end $$;

-- restituisce l'immagine precedente, che l'app toglie dallo Storage
create or replace function public.set_achievement_image(p_id uuid, p_path text) returns text
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader carica gli sticker'; end if;
  select image_path into v_old from achievements where id = p_id;
  if not found then raise exception 'Obiettivo non trovato'; end if;
  update achievements set image_path = p_path where id = p_id;
  return v_old;
end $$;

create or replace function public.delete_achievement(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a achievements;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader elimina gli obiettivi'; end if;
  select * into a from achievements where id = p_id;
  if not found then raise exception 'Obiettivo non trovato'; end if;
  if a.code is not null then raise exception 'I premi automatici non si eliminano'; end if;
  delete from achievements where id = p_id;
  return a.image_path;
end $$;

create or replace function public.award_achievement(p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader assegna gli sticker'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Giocatore non trovato'; end if;
  insert into player_achievements (user_id, achievement_id, awarded_by) values (p_user, p_id, auth.uid())
  on conflict do nothing;
end $$;

create or replace function public.revoke_achievement(p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader toglie gli sticker'; end if;
  delete from player_achievements where achievement_id = p_id and user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Sblocco automatico: si ricalcola su tutto lo storico (pochi dati) e si
-- aggiungono solo gli sticker nuovi. Vale lo storico completo, anche prima
-- di un azzeramento delle statistiche.
-- ---------------------------------------------------------------------
create or replace function public.check_achievements() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with
  -- partite giocate dal gruppo, in ordine
  pm as (select id, starts_at, row_number() over (order by starts_at, id) as k from matches where status = 'played'),
  -- presenza di ogni giocatore a ogni partita del gruppo (da quando è iscritto)
  pres as (
    select p.id as user_id, pm.k,
           exists (select 1 from bookings b where b.match_id = pm.id and b.user_id = p.id and b.list = 'team') as here
    from profiles p cross join pm
    where p.active and pm.starts_at >= p.created_at - interval '1 day'
  ),
  pres_isl as (select user_id, k, here, k - row_number() over (partition by user_id, here order by k) as grp from pres),
  -- partite giocate da ognuno con risultato omologato: gol, autogol, esito
  pf as (
    select l.user_id, m.id as match_id, coalesce(s.goals, 0) as goals,
           case when r.diff = 0 then 'D' when (r.diff > 0) = (l.team = 'white') then 'W' else 'L' end as outcome,
           exists (select 1 from scorers x where x.match_id = m.id) as scorers_in,
           row_number() over (partition by l.user_id order by m.starts_at, m.id) as n
    from lineup l
    join matches m on m.id = l.match_id and m.status = 'played'
    join results r on r.match_id = m.id and r.status = 'homologated'
    join profiles p on p.id = l.user_id and p.active
    left join scorers s on s.match_id = m.id and s.user_id = l.user_id
  ),
  goal_isl as (select user_id, n, goals > 0 as scored, n - row_number() over (partition by user_id, goals > 0 order by n) as grp from pf),
  loss_isl as (select user_id, n, outcome = 'L' as lost, n - row_number() over (partition by user_id, outcome = 'L' order by n) as grp from pf),
  top_scorer as (
    select pf.user_id, pf.match_id from pf
    where pf.goals > 0 and pf.goals = (select max(x.goals) from pf x where x.match_id = pf.match_id)
  ),
  earned as (
    -- 1. presente per 5 partite consecutive
    select distinct user_id, 'presenze_5' as code from pres_isl where here group by user_id, grp having count(*) >= 5
    -- 2. 0 gol in una partita (con i marcatori inseriti)
    union select distinct user_id, 'zero_gol' from pf where goals = 0 and scorers_in
    -- 3. miglior marcatore della partita per almeno 5 partite
    union select user_id, 'asso_5' from top_scorer group by user_id having count(*) >= 5
    -- 4. un autogol
    union select distinct s.user_id, 'autogol' from scorers s join matches m on m.id = s.match_id and m.status = 'played'
          join profiles p on p.id = s.user_id and p.active where s.own_goals > 0
    -- 5. di nuovo presente dopo 5 assenze consecutive
    union select distinct a.user_id, 'ritorno_5' from (
            select user_id, max(k) as last_k from pres_isl where not here group by user_id, grp having count(*) >= 5
          ) a where exists (select 1 from pres p2 where p2.user_id = a.user_id and p2.k = a.last_k + 1 and p2.here)
    -- 6. almeno un gol per 6 partite di fila
    union select distinct user_id, 'gol_6' from goal_isl where scored group by user_id, grp having count(*) >= 6
    -- 7. 4 sconfitte di fila
    union select distinct user_id, 'sconfitte_4' from loss_isl where lost group by user_id, grp having count(*) >= 4
    -- 8. si ritira dopo aver dato la disponibilità
    union select distinct b.user_id, 'ritiro' from bookings b join profiles p on p.id = b.user_id and p.active where b.withdrew
  ),
  ins as (
    insert into player_achievements (user_id, achievement_id)
    select e.user_id, a.id from earned e join achievements a on a.code = e.code
    on conflict do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- si ricontrolla quando cambiano i dati che contano
create or replace function public.trg_check_achievements() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform check_achievements();
  return null;
end $$;
create trigger achievements_on_results after insert or update of status on public.results
  for each statement execute function public.trg_check_achievements();
create trigger achievements_on_scorers after insert or update or delete on public.scorers
  for each statement execute function public.trg_check_achievements();
create trigger achievements_on_bookings after update of withdrew on public.bookings
  for each statement execute function public.trg_check_achievements();
create trigger achievements_on_matches after update of status on public.matches
  for each statement execute function public.trg_check_achievements();

-- ---------------------------------------------------------------------
-- Avviso a tutti quando uno sticker viene sbloccato
-- ---------------------------------------------------------------------
create or replace function public.trg_achievement_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare a achievements;
begin
  if not new.announced then return null; end if;
  select * into a from achievements where id = new.achievement_id;
  perform notify(array(select id from profiles where active), 'achievement',
    display_name(new.user_id) || ' ha vinto il premio «' || a.name || '»',
    'Sticker n° ' || a.number || '. Scopri gli obiettivi nella Classifica.',
    '/classifica?scheda=obiettivi', null);
  return null;
end $$;
create trigger achievement_notify after insert on public.player_achievements
  for each row execute function public.trg_achievement_notify();

-- nuova voce delle preferenze: «Obiettivi sbloccati»
create or replace function public.notify_category(p_kind text) returns text
language sql immutable as $$
  select case
    when p_kind = 'chat' then 'chat'
    when p_kind in ('booking_open', 'priority_open') then 'booking_open'
    when p_kind = 'team_full' then 'team_full'
    when p_kind in ('withdrawal', 'need_one', 'late_withdrawal') then 'withdrawal'
    when p_kind = 'lineup_official' then 'lineup_official'
    when p_kind = 'lineup_change' then 'lineup_change'
    when p_kind in ('match_moved', 'venue_changed', 'match_cancelled') then 'match_changes'
    when p_kind in ('result_open', 'result_review', 'result_contested', 'result_final', 'result_homologated') then 'result'
    when p_kind = 'votes_open' then 'votes'
    when p_kind = 'achievement' then 'achievements'
  end
$$;

revoke execute on function public.create_achievement(text, text), public.update_achievement(uuid, text, text),
  public.set_achievement_image(uuid, text), public.delete_achievement(uuid), public.award_achievement(uuid, uuid),
  public.revoke_achievement(uuid, uuid), public.achievement_missions(), public.check_achievements(),
  public.trg_check_achievements(), public.trg_achievement_notify() from public, anon;
grant execute on function public.create_achievement(text, text), public.update_achievement(uuid, text, text),
  public.set_achievement_image(uuid, text), public.delete_achievement(uuid), public.award_achievement(uuid, uuid),
  public.revoke_achievement(uuid, uuid), public.achievement_missions() to authenticated;
grant execute on function public.check_achievements() to service_role;
revoke execute on function public.trg_check_achievements(), public.trg_achievement_notify() from authenticated;

-- primo controllo sullo storico già presente: in silenzio (niente centinaia di avvisi il giorno dell'aggiornamento)
alter table public.player_achievements alter column announced set default false;
select public.check_achievements();
alter table public.player_achievements alter column announced set default true;

-- ---------------------------------------------------------------------
-- Trasferimento da giocatore senza account: anche gli sticker (testo originale + una modifica mirata)
-- ---------------------------------------------------------------------
create or replace function public.merge_profiles(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g profiles;
begin
  if p_from = p_into then return; end if;
  select * into g from profiles where id = p_from;
  if not found then raise exception 'Profilo da collegare non trovato'; end if;

  -- prenotazioni, finestre, formazioni, conferme, marcatori, permessi sui voti: una riga per partita
  delete from bookings x where x.user_id = p_from and exists (select 1 from bookings y where y.user_id = p_into and y.match_id = x.match_id);
  update bookings set user_id = p_into where user_id = p_from;
  update bookings set placed_by = p_into where placed_by = p_from;
  delete from priority_windows x where x.user_id = p_from and exists (select 1 from priority_windows y where y.user_id = p_into and y.match_id = x.match_id);
  update priority_windows set user_id = p_into where user_id = p_from;
  delete from lineup x where x.user_id = p_from and exists (select 1 from lineup y where y.user_id = p_into and y.match_id = x.match_id);
  update lineup set user_id = p_into where user_id = p_from;
  delete from result_reviews x where x.user_id = p_from and exists (select 1 from result_reviews y where y.user_id = p_into and y.match_id = x.match_id);
  update result_reviews set user_id = p_into where user_id = p_from;
  delete from scorers x where x.user_id = p_from and exists (select 1 from scorers y where y.user_id = p_into and y.match_id = x.match_id);
  update scorers set user_id = p_into where user_id = p_from;
  update scorers set updated_by = p_into where updated_by = p_from;
  delete from vote_grants x where x.user_id = p_from and exists (select 1 from vote_grants y where y.user_id = p_into and y.match_id = x.match_id);
  update vote_grants set user_id = p_into where user_id = p_from;

  -- voti: niente voti a sé stessi e niente doppioni dello stesso votante
  delete from player_votes where (voter_id = p_into and target_id = p_from) or (voter_id = p_from and target_id = p_into);
  delete from player_votes x where x.target_id = p_from
    and exists (select 1 from player_votes y where y.match_id = x.match_id and y.voter_id = x.voter_id and y.target_id = p_into);
  update player_votes set target_id = p_into where target_id = p_from;
  delete from player_votes x where x.voter_id = p_from
    and exists (select 1 from player_votes y where y.match_id = x.match_id and y.voter_id = p_into and y.target_id = x.target_id);
  update player_votes set voter_id = p_into where voter_id = p_from;
  update mvp_votes set white_pick = null where voter_id = p_into and white_pick = p_from;
  update mvp_votes set black_pick = null where voter_id = p_into and black_pick = p_from;
  update mvp_votes set white_pick = p_into where white_pick = p_from;
  update mvp_votes set black_pick = p_into where black_pick = p_from;
  delete from mvp_votes x where x.voter_id = p_from and exists (select 1 from mvp_votes y where y.voter_id = p_into and y.match_id = x.match_id);
  update mvp_votes set white_pick = null where voter_id = p_from and white_pick = p_into;
  update mvp_votes set black_pick = null where voter_id = p_from and black_pick = p_into;
  update mvp_votes set voter_id = p_into where voter_id = p_from;

  -- tutto il resto
  update chat_messages set user_id = p_into where user_id = p_from;
  update notifications set user_id = p_into where user_id = p_from;
  update punishments set user_id = p_into where user_id = p_from;
  update punishments set created_by = p_into where created_by = p_from;
  update punishments set revoked_by = p_into where revoked_by = p_from;
  update matches set lineup_delegate = p_into where lineup_delegate = p_from;
  update matches set lineup_proposed_by = p_into where lineup_proposed_by = p_from;
  update results set entered_by = p_into where entered_by = p_from;
  update leadership_delegation set delegate_id = p_into where delegate_id = p_from;
  update leader_points set user_id = p_into where user_id = p_from;
  update leader_points set created_by = p_into where created_by = p_from;

  -- dati anagrafici: restano quelli dell'account, i mancanti si prendono dal profilo
  update profiles p set
    last_name = coalesce(p.last_name, g.last_name),
    nickname = coalesce(p.nickname, g.nickname),
    field_role = coalesce(p.field_role, g.field_role),
    birth_date = coalesce(p.birth_date, g.birth_date),
    weight_kg = coalesce(p.weight_kg, g.weight_kg),
    height_cm = coalesce(p.height_cm, g.height_cm),
    stats_since = coalesce(p.stats_since, g.stats_since),
    active = true, pending = false
  where p.id = p_into;

  -- sticker: si tengono quelli del giocatore senza account che l'altro non ha già (senza riannunciarli)
  insert into player_achievements (user_id, achievement_id, unlocked_at, awarded_by, announced)
  select p_into, achievement_id, unlocked_at, awarded_by, false from player_achievements where user_id = p_from
  on conflict do nothing;
  delete from player_achievements where user_id = p_from;

  delete from profiles where id = p_from;
end $$;
