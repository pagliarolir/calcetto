-- Pagamenti: «Tutti i conti» (i debiti di tutto il gruppo) torna solo al Leader, per scelta del proprietario.
-- Gli altri vedono i debiti che li riguardano. Resta tutto il resto della migrazione 60 (IBAN mascherato, «Ricevuti»).

create or replace function public.pay_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean := has_leader_powers(auth.uid()); tr jsonb; people uuid[];
  cleared timestamptz := coalesce((select history_cleared_at from pay_methods where user_id = auth.uid()), '-infinity');
  exp_cleared timestamptz := coalesce((select expenses_cleared_at from pay_methods where user_id = auth.uid()), '-infinity');
begin
  perform pay_require();
  select coalesce(jsonb_agg(jsonb_build_object('from_id', t.from_id, 'to_id', t.to_id, 'amount_cents', t.amount_cents)), '[]'::jsonb)
    into tr from pay_transfers() t where boss or me in (t.from_id, t.to_id);   -- i debiti di tutti solo al Leader (migrazione 61)
  -- metodi di pagamento: i propri e quelli di chi si deve pagare (al Leader tutti)
  select array_agg(distinct u) into people from (
    select me as u
    union select t.to_id from pay_transfers() t where boss or t.from_id = me
  ) x;
  return jsonb_build_object(
    'me', me,
    'boss', boss,
    'balance_cents', coalesce((select net_cents from pay_balances() where user_id = me), 0),
    'transfers', tr,
    'pending', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from pay_settlements s
                         where s.status = 'pending' and (boss or me in (s.from_id, s.to_id))), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(to_jsonb(s) order by s.decided_at desc) from (
                           select * from pay_settlements s where s.status <> 'pending' and (boss or me in (s.from_id, s.to_id))
                             and s.decided_at > cleared
                           order by s.decided_at desc limit 30) s), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (
                           select jsonb_build_object('id', e.id, 'title', e.title, 'amount_cents', e.amount_cents, 'payer_id', e.payer_id,
                                    'match_id', e.match_id, 'created_by', e.created_by, 'created_at', e.created_at,
                                    'shares', (select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'amount_cents', s.amount_cents) order by s.user_id)
                                               from pay_shares s where s.expense_id = e.id)) x
                           from pay_expenses e
                           where e.deleted_at is null and e.created_at > exp_cleared and (boss or e.payer_id = me or exists (select 1 from pay_shares s where s.expense_id = e.id and s.user_id = me))
                           order by e.created_at desc limit 60) y), '[]'::jsonb),
    'methods', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'paypal', m.paypal, 'iban', case when m.user_id = me then m.iban else pay_iban_mask(m.iban) end, 'holder', m.holder))
                         from pay_methods m where m.user_id = any (people)), '[]'::jsonb),
    'history_cleared_at', nullif(cleared, '-infinity'),
    'expenses_cleared_at', nullif(exp_cleared, '-infinity'),
    'settings', case when boss then (select jsonb_build_object('public', public, 'preview_users', preview_users) from pay_settings where id = 1) end
  );
end $$;
revoke execute on function public.pay_overview() from public, anon;
grant execute on function public.pay_overview() to authenticated;
