-- Conti, correzioni dopo il controllo di qualità (decisioni del proprietario, 16/11/2026):
--  1) cartellini solo se il campo è stato inserito entro la mezzanotte della partita; partite di più di 3 giorni
--     prima: il campo lo divide solo il Leader; un controllo dà al massimo un cartellino a testa
--  2) chi ha segnato il pagamento prima della scadenza non prende il cartellino finché chi riceve non risponde:
--     se lo rifiuta e il debito resta, arriva il cartellino
--  3) niente cartellini ai giocatori senza account
--  4) una sola spesa di campo per partita
--  5) il cartellino guarda solo il debito del campo
--  6) messaggio della punizione del rosso: si può solo saldare, poi si torna attivi da soli
--  7) il cartellino si toglie appena il saldo è confermato (non al giro dopo)
--  8) non si elimina un profilo con movimenti nei Conti (i conti degli altri cambierebbero)
--  9) avviso a chi è coinvolto quando una spesa viene tolta
-- 12) quote arrotondate per eccesso al centesimo: tutti pagano uguale, chi ha pagato ci mette qualche centesimo in meno
-- 14) «Ho pagato» due volte di fila: un solo pagamento in attesa
-- 15) promemoria e richieste dei dati contati per mittente (rate_events), non dal nome nel testo

-- chi aveva un pagamento in attesa alla scadenza: si decide quando chi riceve risponde
alter table public.pay_card_checks add column if not exists waiting uuid[] not null default '{}';

-- 12) chi ha pagato riceve la somma delle quote (con l'arrotondamento per eccesso può superare di pochi centesimi l'importo)
create or replace function public.pay_balances() returns table (user_id uuid, net_cents bigint)
language sql stable security definer set search_path = public as $$
  select u, sum(v)::bigint from (
    select e.payer_id as u, s.amount_cents::bigint as v
    from pay_shares s join pay_expenses e on e.id = s.expense_id where e.deleted_at is null
    union all
    select s.user_id, -s.amount_cents from pay_shares s join pay_expenses e on e.id = s.expense_id where e.deleted_at is null
    union all
    select from_id, amount_cents from pay_settlements where status = 'confirmed'
    union all
    select to_id, -amount_cents from pay_settlements where status = 'confirmed'
  ) x group by u having sum(v) <> 0
$$;
revoke execute on function public.pay_balances() from public, anon, authenticated;

-- 5) quanto manca del campo: i pagamenti fatti vanno prima al campo, e non si supera il debito totale
-- (chi deve il campo ma ha da ricevere di più per altre spese non deve niente). Con p_pending contano anche
-- i propri pagamenti in attesa di conferma.
create or replace function public.pay_field_debt(p_uid uuid, p_pending boolean default false) returns bigint
language sql stable security definer set search_path = public as $$
  with sh as (
    select e.payer_id, s.user_id, s.amount_cents, e.match_id is not null as field
    from pay_shares s join pay_expenses e on e.id = s.expense_id where e.deleted_at is null
  ), st as (
    select from_id, to_id, amount_cents from pay_settlements
    where status = 'confirmed' or (p_pending and status = 'pending' and from_id = p_uid)
  ), t as (
    select
      coalesce((select sum(amount_cents) from sh where user_id = p_uid), 0)
        - coalesce((select sum(amount_cents) from sh where payer_id = p_uid), 0) as owe_all,
      coalesce((select sum(amount_cents) from sh where user_id = p_uid and field), 0)
        - coalesce((select sum(amount_cents) from sh where payer_id = p_uid and field), 0) as owe_field,
      coalesce((select sum(amount_cents) from st where from_id = p_uid), 0)
        - coalesce((select sum(amount_cents) from st where to_id = p_uid), 0) as paid
  )
  select greatest(0, least(owe_field - paid, owe_all - paid))::bigint from t
$$;
revoke execute on function public.pay_field_debt(uuid, boolean) from public, anon, authenticated;

