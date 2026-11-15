-- Pagamenti: chiunque veda i Pagamenti può inserire una spesa pagata da un altro (non più solo il Leader).
-- Chi ha pagato viene avvisato, così può controllare o togliere la spesa (la toglie chi l'ha inserita, chi l'ha
-- pagata o il Leader, come prima).

create or replace function public.pay_add_expense(p_title text, p_amount_cents int, p_payer uuid, p_users uuid[], p_match uuid default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; q int; r int; eid bigint; who uuid[]; k int := 0; u uuid;
begin
  perform assert_not_punished();
  perform pay_require();
  if p_payer is null then raise exception 'Scegli chi ha pagato'; end if;
  if not exists (select 1 from profiles where id = p_payer and active) then raise exception 'Chi ha pagato non è nel gruppo'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Scrivi un importo maggiore di zero'; end if;
  if char_length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Scrivi a cosa si riferisce la spesa'; end if;
  select array_agg(distinct x order by x) into who from unnest(coalesce(p_users, '{}')) x where exists (select 1 from profiles p where p.id = x and p.active);
  n := coalesce(array_length(who, 1), 0);
  if n = 0 then raise exception 'Scegli almeno una persona tra cui dividere'; end if;
  if n = 1 and who[1] = p_payer then raise exception 'Una spesa solo per chi l''ha pagata non crea debiti'; end if;
  insert into pay_expenses (title, amount_cents, payer_id, match_id, created_by)
  values (trim(p_title), p_amount_cents, p_payer, p_match, me) returning id into eid;
  q := p_amount_cents / n; r := p_amount_cents % n;
  foreach u in array who loop
    k := k + 1;
    insert into pay_shares (expense_id, user_id, amount_cents) values (eid, u, q + case when k <= r then 1 else 0 end);
  end loop;
  perform notify(array(select x from unnest(who) x where x <> p_payer and x <> me and pay_can_see(x)),
    'pay_expense', 'Nuova spesa: ' || trim(p_title),
    display_name(p_payer) || ' ha pagato ' || pay_eur(p_amount_cents) || ': la tua quota è ' || pay_eur(q) || '.', '/pagamenti');
  -- chi ha pagato, se l'ha inserita un altro
  if p_payer <> me and pay_can_see(p_payer) then
    perform notify(array[p_payer], 'pay_expense', 'Spesa a tuo nome: ' || trim(p_title),
      display_name(me) || ' ha segnato che hai pagato ' || pay_eur(p_amount_cents) || ', divisi tra ' || n || '. Se non torna, puoi toglierla.', '/pagamenti');
  end if;
  return eid;
end $$;
revoke execute on function public.pay_add_expense(text, int, uuid, uuid[], uuid) from public, anon;
grant execute on function public.pay_add_expense(text, int, uuid, uuid[], uuid) to authenticated;
