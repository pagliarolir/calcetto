-- =====================================================================
-- Pagelle: le medie si vedono sempre, anche con un solo votante.
-- La soglia vote_min_voters resta, ma solo per decidere se la media di una
-- partita conta nelle statistiche di classifica (player_match_facts).
-- =====================================================================

create or replace function public.vote_summary(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_voters int;
  v_min int;
  v_result jsonb;
begin
  select vote_min_voters into v_min from app_settings where id = 1;
  select count(distinct voter_id) into v_voters from (
    select voter_id from player_votes where match_id = p_match
    union select voter_id from mvp_votes where match_id = p_match) x;

  -- le medie si vedono sempre, anche con pochi votanti (la soglia vale solo per la classifica)

  with avgs as (
    select target_id as user_id, round(avg(score), 2) as avg_score, count(*) as votes
    from player_votes where match_id = p_match group by target_id
  ),
  mvp as (
    select pick as user_id, team, count(*) as mvp_votes from mvp_picks(p_match) where pick is not null group by pick, team
  ),
  mvp_top as (
    select user_id, mvp_votes, mvp_votes = max(mvp_votes) over (partition by team) as is_mvp from mvp
  )
  select jsonb_agg(jsonb_build_object(
           'user_id', b.user_id, 'avg', a.avg_score, 'votes', coalesce(a.votes, 0),
           'mvp_votes', coalesce(t.mvp_votes, 0), 'is_mvp', coalesce(t.is_mvp, false))
         order by a.avg_score desc nulls last)
  into v_result
  from bookings b
  left join avgs a on a.user_id = b.user_id
  left join mvp_top t on t.user_id = b.user_id
  where b.match_id = p_match and b.list = 'team';

  return jsonb_build_object('voters', v_voters, 'threshold', v_min, 'players', coalesce(v_result, '[]'::jsonb),
                            'my_votes_done', exists (select 1 from player_votes where match_id = p_match and voter_id = auth.uid()));
end $$;
