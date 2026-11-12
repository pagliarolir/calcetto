-- Velocità: una chiamata al posto di tante (partita, classifica, avvio dell'app).
-- Sono funzioni SECURITY INVOKER: girano con i permessi di chi le chiama, quindi valgono le stesse regole RLS
-- e gli stessi controlli delle letture separate che sostituiscono (nessun dato in più è visibile).
-- L'app ripiega da sola sulle chiamate separate se queste funzioni non ci sono ancora (core/api.ts).

-- Pagina della partita: partita (con gli orari calcolati), lista, formazione, risultato, revisioni, marcatori, finestre di precedenza.
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
                         from priority_windows w where w.match_id = p_match), '[]'::jsonb)
  ) end
  from (select 1) one
  left join matches m on m.id = p_match;
$$;

-- Classifica di un periodo: tabella, divise, giocatori per divisa, coppie e data dell'ultimo azzeramento.
create or replace function public.stats_bundle(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rows',  coalesce((select jsonb_agg(to_jsonb(s)) from stats_table(p_from, p_to) s), '[]'::jsonb),
    'kits',  coalesce((select jsonb_agg(to_jsonb(k)) from team_kit_stats(p_from, p_to) k), '[]'::jsonb),
    'pkits', coalesce((select jsonb_agg(to_jsonb(k)) from player_kit_stats(p_from, p_to) k), '[]'::jsonb),
    'pairs', coalesce((select jsonb_agg(to_jsonb(c)) from pair_stats(p_from, p_to) c), '[]'::jsonb),
    'since', stats_reset_info(null) -> 'global'
  );
$$;

-- Avvio dell'app: «ultimo accesso» e profilo (touch), punizione in corso, membri del gruppo.
create or replace function public.bootstrap()
returns jsonb
language sql
volatile
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'me', touch(),
    'punishment', my_punishment(),
    'members', coalesce((select jsonb_agg(to_jsonb(m)) from members m), '[]'::jsonb)
  );
$$;

revoke execute on function public.match_bundle(uuid), public.stats_bundle(timestamptz, timestamptz), public.bootstrap() from public, anon;
grant execute on function public.match_bundle(uuid), public.stats_bundle(timestamptz, timestamptz), public.bootstrap() to authenticated;
