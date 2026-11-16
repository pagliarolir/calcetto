-- Banda delle Leader News nell'intestazione della partita (bozza, branch non unito):
-- le notizie degli ultimi 14 giorni per chi è nel gruppo, lette o no.
create or replace function public.leader_news_recent() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at, 'created_by', n.created_by) order by n.id desc), '[]'::jsonb)
  from leader_news n
  where is_active_member() and n.deleted_at is null and n.created_at > now() - interval '14 days'
$$;
revoke execute on function public.leader_news_recent() from public, anon;
grant execute on function public.leader_news_recent() to authenticated;
