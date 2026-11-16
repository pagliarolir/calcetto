-- Pagamenti: cartellini per chi non paga il campo, promemoria di chi deve ricevere, e conti sempre saldabili.
--
-- Regole (decise dal proprietario; valgono per chi vede i Pagamenti, quindi per tutti quando saranno aperti):
-- * Scadenza: le 12 del giorno dopo la partita (scorers_close_at), o 12 ore dopo l'inserimento della spesa se arriva tardi.
-- * A scadenza, chi ha una quota nel campo di quella partita (spesa con match_id) e ha ancora un debito confermato
--   (saldo negativo: i pagamenti non ancora confermati da chi riceve non contano) prende il GIALLO.
--   Il giallo resta finché non salda tutto (saldo >= 0 con le conferme).
-- * Se alla scadenza di un'altra partita ha ancora un giallo (debito non saldato) e ancora un debito di campo: ROSSO,
--   cioè la punizione del Leader (tabella punishments, senza scadenza) finché non salda e chi riceve conferma.
--   Il Leader titolare non può essere punito: per lui solo il giallo.
-- * Al primo giallo si sblocca in silenzio lo sticker segreto (se esiste), senza spiegazioni nei testi.
-- * In punizione si possono sempre vedere e saldare i conti: le funzioni per pagare non chiamano più assert_not_punished.
-- * Chi deve ricevere può mandare un promemoria a chi gli deve dei soldi: una volta al giorno per persona, dalle 13 (ora di Roma).

create table public.pay_cards (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  color         text not null check (color in ('yellow', 'red')),
  match_id      uuid references public.matches (id) on delete set null,
  punishment_id bigint references public.punishments (id) on delete set null,
  created_at    timestamptz not null default now(),
  seen_at       timestamptz,
  cleared_at    timestamptz
);
create index pay_cards_active on public.pay_cards (user_id) where cleared_at is null;

-- partite già controllate (una volta sola per partita)
create table public.pay_card_checks (
  match_id   uuid primary key references public.matches (id) on delete cascade,
  checked_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['pay_cards','pay_card_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.pay_net(p_uid uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select net_cents from pay_balances() where user_id = p_uid), 0)
$$;
revoke execute on function public.pay_net(uuid) from public, anon, authenticated;

-- il giro dei cartellini: ogni 10 minuti (pg_cron)
create or replace function public.pay_cards_tick() returns void
language plpgsql security definer set search_path = public as $$
declare c record; r record; u uuid; pid bigint; nag uuid; is_titular boolean;
begin
  -- 1) chi ha saldato (con le conferme) perde il cartellino; il rosso toglie anche la punizione
  for c in select * from pay_cards where cleared_at is null loop
    if pay_net(c.user_id) >= 0 then
      update pay_cards set cleared_at = now() where id = c.id;
      if c.punishment_id is not null then
        update punishments set revoked_at = now() where id = c.punishment_id and revoked_at is null;
      end if;
      perform notify(array[c.user_id], 'pay_card_cleared', 'Conti in regola',
        case when c.color = 'red' then 'Hai saldato e i pagamenti sono confermati: la punizione è finita.'
             else 'Hai saldato e i pagamenti sono confermati: il cartellino giallo è tolto.' end, '/pagamenti');
    end if;
  end loop;

  -- 2) partite con la spesa del campo arrivate alla scadenza e non ancora controllate
  for r in
    select e.match_id
    from pay_expenses e join matches m on m.id = e.match_id
    where e.deleted_at is null and e.match_id is not null
      and not exists (select 1 from pay_card_checks k where k.match_id = e.match_id)
    group by e.match_id
    having now() >= max(greatest(scorers_close_at(m), e.created_at + interval '12 hours'))
  loop
    insert into pay_card_checks (match_id) values (r.match_id) on conflict do nothing;
    for u in
      select distinct s.user_id from pay_shares s join pay_expenses e on e.id = s.expense_id
      where e.match_id = r.match_id and e.deleted_at is null and s.user_id <> e.payer_id
    loop
      continue when not pay_can_see(u) or pay_net(u) >= 0;
      if exists (select 1 from pay_cards where user_id = u and cleared_at is null) then
        -- già ammonito e ancora in debito: rosso (una volta sola), se non è il Leader titolare
        select role = 'leader' into is_titular from profiles where id = u;
        if not coalesce(is_titular, false) and not exists (select 1 from pay_cards where user_id = u and cleared_at is null and color = 'red') then
          insert into punishments (user_id, ends_at, reason, created_by)
          values (u, null, 'Quota del campo non pagata: finisce quando saldi e chi riceve conferma', null) returning id into pid;
          insert into pay_cards (user_id, color, match_id, punishment_id) values (u, 'red', r.match_id, pid);
          perform notify(array[u], 'pay_red', 'Cartellino rosso',
            'Hai ancora un debito del campo: sei in punizione finché non saldi e chi riceve conferma. In Conti puoi sempre pagare.', '/pagamenti');
        end if;
      else
        insert into pay_cards (user_id, color, match_id) values (u, 'yellow', r.match_id);
        select id into nag from achievements where name ilike '%nagali%' order by number limit 1;
        if nag is not null then
          insert into player_achievements (user_id, achievement_id, awarded_by, announced) values (u, nag, null, true)
          on conflict do nothing;
        end if;
        perform notify(array[u], 'pay_yellow', 'Cartellino giallo',
          'La quota del campo non è stata pagata entro le 12. Salda in Conti: se alla prossima partita hai ancora un debito, è rosso.', '/pagamenti');
      end if;
    end loop;
  end loop;