-- 7) toglie i cartellini a chi ha saldato il campo (con le conferme); il rosso toglie anche la punizione
create or replace function public.pay_cards_settle(p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid; was_red boolean;
begin
  for u in select distinct user_id from pay_cards where cleared_at is null and (p_users is null or user_id = any (p_users)) loop
    continue when pay_field_debt(u, false) > 0;
    select bool_or(color = 'red') into was_red from pay_cards where user_id = u and cleared_at is null;
    update punishments set revoked_at = now()
     where revoked_at is null and id in (select punishment_id from pay_cards where user_id = u and cleared_at is null and punishment_id is not null);
    update pay_cards set cleared_at = now() where user_id = u and cleared_at is null;
    perform notify(array[u], 'pay_card_cleared', 'Conti in regola',
      case when was_red then 'Hai saldato e i pagamenti sono confermati: la punizione è finita.'
           else 'Hai saldato e i pagamenti sono confermati: il cartellino giallo è tolto.' end, '/pagamenti');
  end loop;
end $$;
revoke execute on function public.pay_cards_settle(uuid[]) from public, anon, authenticated;

-- giallo, oppure rosso a chi ha già il giallo (una volta sola)
create or replace function public.pay_card_give(p_uid uuid, p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pid bigint; nag uuid; mm record;
begin
  if exists (select 1 from pay_cards where user_id = p_uid and cleared_at is null) then
    if exists (select 1 from pay_cards where user_id = p_uid and cleared_at is null and color = 'red') then return; end if;
    insert into punishments (user_id, ends_at, reason, created_by)
    values (p_uid, null, 'Quota del campo non pagata: finisce quando saldi e chi riceve conferma', null) returning id into pid;
    insert into pay_cards (user_id, color, match_id, punishment_id) values (p_uid, 'red', p_match, pid);
    -- col rosso non si gioca: esce dalle liste delle partite non ancora iniziate (le riserve salgono come sempre).
    -- Un problema qui non deve fermare il giro dei cartellini.
    for mm in select b.match_id from bookings b join matches x on x.id = b.match_id
              where b.user_id = p_uid and b.list <> 'out' and x.status = 'scheduled' and x.starts_at > now() loop
      begin
        perform _book(null, p_uid, mm.match_id, 'absent', true);
      exception when others then
        raise warning 'cartellino rosso: non tolgo % dalla partita %: %', p_uid, mm.match_id, sqlerrm;
      end;
    end loop;
    perform notify(array[p_uid], 'pay_red', 'Cartellino rosso',
      'Hai ancora un debito del campo: sei in punizione e puoi solo saldare in Conti. Quando chi riceve conferma, torni attivo da solo.', '/pagamenti');
  else
    insert into pay_cards (user_id, color, match_id) values (p_uid, 'yellow', p_match);
    select id into nag from achievements where number = 11;   -- lo sticker segreto, scelto dal proprietario
    if nag is not null then
      insert into player_achievements (user_id, achievement_id, awarded_by, announced) values (p_uid, nag, null, true)
      on conflict do nothing;
    end if;
    perform notify(array[p_uid], 'pay_yellow', 'Cartellino giallo',
      'La quota del campo non è stata pagata entro le 12. Salda in Conti: se alla prossima partita hai ancora un debito, è rosso.', '/pagamenti');
  end if;
end $$;
revoke execute on function public.pay_card_give(uuid, uuid) from public, anon, authenticated;

create or replace function public.pay_cards_tick() returns void
language plpgsql security definer set search_path = public as $$
declare r record; u uuid; w uuid; carded uuid[] := '{}'; still uuid[];
begin
  -- 1) chi ha saldato perde il cartellino (di solito succede già alla conferma)
  perform pay_cards_settle(null);

  -- 2) partite con la spesa del campo arrivate alla scadenza (le 12 del giorno dopo) e non ancora controllate
  for r in
    select e.match_id, min(e.created_at) as created, max(lock_at(m)) as midnight
    from pay_expenses e join matches m on m.id = e.match_id
    where e.deleted_at is null and e.match_id is not null
      and not exists (select 1 from pay_card_checks k where k.match_id = e.match_id)
    group by e.match_id
    having now() >= max(scorers_close_at(m))
  loop
    insert into pay_card_checks (match_id) values (r.match_id) on conflict do nothing;
    -- 1) campo inserito dopo la mezzanotte della partita: niente cartellini (scelta del proprietario)
    continue when r.created > r.midnight;
    still := '{}';
    for u in
      select distinct s.user_id from pay_shares s join pay_expenses e on e.id = s.expense_id join profiles p on p.id = s.user_id
      where e.match_id = r.match_id and e.deleted_at is null and s.user_id <> e.payer_id
        and not p.guest            -- 3) senza account non si paga dall'app
        and p.role <> 'leader'     -- il Leader titolare non prende cartellini
    loop
      continue when not pay_can_see(u) or u = any (carded);   -- al massimo un cartellino a testa per giro
      if pay_field_debt(u, true) > 0 then
        perform pay_card_give(u, r.match_id);
        carded := carded || u;
      elsif pay_field_debt(u, false) > 0 then
        still := still || u;       -- 2) in regola solo grazie a un pagamento in attesa: si aspetta chi riceve
      end if;
    end loop;
    if cardinality(still) > 0 then update pay_card_checks set waiting = still where match_id = r.match_id; end if;
  end loop;

  -- 3) pagamenti in attesa alla scadenza: deciso chi riceve, se il debito del campo resta arriva il cartellino.
  -- Contano solo i pagamenti segnati prima del controllo (rifiutato e risegnato non protegge più).
  for r in select match_id, checked_at, waiting from pay_card_checks where cardinality(waiting) > 0 loop
    still := '{}';
    foreach w in array r.waiting loop
      if exists (select 1 from pay_settlements where from_id = w and status = 'pending' and created_at <= r.checked_at) then
        still := still || w;
      elsif pay_can_see(w) and not (w = any (carded)) and pay_field_debt(w, false) > 0 then
        perform pay_card_give(w, r.match_id);
        carded := carded || w;
      end if;
    end loop;
    update pay_card_checks set waiting = still where match_id = r.match_id;
  end loop;
