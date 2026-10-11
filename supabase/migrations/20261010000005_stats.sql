-- =====================================================================
-- Statistiche (REQ-047, REQ-048)
-- Conta solo le partite con risultato omologato e formazione con i colori.
-- =====================================================================

-- Una riga per giocatore per partita
create or replace function public.player_match_facts(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns table (
  match_id uuid, starts_at timestamptz, user_id uuid, team text, outcome text,
  team_goals int, opp_goals int, diff int,
  goals int, assists int, own_goals int,
  avg_vote numeric, is_mvp boolean
)
language sql stable security definer set search_path = public as $$
  with ms as (
    select m.id, m.starts_at, r.diff, r.white_goals, r.black_goals
    from matches m join results r on r.match_id = m.id and r.status = 'homologated'
    where m.status <> 'cancelled' and m.starts_at >= p_from and m.starts_at < p_to
  ),
  voters as (
    select x.match_id, count(distinct x.voter_id) as n from (
      select match_id, voter_id from player_votes union select match_id, voter_id from mvp_votes) x
    join ms on ms.id = x.match_id group by x.match_id
  ),
  avgs as (
    select v.match_id, v.target_id, avg(v.score) as a
    from player_votes v join voters vc on vc.match_id = v.match_id
    where vc.n >= (select vote_min_voters from app_settings where id = 1)
    group by v.match_id, v.target_id
  ),
  mvp as (
    select ms.id as match_id, p.pick, p.team, count(*) as c
    from ms cross join lateral mvp_picks(ms.id) p
    where p.pick is not null
    group by ms.id, p.pick, p.team
  ),
  mvp_top as (
    select match_id, pick from (
      select match_id, pick, c, max(c) over (partition by match_id, team) as mx from mvp) x
    where c = mx
  )
  select ms.id, ms.starts_at, l.user_id, l.team,
         case when ms.diff = 0 then 'D'
              when (ms.diff > 0) = (l.team = 'white') then 'W' else 'L' end,
         case l.team when 'white' then ms.white_goals else ms.black_goals end,
         case l.team when 'white' then ms.black_goals else ms.white_goals end,
         case l.team when 'white' then ms.diff else -ms.diff end,
         coalesce(s.goals, 0), coalesce(s.assists, 0), coalesce(s.own_goals, 0),
         round(a.a, 2),
         exists (select 1 from mvp_top t where t.match_id = ms.id and t.pick = l.user_id)
  from ms
  join lineup l on l.match_id = ms.id
  left join scorers s on s.match_id = ms.id and s.user_id = l.user_id
  left join avgs a on a.match_id = ms.id and a.target_id = l.user_id
$$;

-- Classifica: una riga per utente, una colonna per statistica
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
  attendances int, late_withdrawals int
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
      count(*) filter (where b.late_withdrawal)::int as late
    from bookings b join matches m on m.id = b.match_id
    where m.status = 'played' and m.starts_at >= p_from and m.starts_at < p_to
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
    coalesce(pr.att, 0), coalesce(pr.late, 0)
  from profiles p
  left join agg a on a.user_id = p.id
  left join streaks s on s.user_id = p.id
  left join presence pr on pr.user_id = p.id
  where auth.uid() is not null
    and (p.active or a.played > 0)
    and not p.pending
$$;

-- Registro presenze: una riga per partita giocata e per utente coinvolto
create or replace function public.attendance_register(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns table (match_id uuid, starts_at timestamptz, user_id uuid, choice text, list text, late_withdrawal boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.starts_at, b.user_id, b.choice, b.list, b.late_withdrawal
  from matches m join bookings b on b.match_id = m.id
  where auth.uid() is not null and m.status = 'played' and m.starts_at >= p_from and m.starts_at < p_to
  order by m.starts_at desc
$$;

-- Storico partite di un giocatore
create or replace function public.player_history(p_user uuid, p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns setof jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(f) from player_match_facts(p_from, p_to) f
  where auth.uid() is not null and f.user_id = p_user
  order by f.starts_at desc
$$;
