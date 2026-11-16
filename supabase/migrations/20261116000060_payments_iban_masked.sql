-- Pagamenti:
-- 1) l'IBAN degli altri non si vede più: arriva mascherato (prime 4 lettere, poi asterischi), anche al Leader.
--    Il numero intero si chiede con pay_reveal_iban() solo per copiarlo, e solo da chi deve dei soldi a quella persona.
-- 2) i debiti di tutto il gruppo («chi deve quanto a chi») li vedono tutti quelli che vedono i Pagamenti.
-- 3) correzione: chi riceve può segnare da sé «Ricevuti» un pagamento di chi gli deve dei soldi (prima solo il Leader).

create or replace function public.pay_iban_mask(p_iban text) returns text
language sql immutable set search_path = public as $$
  select case when p_iban is null then null else left(p_iban, 4) || repeat('*', greatest(length(p_iban) - 4, 0)) end
$$;
revoke execute on function public.pay_iban_mask(text) from public, anon, authenticated;

create or replace function public.pay_reveal_iban(p_to uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform pay_require();
  if p_to = me then return (select iban from pay_methods where user_id = me); end if;
  -- solo chi in questo momento deve dei soldi a quella persona
  if not exists (select 1 from pay_transfers() t where t.from_id = me and t.to_id = p_to) then
    raise exception 'Puoi copiare l''IBAN solo di chi devi pagare';
  end if;
  return (select iban from pay_methods where user_id = p_to);
end $$;
revoke execute on function public.pay_reveal_iban(uuid) from public, anon;
grant execute on function public.pay_reveal_iban(uuid) to authenticated;

create or replace function public.pay_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean := has_leader_powers(auth.uid()); tr jsonb; people uuid[];
  cleared timestamptz := coalesce((select history_cleared_at from pay_methods where user_id = auth.uid()), '-infinity');
  exp_cleared timestamptz := coalesce((select expenses_cleared_at from pay_methods where user_id = auth.uid()), '-infinity');
begin
  perform pay_require();
  select coalesce(jsonb_agg(jsonb_build_object('from_id', t.from_id, 'to_id', t.to_id, 'amount_cents', t.amount_cents)), '[]'::jsonb)
    into tr from pay_transfers() t;   -- i debiti di tutto il gruppo li vedono tutti (migrazione 60)
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

-- chi riceve segna da sé i soldi ricevuti
create or replace function public.pay_mark_paid(p_to uuid, p_amount_cents int, p_method text, p_from uuid default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); src uuid := coalesce(p_from, auth.uid()); boss boolean := has_leader_powers(auth.uid()); sid bigint;
begin
  perform assert_not_punished();
  perform pay_require();
  -- si segnano i propri pagamenti, quelli ricevuti (chi riceve conferma da sé) e, per il Leader, quelli di tutti
  if src is distinct from me and p_to is distinct from me and not boss then raise exception 'Puoi segnare solo i tuoi pagamenti'; end if;
  if src = p_to then raise exception 'Chi paga e chi riceve devono essere diversi'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Scrivi un importo maggiore di zero'; end if;
  if p_method not in ('paypal', 'iban', 'cash') then raise exception 'Metodo di pagamento non valido'; end if;
  if not exists (select 1 from profiles where id = p_to and active) then raise exception 'Chi riceve non è nel gruppo'; end if;
  if src = me and exists (select 1 from pay_settlements where from_id = me and to_id = p_to and status = 'pending') then
    raise exception 'Hai già segnato un pagamento a questa persona: aspetta che lo confermi';
  end if;
  -- il Leader che segna per altri (o chi riceve che lo segna da sé) conferma subito
  if (src <> me and boss) or p_to = me then
    insert into pay_settlements (from_id, to_id, amount_cents, method, status, created_by, decided_by, decided_at)
    values (src, p_to, p_amount_cents, p_method, 'confirmed', me, me, now()) returning id into sid;
    perform notify(array(select x from unnest(array[src, p_to]) x where x <> me and pay_can_see(x)), 'pay_confirmed', 'Pagamento registrato',
      display_name(me) || ' ha segnato che ' || display_name(src) || ' ha dato ' || pay_eur(p_amount_cents) || ' a ' || display_name(p_to) || '.', '/pagamenti');
  else
    insert into pay_settlements (from_id, to_id, amount_cents, method, created_by)
    values (src, p_to, p_amount_cents, p_method, me) returning id into sid;
    perform notify(array(select x from unnest(array[p_to]) x where pay_can_see(x)), 'pay_check', 'Ti hanno pagato?',
      display_name(src) || ' dice di averti dato ' || pay_eur(p_amount_cents) || ' con ' ||
      case p_method when 'paypal' then 'PayPal' when 'iban' then 'bonifico' else 'contanti' end || ': conferma se li hai ricevuti.', '/pagamenti');
  end if;
  return sid;
end $$;
revoke execute on function public.pay_mark_paid(uuid, int, text, uuid) from public, anon;
grant execute on function public.pay_mark_paid(uuid, int, text, uuid) to authenticated;
