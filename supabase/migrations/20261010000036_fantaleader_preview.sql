-- =====================================================================
-- FantaLeader in anteprima: lo vedono solo il Leader e un elenco di persone
-- (all'inizio il giocatore con soprannome «Bobbo»). Il Leader può cambiare
-- l'elenco o aprirlo a tutti. Vale lato server: chi non è ammesso non legge
-- i dati del fantagioco e non può creare una fantasquadra.
-- =====================================================================

alter table public.fl_settings add column public boolean not null default false;
alter table public.fl_settings add column preview_users uuid[] not null default '{}';
update public.fl_settings set preview_users = coalesce(
  (select array_agg(id) from public.profiles where active and lower(trim(nickname)) = 'bobbo'), '{}') where id = 1;

create or replace function public.fl_can_see(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_active_member(p_uid) and (
           has_leader_powers(p_uid)
           or exists (select 1 from fl_settings where id = 1 and (public or p_uid = any (preview_users)))), false)
$$;
revoke execute on function public.fl_can_see(uuid) from public, anon;
grant execute on function public.fl_can_see(uuid) to authenticated;

-- l'app chiede se mostrare la sezione
create or replace function public.fl_visible() returns boolean
language sql stable security definer set search_path = public as $$ select fl_can_see() $$;
revoke execute on function public.fl_visible() from public, anon;
grant execute on function public.fl_visible() to authenticated;

-- il Leader decide chi vede FantaLeader
create or replace function public.fl_set_visibility(p_public boolean, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fl_require_leader();
  update fl_settings set public = coalesce(p_public, false),
    preview_users = coalesce((select array_agg(distinct u) from unnest(coalesce(p_users, '{}')) u
                              where exists (select 1 from profiles p where p.id = u and p.active)), '{}')
  where id = 1;
  perform fl_log('visibilità cambiata', jsonb_build_object('public', p_public, 'users', p_users));
end $$;
revoke execute on function public.fl_set_visibility(boolean, uuid[]) from public, anon;
grant execute on function public.fl_set_visibility(boolean, uuid[]) to authenticated;

-- letture: solo chi può vedere FantaLeader
do $$ declare t text; begin
  foreach t in array array['fl_settings','fl_presets','fl_players','fl_price_history','fl_skills','fl_player_skills',
                           'fl_teams','fl_team_versions','fl_coefficients','fl_points','fl_points_revisions'] loop
    execute format('drop policy "membri leggono" on public.%I', t);
    execute format('create policy "chi vede FantaLeader legge" on public.%I for select to authenticated using (fl_can_see())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------
create or replace function public.fl_current_price(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  st fl_settings; pl fl_players; n int; mine numeric; allavg numeric; rel numeric;
begin
  if auth.uid() is not null and not fl_can_see() then return null; end if;
  select * into st from fl_settings where id = 1;
  select * into pl from fl_players where user_id = p_user;
  if pl is null then return null; end if;
  select count(*), avg(p.total) into n, mine
  from fl_points p join matches m on m.id = p.match_id
  where p.user_id = p_user and p.played and p.status = 'final' and m.starts_at > st.prices_since;
  if n < (st.params ->> 'price_min_played')::int then return pl.price_initial; end if;
  select avg(p.total) into allavg
  from fl_points p join matches m on m.id = p.match_id join fl_players f on f.user_id = p.user_id and f.eligible
  where p.played and p.status = 'final' and m.starts_at > st.prices_since;
  if allavg is null or abs(allavg) < 0.01 then return pl.price_initial; end if;
  rel := (mine - allavg) / abs(allavg) * (st.params ->> 'price_k')::numeric;
  rel := greatest(-(st.params ->> 'price_cap')::numeric, least((st.params ->> 'price_cap')::numeric, rel));
  return greatest((st.params ->> 'price_min')::int, round(pl.price_initial * (1 + rel))::int);
end $$;

create or replace function public.fl_player_ranking()
returns table (user_id uuid, pos int, total numeric, provisional numeric, last_points numeric, played int,
               price_initial int, price_current int, next_coef numeric)
language sql stable security definer set search_path = public as $$
  with t as (
    select f.user_id, f.price_initial,
           coalesce(sum(p.total), 0) as total,
           coalesce(sum(p.total) filter (where p.status = 'provisional'), 0) as provisional,
           count(*) filter (where p.played)::int as played,
           (select p2.total from fl_points p2 join matches m2 on m2.id = p2.match_id where p2.user_id = f.user_id order by m2.starts_at desc limit 1) as last_points,
           coalesce(sum(p.total) filter (where p.status = 'final'), 0) as final_total
    from fl_players f left join fl_points p on p.user_id = f.user_id
    where f.eligible
    group by f.user_id, f.price_initial
  ), ranked as (
    select t.*, rank() over (order by t.total desc)::int as pos,
           rank() over (order by t.final_total desc)::int as final_pos,
           exists (select 1 from fl_points where status = 'final') as any_final
    from t
  )
  select user_id, pos, total, provisional, last_points, played, price_initial, fl_current_price(user_id),
         case when not any_final then (fl_param('coef_first'))::text::numeric
              else coalesce((select (b ->> 1)::numeric from jsonb_array_elements(fl_param('coef_bands')) b
                             where b ->> 0 is null or final_pos <= (b ->> 0)::int order by (b ->> 0)::int nulls last limit 1), 1) end
  from ranked
  where fl_can_see()
  order by pos, user_id;
$$;

create or replace function public.fl_team_match_points()
returns table (team_id uuid, match_id uuid, starts_at timestamptz, points numeric, captain_points numeric, provisional boolean)
language sql stable security definer set search_path = public as $$
  with v as (
    select tv.*, t.created_at as team_created from fl_team_versions tv join fl_teams t on t.id = tv.team_id
  ), cells as (
    select v.team_id, m.id as match_id, m.starts_at, v.captain_id, v.members, v.created_at as version_created,
           (m.starts_at < v.team_created) as retro
    from v join matches m on m.starts_at >= v.valid_from and (v.valid_to is null or m.starts_at < v.valid_to)
    where exists (select 1 from fl_points p where p.match_id = m.id)
  ), per_member as (
    select c.team_id, c.match_id, c.starts_at, mem as user_id, c.captain_id,
           p.status,
           -- nuove fantasquadre: punti passati senza coefficiente e senza bonus del capitano
           case when c.retro then p.pre else p.total end
           * case when not c.retro and mem <> c.captain_id and cp.played and cp.won then (fl_param('captain_bonus'))::text::numeric else 1 end as pts,
           (select coalesce(sum((e ->> 'amount')::numeric * case when e ->> 'to' = 'all' then cardinality(c.members) else cardinality(c.members) - 1 end), 0)
              from jsonb_array_elements(p.fanta) e) as fanta_pts
    from cells c
    cross join lateral unnest(c.members) mem
    join fl_points p on p.match_id = c.match_id and p.user_id = mem
    left join fl_points cp on cp.match_id = c.match_id and cp.user_id = c.captain_id
  )
  select team_id, match_id, starts_at,
         round(sum(pts + fanta_pts), 2),
         round(sum(pts) filter (where user_id = captain_id), 2),
         bool_or(status = 'provisional')
  from per_member
  where fl_can_see()
  group by team_id, match_id, starts_at;
$$;

create or replace function public.fl_team_ranking()
returns table (team_id uuid, pos int, name text, owner_id uuid, total numeric, last_points numeric, captain_id uuid,
               members uuid[], spent int, captain_points numeric, has_leader boolean, owner_points numeric, provisional boolean)
language sql stable security definer set search_path = public as $$
  with tm as (select * from fl_team_match_points()),
  agg as (
    select t.id, t.name, t.owner_id, v.captain_id, v.members, v.spent,
           coalesce((select sum(points) from tm where tm.team_id = t.id), 0) as total,
           (select points from tm where tm.team_id = t.id order by starts_at desc limit 1) as last_points,
           coalesce((select sum(captain_points) from tm where tm.team_id = t.id), 0) as captain_points,
           exists (select 1 from profiles p where p.id = any (v.members) and p.role = 'leader') as has_leader,
           coalesce((select sum(total) from fl_points p where p.user_id = t.owner_id), 0) as owner_points,
           coalesce((select bool_or(provisional) from tm where tm.team_id = t.id), false) as provisional
    from fl_teams t join fl_team_versions v on v.team_id = t.id and v.valid_to is null
  )
  select id, rank() over (order by total desc, captain_points desc, has_leader desc, owner_points desc)::int,
         name, owner_id, total, last_points, captain_id, members, spent, captain_points, has_leader, owner_points, provisional
  from agg
  where fl_can_see()
  order by 2, name;
$$;

create or replace function public.fl_confirm_team(p_name text, p_members uuid[], p_captain uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st fl_settings; me uuid := auth.uid(); v_team fl_teams; v_prices int[]; v_spent int; v_has boolean; u uuid;
begin
  select * into st from fl_settings where id = 1;
  if me is null or not is_active_member(me) or exists (select 1 from profiles where id = me and guest) then
    raise exception 'Per partecipare serve il tuo account';
  end if;
  if not fl_can_see(me) then raise exception 'FantaLeader non è ancora aperto a tutti'; end if;
  if not st.market_open then raise exception 'Il mercato è chiuso: le squadre si creano e si cambiano solo quando lo apre il Leader'; end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 40 then raise exception 'Dai un nome alla tua fantasquadra (da 2 a 40 caratteri)'; end if;
  if p_members is null or cardinality(p_members) <> st.team_size then
    raise exception 'La fantasquadra deve avere esattamente % giocatori', st.team_size;
  end if;
  if (select count(distinct x) from unnest(p_members) x) <> cardinality(p_members) then raise exception 'Lo stesso giocatore non può essere scelto due volte'; end if;
  foreach u in array p_members loop
    if not exists (select 1 from fl_players where user_id = u and eligible) then raise exception 'Giocatore non disponibile nel FantaLeader'; end if;
  end loop;
  if p_captain is null or not (p_captain = any (p_members)) then raise exception 'Il capitano deve essere uno dei % giocatori', st.team_size; end if;
  -- si paga la quotazione attuale (alla prima apertura coincide con l'iniziale)
  select array_agg(fl_current_price(x) order by o), sum(fl_current_price(x)) into v_prices, v_spent
  from unnest(p_members) with ordinality as a(x, o);
  if v_spent > st.budget then raise exception 'Hai superato il budget: % euroLeader su %', v_spent, st.budget; end if;

  select * into v_team from fl_teams where owner_id = me for update;
  v_has := v_team is not null;
  if not v_has then
    insert into fl_teams (owner_id, name) values (me, trim(p_name)) returning * into v_team;
  else
    update fl_teams set name = trim(p_name), updated_at = now() where id = v_team.id;
    update fl_team_versions set valid_to = now() where team_id = v_team.id and valid_to is null;
  end if;
  insert into fl_team_versions (team_id, valid_from, captain_id, members, prices, spent)
  values (v_team.id, case when v_has then now() else '-infinity'::timestamptz end, p_captain, p_members, v_prices, v_spent);
  perform fl_log('squadra confermata', jsonb_build_object('team', v_team.id, 'name', trim(p_name), 'members', p_members, 'captain', p_captain, 'spent', v_spent));
  return jsonb_build_object('team_id', v_team.id, 'spent', v_spent, 'left', st.budget - v_spent);
end $$;
