-- =====================================================================
-- Rinunce in qualsiasi momento
-- Finora si registrava solo la rinuncia nelle 24 ore (late_withdrawal). Ora
-- withdrew segna ogni rinuncia: chi era in squadra e ne esce, quando che sia,
-- in entrambe le modalità di prenotazione. Le statistiche mostrano entrambe.
-- =====================================================================

alter table public.bookings add column withdrew boolean not null default false;
-- le rinunce tardive già registrate sono rinunce a tutti gli effetti
update public.bookings set withdrew = true where late_withdrawal;

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------

create or replace function public._book(
  p_actor uuid, p_user uuid, p_match uuid, p_choice text, p_system boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s app_settings;
  m matches;
  cur bookings;
  v_leader uuid := titular_leader();
  v_is_leader boolean := (p_user = v_leader);
  v_forced boolean := (p_actor is distinct from p_user) and not p_system;
  v_team_before int;
  v_team_after int;
  v_late boolean;
  v_new_list text;
  v_moved uuid;
  v_name text := display_name(p_user);
  v_url text := '/partita/' || p_match;
  v_slot int;
  v_size int;
begin
  if p_choice not in ('present','absent','reserve') then raise exception 'Scelta non valida'; end if;
  select * into s from app_settings where id = 1;

  -- blocco sulla partita: le prenotazioni concorrenti vengono serializzate
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  v_size := m.players_per_team * 2;   -- 5 contro 5 = 10 posti, 6 contro 6 = 12, ...
  if m.status <> 'scheduled' then raise exception 'Le prenotazioni per questa partita sono chiuse'; end if;
  if now() >= m.starts_at then raise exception 'La partita è già iniziata'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Utente non attivo'; end if;
  if v_forced and not has_leader_powers(p_actor) then raise exception 'Solo il Leader può prenotare per altri'; end if;
  if v_is_leader and p_choice = 'reserve' then
    raise exception 'Il Leader è sempre il numero 1: scegli presente o assente';
  end if;

  if not (p_system or v_forced or v_is_leader) and now() < m.bookings_open_at
     and not exists (select 1 from priority_windows w
                     where w.match_id = p_match and w.user_id = p_user and w.opens_at <= now()) then
    raise exception 'Le prenotazioni aprono %',
      fmt_when(m.bookings_open_at);
  end if;

  -- chiusura delle prenotazioni: dopo, cambia solo il Leader (fino all'inizio)
  if not (p_system or v_forced or v_is_leader or has_leader_powers(p_actor)) and now() >= m.bookings_close_at then
    raise exception 'Le prenotazioni si sono chiuse %. Per cambiare, scrivi al Leader.', fmt_when(m.bookings_close_at);
  end if;

  -- REQ-021: il Leader titolare ha sempre la sua riga (anche se la partita è nata prima di lui)
  if v_leader is not null and not exists (select 1 from bookings where match_id = p_match and user_id = v_leader) then
    insert into bookings (match_id, user_id, choice, list, sort_key) values (p_match, v_leader, 'present', 'team', '-infinity');
  end if;

  -- Modalità "sceglie il Leader": nessun ordine. I giocatori dicono solo se ci sono
  -- (diventano disponibili); titolari e riserve li decide il Leader.
  if m.booking_mode = 'free' then
    select * into cur from bookings where match_id = p_match and user_id = p_user;
    if p_choice = 'reserve' and not (v_forced or p_system) then
      raise exception 'In questa partita titolari e riserve li sceglie il Leader: rispondi Ci sono o Non ci sono';
    end if;
    v_new_list := case
      when p_choice = 'absent' then 'out'
      when v_is_leader then 'team'
      when v_forced then case p_choice when 'present' then 'team' else 'reserve' end
      when cur.list in ('team', 'reserve') then cur.list      -- già scelto dal Leader: resta dov'è
      else 'pending' end;
    if v_new_list = 'team' and coalesce(cur.list, '') <> 'team'
       and (select count(*) from bookings where match_id = p_match and list = 'team') >= v_size then
      raise exception 'I titolari sono già % su %: sposta prima qualcuno tra le riserve', v_size, v_size;
    end if;
    insert into bookings as b (match_id, user_id, choice, list, sort_key, placed_by, updated_at)
    values (p_match, p_user, p_choice, v_new_list, clock_timestamp(), case when v_forced then p_actor end, now())
    on conflict (match_id, user_id) do update set
      choice = excluded.choice, list = excluded.list, updated_at = now(),
      withdrew = b.withdrew or (b.list = 'team' and excluded.list <> 'team'),
      sort_key = case when b.list = excluded.list then b.sort_key else excluded.sort_key end,
      placed_by = case when v_forced then excluded.placed_by when excluded.list = 'out' then null else b.placed_by end;
    if v_new_list <> 'team' and coalesce(cur.list, '') = 'team' then
      delete from lineup where match_id = p_match and user_id = p_user;
      perform notify_lineup_change(p_match, v_name || ' non c''è più.');
    end if;
    if v_forced then
      perform notify(array[p_user], 'placed_by_leader', 'Il Leader ha aggiornato la tua presenza',
        case v_new_list when 'team' then 'Sei titolare' when 'reserve' then 'Sei tra le riserve' else 'Sei segnato assente' end
          || ' per ' || fmt_when(m.starts_at) || '.', v_url, p_match);
    end if;
    return jsonb_build_object('list', v_new_list, 'slot', null);
  end if;

  select * into cur from bookings where match_id = p_match and user_id = p_user;
  select count(*) into v_team_before from bookings where match_id = p_match and list = 'team';
  v_late := now() > m.starts_at - interval '24 hours';

  -- dove finisce l'utente
  if p_choice = 'present' then
    if cur.list = 'team' or v_team_before < v_size or v_is_leader or v_forced then
      v_new_list := 'team';           -- REQ-017: se c'è posto entra subito
    else
      v_new_list := 'reserve';        -- REQ-014: oltre i 10 si scala tra le riserve
    end if;
  elsif p_choice = 'reserve' then
    v_new_list := 'reserve';          -- REQ-013
  else
    v_new_list := 'out';
  end if;

  insert into bookings as b (match_id, user_id, choice, list, sort_key, placed_by, updated_at)
  values (p_match, p_user, p_choice, v_new_list, clock_timestamp(),
          case when v_forced then p_actor end, now())
  on conflict (match_id, user_id) do update set
    choice     = excluded.choice,
    list       = excluded.list,
    -- chi resta nella stessa lista mantiene la posizione; chi cambia lista va in coda
    sort_key   = case when b.list = excluded.list then b.sort_key else excluded.sort_key end,
    placed_by  = case when v_forced then excluded.placed_by
                      when excluded.list = 'out' then null else b.placed_by end,
    late_withdrawal = b.late_withdrawal or (v_late and b.list = 'team' and excluded.list <> 'team'),
    withdrew        = b.withdrew or (b.list = 'team' and excluded.list <> 'team'),   -- rinuncia in qualsiasi momento
    reserve_reply   = case when excluded.list = 'reserve' then b.reserve_reply end,
    updated_at = now();

  -- troppi in squadra (Leader che rientra o inserimento forzato):
  -- l'ultimo arrivato non "protetto" scende in testa alle riserve
  while (select count(*) from bookings where match_id = p_match and list = 'team') > v_size loop
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'team' and user_id is distinct from v_leader and user_id <> p_user
    order by (placed_by is not null), sort_key desc
    limit 1;
    exit when v_moved is null;
    update bookings
       set list = 'reserve', updated_at = now(),
           sort_key = coalesce((select min(sort_key) from bookings where match_id = p_match and list = 'reserve'),
                               clock_timestamp()) - interval '1 millisecond'
     where match_id = p_match and user_id = v_moved;
    perform notify(array[v_moved], 'demoted', 'Sei passato tra le riserve',
                   'Sei il primo della lista: se si libera un posto entri tu.', v_url, p_match);
    perform notify_lineup_change(p_match, display_name(v_moved) || ' è passato tra le riserve.');
    delete from lineup where match_id = p_match and user_id = v_moved;
    v_moved := null;
  end loop;

  -- REQ-016: chi esce dalla squadra libera il posto e le riserve scalano
  if cur.list = 'team' and v_new_list <> 'team' then
    delete from lineup where match_id = p_match and user_id = p_user;
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'reserve' and user_id <> p_user
    order by sort_key limit 1;
    if v_moved is not null then
      update bookings set list = 'team', sort_key = clock_timestamp(), updated_at = now()
       where match_id = p_match and user_id = v_moved;
      perform notify(array[v_moved], 'promoted', 'Sei dentro!',
                     'Si è liberato un posto: sei in squadra.', v_url, p_match);
      perform notify_lineup_change(p_match,
        v_name || ' non c''è più, entra ' || display_name(v_moved) || '.');
    else
      perform notify_lineup_change(p_match, v_name || ' non c''è più.');
    end if;
  elsif v_new_list = 'team' and cur.list is distinct from 'team' then
    perform notify_lineup_change(p_match, v_name || ' entra in squadra.');
  end if;

  -- chi si è dichiarato presente ma è in riserva entra se c'è spazio
  loop
    exit when (select count(*) from bookings where match_id = p_match and list = 'team') >= v_size;
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'reserve' and choice = 'present'
    order by sort_key limit 1;
    exit when v_moved is null;
    update bookings set list = 'team', sort_key = clock_timestamp(), updated_at = now()
     where match_id = p_match and user_id = v_moved;
    perform notify(array[v_moved], 'promoted', 'Sei dentro!', 'Si è liberato un posto: sei in squadra.', v_url, p_match);
    v_moved := null;
  end loop;

  select count(*) into v_team_after from bookings where match_id = p_match and list = 'team';

  -- REQ-018: rinuncia nelle 24 ore, avvisati Leader e Premier
  if v_late and cur.list = 'team' and v_new_list <> 'team' then
    perform notify(staff_ids(), 'late_withdrawal', 'Rinuncia dell''ultimo momento',
                   v_name || ' ha dato forfait a meno di 24 ore dalla partita.', v_url, p_match);
  end if;

  -- REQ-019: si scende a 9, avviso speciale a chi non è in squadra (e allo staff)
  if v_team_before >= v_size and v_team_after = v_size - 1 then
    perform notify(
      array_remove(
        array(select id from profiles where active
                and id not in (select user_id from bookings where match_id = p_match and list = 'team'))
        || staff_ids(), p_user),
      'need_one', 'Manca un giocatore!',
      'Siamo in ' || v_team_after || ' per ' ||
        fmt_when(m.starts_at) || '. Ti unisci?',
      v_url, p_match,
      '[{"action":"present","title":"Ci sono"}]'::jsonb);
  end if;

  select slot into v_slot from booking_board where match_id = p_match and user_id = p_user;
  return jsonb_build_object(
    'list', (select list from bookings where match_id = p_match and user_id = p_user),
    'slot', v_slot);
end $$;

-- le colonne restituite cambiano: vanno ricreate
drop function public.stats_table(timestamptz, timestamptz);
drop function public.attendance_register(timestamptz, timestamptz);

create or replace function public.stats_table(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns table (
  user_id uuid, played int, wins int, draws int, losses int, points int, points_per_game numeric, win_pct numeric,
  goals int, goals_per_game numeric, assists int, own_goals int,
  team_goals_for int, team_goals_against int, team_goal_diff int,
  avg_vote numeric, best_avg_vote numeric, worst_avg_vote numeric, mvp_count int,
  current_form text,
  cur_win_streak int, best_win_streak int,
  cur_unbeaten int, best_unbeaten int,
  cur_loss_streak int, worst_loss_streak int,
  cur_winless int, worst_winless int,
  attendances int, late_withdrawals int, withdrawals int
)
language sql stable security definer set search_path = public as $$
  with f as (
    select * from player_match_facts(p_from, p_to)
  ),
  ordered as (
    select f.*, row_number() over (partition by f.user_id order by f.starts_at) as rn,
           row_number() over (partition by f.user_id order by f.starts_at desc) as rn_desc
    from f
  ),
  -- isole consecutive per ciascun tipo di serie
  flags as (
    select o.*,
      (outcome = 'W') as is_w, (outcome <> 'L') as is_unb, (outcome = 'L') as is_l, (outcome <> 'W') as is_wl
    from ordered o
  ),
  islands as (
    select user_id, rn, rn_desc, kind, ok,
           rn - row_number() over (partition by user_id, kind, ok order by rn) as grp
    from flags
    cross join lateral (values ('w', is_w), ('unb', is_unb), ('l', is_l), ('wl', is_wl)) k(kind, ok)
  ),
  runs as (
    select user_id, kind, count(*) as len, min(rn_desc) as last_desc
    from islands where ok
    group by user_id, kind, grp
  ),
  streaks as (
    select user_id,
      max(len) filter (where kind = 'w')   as best_w,
      max(len) filter (where kind = 'w'   and last_desc = 1) as cur_w,
      max(len) filter (where kind = 'unb') as best_unb,
      max(len) filter (where kind = 'unb' and last_desc = 1) as cur_unb,
      max(len) filter (where kind = 'l')   as worst_l,
      max(len) filter (where kind = 'l'   and last_desc = 1) as cur_l,
      max(len) filter (where kind = 'wl')  as worst_wl,
      max(len) filter (where kind = 'wl'  and last_desc = 1) as cur_wl
    from runs group by user_id
  ),
  agg as (
    select user_id,
      count(*)::int as played,
      count(*) filter (where outcome = 'W')::int as wins,
      count(*) filter (where outcome = 'D')::int as draws,
      count(*) filter (where outcome = 'L')::int as losses,
      sum(goals)::int as goals, sum(assists)::int as assists, sum(own_goals)::int as own_goals,
      sum(team_goals)::int as gf, sum(opp_goals)::int as ga,
      round(avg(avg_vote), 2) as avg_vote, max(avg_vote) as best_vote, min(avg_vote) as worst_vote,
      count(*) filter (where is_mvp)::int as mvp,
      string_agg(outcome, '' order by starts_at desc) filter (where rn_desc <= 5) as form
    from ordered group by user_id
  ),
  presence as (
    select b.user_id,
      count(*) filter (where b.list = 'team')::int as att,
      count(*) filter (where b.late_withdrawal)::int as late,
      count(*) filter (where b.withdrew)::int as wd
    from bookings b join matches m on m.id = b.match_id
    join profiles pp on pp.id = b.user_id
    where m.status = 'played' and m.starts_at >= p_from and m.starts_at < p_to
      and m.starts_at >= coalesce(greatest((select stats_since from app_settings where id = 1), pp.stats_since), '-infinity'::timestamptz)
    group by b.user_id
  )
  select p.id,
    coalesce(a.played, 0), coalesce(a.wins, 0), coalesce(a.draws, 0), coalesce(a.losses, 0),
    coalesce(a.wins * 3 + a.draws, 0),
    case when a.played > 0 then round((a.wins * 3 + a.draws)::numeric / a.played, 2) end,
    case when a.played > 0 then round(100.0 * a.wins / a.played, 1) end,
    coalesce(a.goals, 0),
    case when a.played > 0 then round(a.goals::numeric / a.played, 2) end,
    coalesce(a.assists, 0), coalesce(a.own_goals, 0),
    a.gf, a.ga, case when a.gf is not null then a.gf - a.ga end,
    a.avg_vote, round(a.best_vote, 2), round(a.worst_vote, 2), coalesce(a.mvp, 0),
    a.form,
    coalesce(s.cur_w, 0)::int, coalesce(s.best_w, 0)::int,
    coalesce(s.cur_unb, 0)::int, coalesce(s.best_unb, 0)::int,
    coalesce(s.cur_l, 0)::int, coalesce(s.worst_l, 0)::int,
    coalesce(s.cur_wl, 0)::int, coalesce(s.worst_wl, 0)::int,
    coalesce(pr.att, 0), coalesce(pr.late, 0), coalesce(pr.wd, 0)
  from profiles p
  left join agg a on a.user_id = p.id
  left join streaks s on s.user_id = p.id
  left join presence pr on pr.user_id = p.id
  where auth.uid() is not null
    and (p.active or a.played > 0)
    and not p.pending
$$;

create or replace function public.attendance_register(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns table (match_id uuid, starts_at timestamptz, user_id uuid, choice text, list text, late_withdrawal boolean, withdrew boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.starts_at, b.user_id, b.choice, b.list, b.late_withdrawal, b.withdrew
  from matches m join bookings b on b.match_id = m.id
  join profiles pp on pp.id = b.user_id
  where auth.uid() is not null and m.status = 'played' and m.starts_at >= p_from and m.starts_at < p_to
    and m.starts_at >= coalesce(greatest((select stats_since from app_settings where id = 1), pp.stats_since), '-infinity'::timestamptz)
  order by m.starts_at desc
$$;

revoke execute on function public.stats_table(timestamptz, timestamptz), public.attendance_register(timestamptz, timestamptz) from public, anon;
grant execute on function public.stats_table(timestamptz, timestamptz), public.attendance_register(timestamptz, timestamptz) to authenticated;