end $$;
revoke execute on function public.pay_cards_tick() from public, anon, authenticated;
select cron.schedule('pay-cards', '*/10 * * * *', $$select public.pay_cards_tick()$$);

-- i miei cartellini in corso (per l'avviso all'apertura)
create or replace function public.pay_my_cards() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'color', color, 'created_at', created_at, 'seen', seen_at is not null) order by id), '[]'::jsonb)
  from pay_cards where user_id = auth.uid() and cleared_at is null
$$;
revoke execute on function public.pay_my_cards() from public, anon;
grant execute on function public.pay_my_cards() to authenticated;

create or replace function public.pay_card_seen(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update pay_cards set seen_at = coalesce(seen_at, now()) where id = p_id and user_id = auth.uid();
$$;
revoke execute on function public.pay_card_seen(bigint) from public, anon;
grant execute on function public.pay_card_seen(bigint) to authenticated;

-- cartellini in corso di tutti (solo il colore, niente importi): il segno accanto al nome
create or replace function public.pay_cards_active() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'color', color)), '[]'::jsonb)
  from (select user_id, case when bool_or(color = 'red') then 'red' else 'yellow' end as color
        from pay_cards where cleared_at is null group by user_id) x
  where is_active_member(auth.uid())
$$;
revoke execute on function public.pay_cards_active() from public, anon;
grant execute on function public.pay_cards_active() to authenticated;

-- promemoria a chi mi deve dei soldi: una volta al giorno per persona, dalle 13 (Roma)
create or replace function public.pay_remind(p_from uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); who text := display_name(auth.uid()); owed bigint;
  rome timestamp := now() at time zone 'Europe/Rome';
begin
  perform assert_not_punished();
  perform pay_require();
  select amount_cents into owed from pay_transfers() t where t.from_id = p_from and t.to_id = me;
  if owed is null then raise exception 'Questa persona non ti deve niente'; end if;
  if extract(hour from rome) < 13 then return 'early'; end if;
  if exists (select 1 from notifications where user_id = p_from and kind = 'pay_remind' and body like who || ' %'
             and (created_at at time zone 'Europe/Rome')::date = rome::date) then
    return 'already';
  end if;
  perform notify(array[p_from], 'pay_remind', 'Promemoria: hai un debito',
    who || ' ti ricorda che gli devi ' || pay_eur(owed::int) || '. Salda in Conti.', '/pagamenti');
  return 'sent';
