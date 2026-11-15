-- Pagamenti: «Svuota» lo storico dei pagamenti fatti.
-- Lo storico sparisce solo dalla propria vista (ognuno il suo, il Leader il suo): i pagamenti restano e continuano
-- a contare nei saldi, quindi svuotare non riapre né chiude nessun debito.

alter table public.pay_methods add column if not exists history_cleared_at timestamptz;

create or replace function public.pay_clear_history() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_not_punished();
  perform pay_require();
  insert into pay_methods (user_id, history_cleared_at) values (auth.uid(), now())
  on conflict (user_id) do update set history_cleared_at = now();
end $$;
revoke execute on function public.pay_clear_history() from public, anon;
grant execute on function public.pay_clear_history() to authenticated;

-- pay_overview: lo storico parte da dopo l'ultimo «Svuota»

-- tutto quello che serve alla pagina, già filtrato: chi non ha i poteri del Leader vede solo ciò che lo riguarda
create or replace function public.pay_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean := has_leader_powers(auth.uid()); tr jsonb; people uuid[];
  cleared timestamptz := coalesce((select history_cleared_at from pay_methods where user_id = auth.uid()), '-infinity');
begin
  perform pay_require();
  select coalesce(jsonb_agg(jsonb_build_object('from_id', t.from_id, 'to_id', t.to_id, 'amount_cents', t.amount_cents)), '[]'::jsonb)
    into tr from pay_transfers() t where boss or me in (t.from_id, t.to_id);
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
                           where e.deleted_at is null and (boss or e.payer_id = me or exists (select 1 from pay_shares s where s.expense_id = e.id and s.user_id = me))
                           order by e.created_at desc limit 60) y), '[]'::jsonb),
    'methods', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'paypal', m.paypal, 'iban', m.iban, 'holder', m.holder))
                         from pay_methods m where m.user_id = any (people)), '[]'::jsonb),
    'history_cleared_at', nullif(cleared, '-infinity'),
    'settings', case when boss then (select jsonb_build_object('public', public, 'preview_users', preview_users) from pay_settings where id = 1) end
  );
end $$;
revoke execute on function public.pay_overview() from public, anon;
grant execute on function public.pay_overview() to authenticated;