end $$;
revoke execute on function public.pay_cards_tick() from public, anon, authenticated;

-- nuova spesa
create or replace function public.pay_add_expense(p_title text, p_amount_cents int, p_payer uuid, p_users uuid[], p_match uuid default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; c int; eid bigint; who uuid[]; u uuid; m matches; other pay_expenses;
begin
  perform assert_not_punished();
  perform pay_require();
  if p_payer is null then raise exception 'Scegli chi ha pagato'; end if;
  if not exists (select 1 from profiles where id = p_payer and active) then raise exception 'Chi ha pagato non è nel gruppo'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Scrivi un importo maggiore di zero'; end if;
  if char_length(trim(coalesce(p_title, ''))) = 0 then raise exception 'Scrivi a cosa si riferisce la spesa'; end if;
  if p_match is not null then
    -- la partita bloccata fa da semaforo: due «Dividi il campo» insieme non passano entrambi
    select * into m from matches where id = p_match for update;
    if m.id is null then raise exception 'Partita non trovata'; end if;
    -- 1) partite di più di 3 giorni prima: solo il Leader
    if m.starts_at < now() - interval '3 days' and not has_leader_powers(me) then
      raise exception 'Sono passati più di 3 giorni dalla partita: il campo lo può dividere solo il Leader';
    end if;
    -- 4) una sola spesa di campo per partita
    select * into other from pay_expenses where match_id = p_match and deleted_at is null limit 1;
    if other.id is not null then
      raise exception 'Il campo di questa partita è già nei Conti (pagato da %)', display_name(other.payer_id);
    end if;
  end if;
  select array_agg(distinct x order by x) into who from unnest(coalesce(p_users, '{}')) x where exists (select 1 from profiles p where p.id = x and p.active);
  n := coalesce(array_length(who, 1), 0);
  if n = 0 then raise exception 'Scegli almeno una persona tra cui dividere'; end if;
  if n = 1 and who[1] = p_payer then raise exception 'Una spesa solo per chi l''ha pagata non crea debiti'; end if;
  insert into pay_expenses (title, amount_cents, payer_id, match_id, created_by)
  values (trim(p_title), p_amount_cents, p_payer, p_match, me) returning id into eid;
  -- 12) quota arrotondata per eccesso al centesimo, uguale per tutti; chi ha pagato tiene il resto
  c := (p_amount_cents + n - 1) / n;
  foreach u in array who loop
    insert into pay_shares (expense_id, user_id, amount_cents)
    values (eid, u, case when u = p_payer then greatest(p_amount_cents - (n - 1) * c, 0) else c end);
  end loop;
  perform notify(array(select x from unnest(who) x where x <> p_payer and x <> me and pay_can_see(x)),
    'pay_expense', 'Nuova spesa: ' || trim(p_title),
    display_name(p_payer) || ' ha pagato ' || pay_eur(p_amount_cents) || ': la tua quota è ' || pay_eur(c) || '.', '/pagamenti');
  -- chi ha pagato, se l'ha inserita un altro
  if p_payer <> me and pay_can_see(p_payer) then
    perform notify(array[p_payer], 'pay_expense', 'Spesa a tuo nome: ' || trim(p_title),
      display_name(me) || ' ha segnato che hai pagato ' || pay_eur(p_amount_cents) || ', divisi tra ' || n || '. Se non torna, puoi toglierla.', '/pagamenti');
  end if;
  perform pay_cards_settle(array[p_payer]);
  return eid;
