-- FantaLeader in una chiamata: quello che l'app scaricava con 10 letture separate (core/fantaleader.ts, load()).
-- SECURITY INVOKER: valgono le stesse regole (RLS e fl_can_see) delle letture separate; chi non vede
-- il FantaLeader riceve null.

create or replace function public.fl_bundle()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case when fl_can_see() then jsonb_build_object(
    'settings',      (select to_jsonb(s) from fl_settings s where s.id = 1),
    'players',       coalesce((select jsonb_agg(to_jsonb(p)) from fl_players p), '[]'::jsonb),
    'ranking',       coalesce((select jsonb_agg(to_jsonb(r)) from fl_player_ranking() r), '[]'::jsonb),
    'presets',       coalesce((select jsonb_agg(to_jsonb(p) order by p.sort) from fl_presets p), '[]'::jsonb),
    'skills',        coalesce((select jsonb_agg(to_jsonb(k) order by k.id) from fl_skills k), '[]'::jsonb),
    'player_skills', coalesce((select jsonb_agg(to_jsonb(x)) from fl_player_skills x), '[]'::jsonb),
    'teams',         coalesce((select jsonb_agg(to_jsonb(t)) from fl_team_ranking() t), '[]'::jsonb),
    'team_matches',  coalesce((select jsonb_agg(to_jsonb(t)) from fl_team_match_points() t), '[]'::jsonb),
    'my_version',    (select to_jsonb(v) from fl_teams t join fl_team_versions v on v.team_id = t.id
                      where t.owner_id = auth.uid() and v.valid_to is null limit 1),
    'last_round',    (select to_jsonb(l) from fl_last_round() l limit 1)
  ) end
$$;

revoke execute on function public.fl_bundle() from public, anon;
grant execute on function public.fl_bundle() to authenticated;
