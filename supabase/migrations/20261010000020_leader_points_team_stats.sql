-- =====================================================================
-- Punti Leader e nuove statistiche
--  * Punti Leader: il Leader (o chi ne fa le veci) assegna o toglie da -99 a +99
--    punti alla volta, con una motivazione. Classifica e storico visibili a tutti.
--    Sono indipendenti dalle partite e dall'azzeramento delle statistiche.
--  * Squadre: vittorie per colore della divisa (di squadra e di ogni giocatore).
--  * Coppie: partite e vittorie da compagni e da avversari per ogni coppia.
-- Le statistiche di squadra e di coppia partono da player_match_facts, quindi
-- rispettano periodo, risultati omologati e azzeramento come la classifica.
-- =====================================================================

create table public.leader_points (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  points      smallint not null check (points between -99 and 99 and points <> 0),
  reason      text not null check (char_length(trim(reason)) between 1 and 200),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index leader_points_user on public.leader_points (user_id);

alter table public.leader_points enable row level security;
grant select on public.leader_points to authenticated;
create policy "punti leader: li vedono tutti i membri" on public.leader_points for select to authenticated
  using (public.is_active_member());

create or replace function public.award_leader_points(p_user uuid, p_points int, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not has_leader_powers() then raise exception 'Solo il Leader assegna i punti Leader'; end if;
  if p_points is null or p_points = 0 or p_points not between -99 and 99 then
    raise exception 'I punti vanno da -99 a +99, zero escluso';
  end if;
  if v_reason = '' then raise exception 'Scrivi la motivazione'; end if;
  if char_length(v_reason) > 200 then raise exception 'Motivazione troppo lunga (al massimo 200 caratteri)'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Giocatore non trovato'; end if;
  insert into leader_points (user_id, points, reason, created_by)
  values (p_user, p_points, v_reason, auth.uid()) returning id into v_id;
  perform notify(array[p_user], 'leader_points',
    case when p_points > 0 then '+' else '' end || p_points || ' punti Leader',
    v_reason, '/classifica?scheda=punti');
  return v_id;
end $$;

create or replace function public.delete_leader_points(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può annullare i punti Leader'; end if;
  delete from leader_points where id = p_id;
  if not found then raise exception 'Assegnazione non trovata'; end if;
end $$;

-- Classifica dei punti Leader (di sempre)
create or replace function public.leader_points_table()
returns table (user_id uuid, total int, awards int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select lp.user_id, sum(lp.points)::int, count(*)::int, max(lp.created_at)
  from leader_points lp
  where is_active_member()
  group by lp.user_id
  order by 2 desc, 4 desc
$$;

-- ---------------------------------------------------------------------
-- Vittorie per colore della divisa, di squadra
-- ---------------------------------------------------------------------
create or replace function public.team_kit_stats(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns table (kit text, played int, wins int, draws int, losses int, goals_for int, goals_against int)
language sql stable security definer set search_path = public as $$
  with ms as (
    select m.team_a_kit, m.team_b_kit, r.diff, r.white_goals, r.black_goals
    from matches m join results r on r.match_id = m.id and r.status = 'homologated'
    where auth.uid() is not null and m.status <> 'cancelled'
      and m.starts_at >= p_from and m.starts_at < p_to
      and m.starts_at >= coalesce((select stats_since from app_settings where id = 1), '-infinity'::timestamptz)
  ),
  sides as (
    select team_a_kit as kit, sign(diff) as s, coalesce(white_goals, greatest(diff, 0)) as gf, coalesce(black_goals, greatest(-diff, 0)) as ga from ms
    union all
    select team_b_kit, -sign(diff), coalesce(black_goals, greatest(-diff, 0)), coalesce(white_goals, greatest(diff, 0)) from ms
  )
  select kit, count(*)::int, count(*) filter (where s > 0)::int, count(*) filter (where s = 0)::int,
         count(*) filter (where s < 0)::int, sum(gf)::int, sum(ga)::int
  from sides group by kit order by 3 desc, 2 desc
$$;

-- Bilancio di ogni giocatore con ciascun colore
create or replace function public.player_kit_stats(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns table (user_id uuid, kit text, played int, wins int, draws int, losses int)
language sql stable security definer set search_path = public as $$
  select f.user_id, case f.team when 'white' then m.team_a_kit else m.team_b_kit end,
         count(*)::int, count(*) filter (where f.outcome = 'W')::int,
         count(*) filter (where f.outcome = 'D')::int, count(*) filter (where f.outcome = 'L')::int
  from player_match_facts(p_from, p_to) f join matches m on m.id = f.match_id
  where auth.uid() is not null
  group by 1, 2
$$;

-- ---------------------------------------------------------------------
-- Coppie: una riga per ogni coppia di giocatori che si è incontrata (a_id < b_id)
-- ---------------------------------------------------------------------
create or replace function public.pair_stats(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns table (a_id uuid, b_id uuid,
               together int, together_wins int, together_draws int,
               against int, a_wins int, b_wins int, against_draws int)
language sql stable security definer set search_path = public as $$
  with f as (select match_id, user_id, team, outcome from player_match_facts(p_from, p_to))
  select a.user_id, b.user_id,
    count(*) filter (where a.team = b.team)::int,
    count(*) filter (where a.team = b.team and a.outcome = 'W')::int,
    count(*) filter (where a.team = b.team and a.outcome = 'D')::int,
    count(*) filter (where a.team <> b.team)::int,
    count(*) filter (where a.team <> b.team and a.outcome = 'W')::int,
    count(*) filter (where a.team <> b.team and b.outcome = 'W')::int,
    count(*) filter (where a.team <> b.team and a.outcome = 'D')::int
  from f a join f b on a.match_id = b.match_id and a.user_id < b.user_id
  where auth.uid() is not null
  group by a.user_id, b.user_id
$$;

-- ---------------------------------------------------------------------
-- I punti Leader seguono il giocatore quando si collega un account (testo originale con una modifica mirata)
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

  delete from profiles where id = p_from;
end $$;

revoke execute on function public.award_leader_points(uuid, int, text), public.delete_leader_points(bigint),
  public.leader_points_table(), public.team_kit_stats(timestamptz, timestamptz), public.player_kit_stats(timestamptz, timestamptz),
  public.pair_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.award_leader_points(uuid, int, text), public.delete_leader_points(bigint),
  public.leader_points_table(), public.team_kit_stats(timestamptz, timestamptz), public.player_kit_stats(timestamptz, timestamptz),
  public.pair_stats(timestamptz, timestamptz) to authenticated;
revoke execute on function public.merge_profiles(uuid, uuid) from public, anon, authenticated;