end $$;
revoke execute on function public.pay_add_expense(text, int, uuid, uuid[], uuid) from public, anon;
grant execute on function public.pay_add_expense(text, int, uuid, uuid[], uuid) to authenticated;

-- 9) togliere una spesa: avvisa chi era coinvolto
create or replace function public.pay_delete_expense(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare e pay_expenses; me uuid := auth.uid(); who uuid[];
begin
  perform assert_not_punished();
  perform pay_require();
  select * into e from pay_expenses where id = p_id and deleted_at is null for update;
  if e.id is null then raise exception 'Spesa non trovata'; end if;
  if me not in (coalesce(e.created_by, e.payer_id), e.payer_id) and not has_leader_powers() then
    raise exception 'Può toglierla solo chi l''ha inserita o il Leader';
  end if;
  update pay_expenses set deleted_at = now() where id = p_id;
  select array_agg(distinct x) into who from (select e.payer_id as x union select user_id from pay_shares where expense_id = p_id) y;
  perform notify(array(select x from unnest(who) x where x <> me and pay_can_see(x)), 'pay_expense_deleted',
    'Spesa tolta: ' || e.title,
    display_name(me) || ' ha tolto «' || e.title || '» (' || pay_eur(e.amount_cents) || '): i conti sono ricalcolati.', '/pagamenti');
  perform pay_cards_settle(who);
end $$;
revoke execute on function public.pay_delete_expense(bigint) from public, anon;
grant execute on function public.pay_delete_expense(bigint) to authenticated;

-- 7) confermato il pagamento, il cartellino si toglie subito
create or replace function public.pay_decide(p_id bigint, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s pay_settlements; me uuid := auth.uid();
begin
  -- niente assert_not_punished: anche chi è in punizione può saldare i conti (migrazione 64)
  perform pay_require();
  select * into s from pay_settlements where id = p_id and status = 'pending' for update;
  if s.id is null then raise exception 'Pagamento non trovato o già deciso'; end if;
  if me is distinct from s.to_id and not has_leader_powers(me) then raise exception 'Può confermarlo solo chi riceve i soldi'; end if;
  update pay_settlements set status = case when p_ok then 'confirmed' else 'rejected' end, decided_by = me, decided_at = now() where id = p_id;
  perform notify(array(select x from unnest(array[s.from_id]) x where x <> me and pay_can_see(x)),
    case when p_ok then 'pay_confirmed' else 'pay_rejected' end,
    case when p_ok then 'Pagamento confermato' else 'Pagamento non ricevuto' end,
    case when p_ok then display_name(s.to_id) || ' ha confermato di aver ricevuto ' || pay_eur(s.amount_cents) || '.'
         else display_name(s.to_id) || ' dice di non aver ricevuto ' || pay_eur(s.amount_cents) || ': il debito resta aperto.' end,
    '/pagamenti');
  if p_ok then perform pay_cards_settle(array[s.from_id]); end if;
end $$;
revoke execute on function public.pay_decide(bigint, boolean) from public, anon;
grant execute on function public.pay_decide(bigint, boolean) to authenticated;

-- 14) un solo «Ho pagato» alla volta per coppia; 7) se vale subito, il cartellino si toglie subito
create or replace function public.pay_mark_paid(p_to uuid, p_amount_cents int, p_method text, p_from uuid default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); src uuid := coalesce(p_from, auth.uid()); boss boolean := has_leader_powers(auth.uid()); sid bigint;
begin
  -- niente assert_not_punished: anche chi è in punizione può saldare i conti (migrazione 64)
  perform pay_require();
  -- si segnano i propri pagamenti, quelli ricevuti (chi riceve conferma da sé) e, per il Leader, quelli di tutti
  if src is distinct from me and p_to is distinct from me and not boss then raise exception 'Puoi segnare solo i tuoi pagamenti'; end if;
  if src = p_to then raise exception 'Chi paga e chi riceve devono essere diversi'; end if;
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Scrivi un importo maggiore di zero'; end if;
  if p_method not in ('paypal', 'iban', 'cash') then raise exception 'Metodo di pagamento non valido'; end if;
  if not exists (select 1 from profiles where id = p_to and active) then raise exception 'Chi riceve non è nel gruppo'; end if;
  -- due tocchi rapidi arrivano insieme: il secondo aspetta il primo e poi trova il pagamento già segnato
  perform pg_advisory_xact_lock(hashtextextended('pay_mark:' || src::text || ':' || p_to::text, 0));
  if src = me and exists (select 1 from pay_settlements where from_id = me and to_id = p_to and status = 'pending') then
    raise exception 'Hai già segnato un pagamento a questa persona: aspetta che lo confermi';
  end if;
  -- il Leader che segna per altri (o chi riceve che lo segna da sé) conferma subito
  if (src <> me and boss) or p_to = me then
    insert into pay_settlements (from_id, to_id, amount_cents, method, status, created_by, decided_by, decided_at)
    values (src, p_to, p_amount_cents, p_method, 'confirmed', me, me, now()) returning id into sid;
    perform notify(array(select x from unnest(array[src, p_to]) x where x <> me and pay_can_see(x)), 'pay_confirmed', 'Pagamento registrato',
      display_name(me) || ' ha segnato che ' || display_name(src) || ' ha dato ' || pay_eur(p_amount_cents) || ' a ' || display_name(p_to) || '.', '/pagamenti');
    perform pay_cards_settle(array[src]);
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