end $$;
revoke execute on function public.pay_remind(uuid) from public, anon;
grant execute on function public.pay_remind(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Funzioni per saldare: come prima, ma usabili anche in punizione

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
end $$;
revoke execute on function public.pay_decide(bigint, boolean) from public, anon;
grant execute on function public.pay_decide(bigint, boolean) to authenticated;

create or replace function public.pay_save_methods(p_paypal text, p_iban text, p_holder text) returns void
language plpgsql security definer set search_path = public as $$
declare pp text; ib text;
begin
  -- niente assert_not_punished: anche chi è in punizione può saldare i conti (migrazione 64)
  perform pay_require();
  pp := nullif(regexp_replace(regexp_replace(trim(coalesce(p_paypal, '')), '^(https?://)?(www\.)?paypal\.me/', '', 'i'), '/.*$', ''), '');
  if pp is not null and pp !~ '^[A-Za-z0-9]{1,20}$' then raise exception 'Il nome PayPal.me può avere solo lettere e numeri (al massimo 20)'; end if;
  ib := nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g')), '');
  if ib is not null and not pay_iban_ok(ib) then raise exception 'L''IBAN non è valido: controlla di averlo scritto tutto'; end if;
  insert into pay_methods (user_id, paypal, iban, holder, updated_at)
  values (auth.uid(), pp, ib, nullif(trim(coalesce(p_holder, '')), ''), now())
  on conflict (user_id) do update set paypal = excluded.paypal, iban = excluded.iban, holder = excluded.holder, updated_at = now();
end $$;
revoke execute on function public.pay_save_methods(text, text, text) from public, anon;
grant execute on function public.pay_save_methods(text, text, text) to authenticated;

create or replace function public.pay_ask_methods(p_to uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); who text := display_name(auth.uid());
begin
  -- niente assert_not_punished: anche chi è in punizione può saldare i conti (migrazione 64)
  perform pay_require();
  if p_to is null or p_to = me then return false; end if;
  if not pay_can_see(p_to) then return false; end if;
  -- ha già i dati: niente da chiedere
  if exists (select 1 from pay_methods where user_id = p_to and (paypal is not null or iban is not null)) then return false; end if;
  if exists (select 1 from notifications where user_id = p_to and kind = 'pay_ask_methods'
             and created_at > now() - interval '12 hours' and body like who || ' %') then return false; end if;
  perform notify(array[p_to], 'pay_ask_methods', 'Aggiungi i dati di pagamento',
    who || ' vuole pagarti: aggiungi PayPal o IBAN in Conti.', '/pagamenti?dati=1');
  return true;
end $$;
revoke execute on function public.pay_ask_methods(uuid) from public, anon;
grant execute on function public.pay_ask_methods(uuid) to authenticated;


-- ---------------------------------------------------------------------------------------------
-- unione di un giocatore senza account con un account: anche i cartellini (copia della migrazione 62 con la riga nuova)
create or replace function public.merge_profiles(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g profiles;
begin
  if p_from = p_into then return; end if;
  select * into g from profiles where id = p_from;
  if not found then raise exception 'Profilo da collegare non trovato'; end if;

  -- prenotazioni, finestre, formazioni, conferme, marcatori, permessi sui voti: una riga per partita
  delete from bookings x where x.user_id = p_from and exists (select 1 from bookings y where y.user_id = p_into and y.match_id = x.match_id);
  update bookings set user_id = p_into where user_id = p_from;
  update bookings set placed_by = p_into where placed_by = p_from;
  delete from priority_windows x where x.user_id = p_from and exists (select 1 from priority_windows y where y.user_id = p_into and y.match_id = x.match_id);
  update priority_windows set user_id = p_into where user_id = p_from;
  delete from lineup x where x.user_id = p_from and exists (select 1 from lineup y where y.user_id = p_into and y.match_id = x.match_id);
  update lineup set user_id = p_into where user_id = p_from;
  delete from result_reviews x where x.user_id = p_from and exists (select 1 from result_reviews y where y.user_id = p_into and y.match_id = x.match_id);
  update result_reviews set user_id = p_into where user_id = p_from;
  delete from scorers x where x.user_id = p_from and exists (select 1 from scorers y where y.user_id = p_into and y.match_id = x.match_id);
  update scorers set user_id = p_into where user_id = p_from;
  update scorers set updated_by = p_into where updated_by = p_from;
  delete from vote_grants x where x.user_id = p_from and exists (select 1 from vote_grants y where y.user_id = p_into and y.match_id = x.match_id);
  update vote_grants set user_id = p_into where user_id = p_from;

  -- voti: niente voti a sé stessi e niente doppioni dello stesso votante
  delete from player_votes where (voter_id = p_into and target_id = p_from) or (voter_id = p_from and target_id = p_into);
  delete from player_votes x where x.target_id = p_from
    and exists (select 1 from player_votes y where y.match_id = x.match_id and y.voter_id = x.voter_id and y.target_id = p_into);
  update player_votes set target_id = p_into where target_id = p_from;
  delete from player_votes x where x.voter_id = p_from
    and exists (select 1 from player_votes y where y.match_id = x.match_id and y.voter_id = p_into and y.target_id = x.target_id);
  update player_votes set voter_id = p_into where voter_id = p_from;
  update mvp_votes set white_pick = null where voter_id = p_into and white_pick = p_from;
  update mvp_votes set black_pick = null where voter_id = p_into and black_pick = p_from;
  update mvp_votes set white_pick = p_into where white_pick = p_from;
  update mvp_votes set black_pick = p_into where black_pick = p_from;
  delete from mvp_votes x where x.voter_id = p_from and exists (select 1 from mvp_votes y where y.voter_id = p_into and y.match_id = x.match_id);
  update mvp_votes set white_pick = null where voter_id = p_from and white_pick = p_into;
  update mvp_votes set black_pick = null where voter_id = p_from and black_pick = p_into;
  update mvp_votes set voter_id = p_into where voter_id = p_from;

  -- tutto il resto
  update chat_messages set user_id = p_into where user_id = p_from;
  update notifications set user_id = p_into where user_id = p_from;
  update punishments set user_id = p_into where user_id = p_from;
  update punishments set created_by = p_into where created_by = p_from;
  update punishments set revoked_by = p_into where revoked_by = p_from;
  update matches set lineup_delegate = p_into where lineup_delegate = p_from;
  update matches set lineup_proposed_by = p_into where lineup_proposed_by = p_from;
  update results set entered_by = p_into where entered_by = p_from;
  update leadership_delegation set delegate_id = p_into where delegate_id = p_from;
  update leader_points set user_id = p_into where user_id = p_from;
  update leader_points set created_by = p_into where created_by = p_from;

  -- pagamenti (migrazione 54): spese, quote, saldi; i metodi di pagamento restano quelli dell'account
  update pay_expenses set payer_id = p_into where payer_id = p_from;
  update pay_expenses set created_by = p_into where created_by = p_from;
  update pay_shares x set amount_cents = x.amount_cents + y.amount_cents
    from pay_shares y where y.user_id = p_from and x.user_id = p_into and x.expense_id = y.expense_id;
  delete from pay_shares x where x.user_id = p_from and exists (select 1 from pay_shares y where y.user_id = p_into and y.expense_id = x.expense_id);
  update pay_shares set user_id = p_into where user_id = p_from;
  update pay_settlements set from_id = p_into where from_id = p_from;
  update pay_settlements set to_id = p_into where to_id = p_from;
  update pay_settlements set created_by = p_into where created_by = p_from;
  update pay_settlements set decided_by = p_into where decided_by = p_from;
  delete from pay_settlements where from_id = to_id;
  delete from pay_methods where user_id = p_from;
  update pay_settings set preview_users = array_remove(preview_users, p_from) where id = 1;

  -- dati anagrafici: restano quelli dell'account, i mancanti si prendono dal profilo
  update profiles p set
    last_name = coalesce(p.last_name, g.last_name),
    nickname = coalesce(p.nickname, g.nickname),
    field_role = coalesce(p.field_role, g.field_role),
    birth_date = coalesce(p.birth_date, g.birth_date),
    weight_kg = coalesce(p.weight_kg, g.weight_kg),
    height_cm = coalesce(p.height_cm, g.height_cm),
    stats_since = coalesce(p.stats_since, g.stats_since),
    active = true, pending = false
  where p.id = p_into;

  -- sticker: si tengono quelli del giocatore senza account che l'altro non ha già (senza riannunciarli)
  insert into player_achievements (user_id, achievement_id, unlocked_at, awarded_by, announced)
  select p_into, achievement_id, unlocked_at, awarded_by, false from player_achievements where user_id = p_from
  on conflict do nothing;
  delete from player_achievements where user_id = p_from;

  -- Leader News (migrazione 62): l'autore passa al profilo che resta; si tiene la lettura più avanti dei due
  update leader_news set created_by = p_into where created_by = p_from;
  update profiles set news_seen_id = greatest(news_seen_id, coalesce((select news_seen_id from profiles where id = p_from), 0)) where id = p_into;

  -- cartellini dei Pagamenti (migrazione 64)
  update pay_cards set user_id = p_into where user_id = p_from;

  delete from profiles where id = p_from;
end $$;

