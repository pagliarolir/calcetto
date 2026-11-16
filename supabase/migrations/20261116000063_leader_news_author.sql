-- Leader News: insieme al testo arriva anche chi l'ha scritta, per la firma nel riquadro.
create or replace function public.leader_news_pending() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at, 'created_by', n.created_by) order by n.id), '[]'::jsonb)
  from (
    select n.* from leader_news n
    where is_active_member(auth.uid()) and n.deleted_at is null and n.created_at > now() - interval '14 days'
      and n.id > coalesce((select news_seen_id from profiles where id = auth.uid()), 0)
    order by n.id desc limit 5
  ) n
$$;
revoke execute on function public.leader_news_pending() from public, anon;
grant execute on function public.leader_news_pending() to authenticated;