-- 15) promemoria: uno al giorno per persona, contato per mittente
create or replace function public.pay_remind(p_from uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); owed bigint; rome timestamp := now() at time zone 'Europe/Rome';
begin
  perform assert_not_punished();
  perform pay_require();
  select amount_cents into owed from pay_transfers() t where t.from_id = p_from and t.to_id = me;
  if owed is null then raise exception 'Questa persona non ti deve niente'; end if;
  if extract(hour from rome) < 13 then return 'early'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pay_remind:' || me::text || ':' || p_from::text, 0));
  if exists (select 1 from rate_events where user_id = me and kind = 'pay_remind:' || p_from::text
             and (at at time zone 'Europe/Rome')::date = rome::date) then
    return 'already';
  end if;
  insert into rate_events (user_id, kind) values (me, 'pay_remind:' || p_from::text);
  delete from rate_events where user_id = me and kind like 'pay\_%' and at < now() - interval '2 days';
  perform notify(array[p_from], 'pay_remind', 'Promemoria: hai un debito',
    display_name(me) || ' ti ricorda che gli devi ' || pay_eur(owed::int) || '. Salda in Conti.', '/pagamenti');
  return 'sent';
end $$;
revoke execute on function public.pay_remind(uuid) from public, anon;
grant execute on function public.pay_remind(uuid) to authenticated;

