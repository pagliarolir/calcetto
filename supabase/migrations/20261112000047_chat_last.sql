-- Pallino della Chat solo con messaggi nuovi: il bundle della partita porta anche l'ora dell'ultimo messaggio
-- scritto da qualcun altro (chat_last). L'app lo confronta con l'ultimo messaggio già visto su questo telefono.
-- Resta SECURITY INVOKER: valgono le stesse regole RLS di chat_messages (lo vede solo chi può leggere la chat).
create or replace function public.match_bundle(p_match uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case when m.id is null then null else jsonb_build_object(
    'match', to_jsonb(m) || jsonb_build_object(
      'ends_at', ends_at(m), 'result_opens_at', result_opens_at(m), 'lock_at', lock_at(m), 'votes_close_at', votes_close_at(m),
      'lineup_opens_at', lineup_opens_at(m), 'chat_opens_at', chat_opens_at(m), 'chat_closes_at', chat_closes_at(m)),
    'board',   coalesce((select jsonb_agg(to_jsonb(b)) from booking_board b where b.match_id = p_match), '[]'::jsonb),
    'lineup',  coalesce((select jsonb_agg(to_jsonb(l)) from lineup l where l.match_id = p_match), '[]'::jsonb),
    'result',  (select to_jsonb(r) from results r where r.match_id = p_match),
    'reviews', coalesce((select jsonb_agg(to_jsonb(v)) from result_reviews v where v.match_id = p_match), '[]'::jsonb),
    'scorers', coalesce((select jsonb_agg(to_jsonb(s)) from scorers s where s.match_id = p_match), '[]'::jsonb),
    'windows', coalesce((select jsonb_agg(jsonb_build_object('user_id', w.user_id, 'opens_at', w.opens_at))
                         from priority_windows w where w.match_id = p_match), '[]'::jsonb),
    'chat_last', (select max(c.created_at) from chat_messages c where c.match_id = p_match and c.user_id is distinct from auth.uid())
  ) end
  from (select 1) one
  left join matches m on m.id = p_match;
$$;
revoke execute on function public.match_bundle(uuid) from public, anon;
grant execute on function public.match_bundle(uuid) to authenticated;
