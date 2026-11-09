-- =====================================================================
-- Punti Leader: avviso a tutti, come per gli sticker (stessa categoria delle preferenze:
-- «Obiettivi sbloccati»). Nell'app compare anche il riquadro in cima per 24 ore.
-- =====================================================================
create or replace function public.trg_leader_points_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify(array(select id from profiles where active), 'achievement',
    'Punti Leader: ' || case when new.points > 0 then '+' else '' end || new.points || ' a ' || display_name(new.user_id),
    '«' || new.reason || '». Guarda la classifica dei Punti Leader.',
    '/classifica?scheda=punti', null);
  return null;
end $$;
revoke execute on function public.trg_leader_points_notify() from public, anon, authenticated;
create trigger leader_points_notify after insert on public.leader_points
  for each row execute function public.trg_leader_points_notify();
