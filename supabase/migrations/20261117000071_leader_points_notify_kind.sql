-- =====================================================================
-- Punti Leader per tutti: tipo tutto loro ('leader_points_all'), non più 'achievement'.
-- ('leader_points' resta l'avviso personale a chi li riceve, che arriva sempre.)
-- Nell'elenco degli avvisi più Punti Leader dello stesso giorno finivano nel gruppo
-- «N sticker sbloccati». Restano nella stessa voce delle preferenze («Obiettivi sbloccati»).
-- =====================================================================
create or replace function public.notify_category(p_kind text) returns text
language sql immutable as $$
  select case
    when p_kind = 'chat' then 'chat'
    when p_kind in ('booking_open', 'priority_open') then 'booking_open'
    when p_kind = 'team_full' then 'team_full'
    when p_kind in ('withdrawal', 'need_one', 'late_withdrawal') then 'withdrawal'
    when p_kind = 'lineup_official' then 'lineup_official'
    when p_kind = 'lineup_change' then 'lineup_change'
    when p_kind in ('match_moved', 'venue_changed', 'match_cancelled') then 'match_changes'
    when p_kind in ('result_open', 'result_review', 'result_contested', 'result_final', 'result_homologated') then 'result'
    when p_kind = 'votes_open' then 'votes'
    when p_kind in ('achievement', 'leader_points_all') then 'achievements'
  end
$$;

create or replace function public.trg_leader_points_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- chi assegna i punti non riceve l'avviso della propria azione; chi li riceve ha già il suo avviso personale
  perform notify(array(select id from profiles where active and id is distinct from new.created_by and id <> new.user_id), 'leader_points_all',
    'Punti Leader: ' || case when new.points > 0 then '+' else '' end || new.points || ' a ' || display_name(new.user_id),
    '«' || new.reason || '». Guarda la classifica dei Punti Leader.',
    '/classifica?scheda=punti', null);
  return null;
end $$;
revoke execute on function public.trg_leader_points_notify() from public, anon, authenticated;

-- gli avvisi già spediti cambiano tipo, così non restano nel gruppo degli sticker
update public.notifications set kind = 'leader_points_all' where kind = 'achievement' and title like 'Punti Leader:%';