-- 15) richiesta dei dati di pagamento: una ogni 12 ore per coppia, contata per mittente
create or replace function public.pay_ask_methods(p_to uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  -- niente assert_not_punished: anche chi è in punizione può saldare i conti (migrazione 64)
  perform pay_require();
  if p_to is null or p_to = me then return false; end if;
  if not pay_can_see(p_to) then return false; end if;
  -- ha già i dati: niente da chiedere
  if exists (select 1 from pay_methods where user_id = p_to and (paypal is not null or iban is not null)) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('pay_ask:' || me::text || ':' || p_to::text, 0));
  if exists (select 1 from rate_events where user_id = me and kind = 'pay_ask:' || p_to::text and at > now() - interval '12 hours') then
    return false;
  end if;
  insert into rate_events (user_id, kind) values (me, 'pay_ask:' || p_to::text);
  perform notify(array[p_to], 'pay_ask_methods', 'Aggiungi i dati di pagamento',
    display_name(me) || ' vuole pagarti: aggiungi PayPal o IBAN in Conti.', '/pagamenti?dati=1');
  return true;
end $$;
revoke execute on function public.pay_ask_methods(uuid) from public, anon;
grant execute on function public.pay_ask_methods(uuid) to authenticated;

-- 4) per l'app: quali di queste partite hanno già il campo nei Conti
create or replace function public.pay_field_matches(p_ids uuid[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct e.match_id), '{}') from pay_expenses e
  where pay_can_see() and e.deleted_at is null and e.match_id = any (coalesce(p_ids, '{}'))
$$;
revoke execute on function public.pay_field_matches(uuid[]) from public, anon;
grant execute on function public.pay_field_matches(uuid[]) to authenticated;

-- 6) il rosso dei Conti ha il suo messaggio: si può solo saldare, poi si torna attivi da soli
create or replace function public.assert_not_punished() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if is_punished(auth.uid()) then
    if not exists (select 1 from punishments p
                   where p.user_id = auth.uid() and p.revoked_at is null and p.starts_at <= now()
                     and (p.ends_at is null or p.ends_at > now())
                     and not exists (select 1 from pay_cards c where c.punishment_id = p.id)) then
      raise exception using errcode = 'GDL01', message = 'Sei in punizione per la quota del campo: puoi solo saldare in Conti, poi torni attivo da solo';
    end if;
    raise exception using errcode = 'GDL01', message = 'Sei in punizione per ordine del Leader, rifletti sui tuoi errori';
  end if;
end $$;

-- 8) un profilo con movimenti nei Conti non si elimina: sparirebbero spese e pagamenti e i saldi degli altri non tornerebbero
create or replace function public.trg_profiles_pay_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from pay_expenses where payer_id = old.id and deleted_at is null)
     or exists (select 1 from pay_shares s join pay_expenses e on e.id = s.expense_id where s.user_id = old.id and e.deleted_at is null)
     or exists (select 1 from pay_settlements where old.id in (from_id, to_id) and status <> 'rejected') then
    raise exception '% ha dei movimenti nei Conti: non si può eliminare, altrimenti i conti degli altri non tornerebbero', display_name(old.id);
  end if;
  return old;
end $$;
revoke execute on function public.trg_profiles_pay_guard() from public, anon, authenticated;
drop trigger if exists profiles_pay_guard on public.profiles;
create trigger profiles_pay_guard before delete on public.profiles
for each row execute function public.trg_profiles_pay_guard();
