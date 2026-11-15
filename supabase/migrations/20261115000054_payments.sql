-- =====================================================================
-- Pagamenti (decisioni del proprietario, 15/11/2026)
-- Conti tipo Splitwise: spese divise in quote, saldi netti, debiti semplificati
-- (il numero minimo di passaggi). I soldi non passano dall'app: «Salda» apre
-- PayPal.me con l'importo o mostra l'IBAN; chi paga segna «Ho pagato», chi riceve
-- conferma «Ricevuto» (il Leader può sempre segnare o correggere).
-- In anteprima come il FantaLeader: Leader ed elenco (all'inizio «Bobbo»), poi a tutti;
-- chi non ha i poteri del Leader vede solo i propri conti.
-- Importi in centesimi (interi): niente arrotondamenti.
-- =====================================================================

create table public.pay_settings (
  id            int primary key default 1 check (id = 1),
  public        boolean not null default false,
  preview_users uuid[] not null default '{}'
);
insert into public.pay_settings (id, preview_users) values (1, coalesce(
  (select array_agg(id) from public.profiles where active and lower(trim(nickname)) = 'bobbo'), '{}'));

create table public.pay_methods (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  paypal     text check (paypal ~ '^[A-Za-z0-9]{1,20}$'),
  iban       text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  holder     text check (char_length(holder) <= 80),
  updated_at timestamptz not null default now()
);

create table public.pay_expenses (
  id           bigint generated always as identity primary key,
  title        text not null check (char_length(trim(title)) between 1 and 80),
  amount_cents int not null check (amount_cents > 0 and amount_cents <= 10000000),
  payer_id     uuid not null references public.profiles (id) on delete cascade,
  match_id     uuid references public.matches (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index on public.pay_expenses (created_at desc);

create table public.pay_shares (
  expense_id   bigint not null references public.pay_expenses (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  amount_cents int not null check (amount_cents >= 0),
  primary key (expense_id, user_id)
);
create index on public.pay_shares (user_id);

create table public.pay_settlements (
  id           bigint generated always as identity primary key,
  from_id      uuid not null references public.profiles (id) on delete cascade,
  to_id        uuid not null references public.profiles (id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  method       text not null check (method in ('paypal', 'iban', 'cash')),
  status       text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  check (from_id <> to_id)
);
create index on public.pay_settlements (to_id, status);
create index on public.pay_settlements (from_id, status);

-- tabelle: RLS attiva, nessuna lettura diretta (tutto passa da pay_overview), scritture solo da funzioni
do $$ declare t text; begin
  foreach t in array array['pay_settings','pay_methods','pay_expenses','pay_shares','pay_settlements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- chi vede i Pagamenti
create or replace function public.pay_can_see(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_active_member(p_uid) and (
           has_leader_powers(p_uid)
           or exists (select 1 from pay_settings where id = 1 and (public or p_uid = any (preview_users)))), false)
$$;
revoke execute on function public.pay_can_see(uuid) from public, anon;
grant execute on function public.pay_can_see(uuid) to authenticated;

create or replace function public.pay_visible() returns boolean
language sql stable security definer set search_path = public as $$ select pay_can_see() $$;
revoke execute on function public.pay_visible() from public, anon;
grant execute on function public.pay_visible() to authenticated;

create or replace function public.pay_require() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not pay_can_see() then raise exception 'I Pagamenti non sono ancora disponibili per te'; end if;
end $$;
revoke execute on function public.pay_require() from public, anon, authenticated;

-- importo leggibile per gli avvisi: 3 € / 3,50 €
create or replace function public.pay_eur(p_cents int) returns text
language sql immutable set search_path = public as $$
  select case when p_cents % 100 = 0 then (p_cents / 100)::text
              else replace(to_char(p_cents / 100.0, 'FM999999990.00'), '.', ',') end || ' €'
$$;
revoke execute on function public.pay_eur(int) from public, anon, authenticated;

-- IBAN: maiuscolo senza spazi, controllo internazionale (modulo 97)
create or replace function public.pay_iban_ok(p_iban text) returns boolean
language plpgsql immutable set search_path = public as $$
declare s text; d text := ''; c text; r int := 0; i int;
begin
  if p_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then return false; end if;
  s := substr(p_iban, 5) || substr(p_iban, 1, 4);
  for i in 1 .. length(s) loop
    c := substr(s, i, 1);
    d := d || case when c ~ '[0-9]' then c else (ascii(c) - 55)::text end;
  end loop;
  for i in 1 .. length(d) loop r := (r * 10 + substr(d, i, 1)::int) % 97; end loop;
  return r = 1;
end $$;
revoke execute on function public.pay_iban_ok(text) from public, anon, authenticated;

-- saldo netto di ognuno: + deve ricevere, - deve dare (le conferme in attesa non contano ancora)
create or replace function public.pay_balances() returns table (user_id uuid, net_cents bigint)
language sql stable security definer set search_path = public as $$
  select u, sum(v)::bigint from (
    select e.payer_id as u, e.amount_cents::bigint as v from pay_expenses e where e.deleted_at is null
    union all
    select s.user_id, -s.amount_cents from pay_shares s join pay_expenses e on e.id = s.expense_id where e.deleted_at is null
    union all
    select from_id, amount_cents from pay_settlements where status = 'confirmed'
    union all
    select to_id, -amount_cents from pay_settlements where status = 'confirmed'
  ) x group by u having sum(v) <> 0
$$;
revoke execute on function public.pay_balances() from public, anon, authenticated;

-- debiti semplificati: il creditore più grande con il debitore più grande, finché non si pareggia
create or replace function public.pay_transfers() returns table (from_id uuid, to_id uuid, amount_cents bigint)
language plpgsql stable security definer set search_path = public as $$
declare cr uuid[]; crv bigint[]; db uuid[]; dbv bigint[]; i int := 1; j int := 1; m bigint;
begin
  select coalesce(array_agg(b.user_id order by b.net_cents desc, b.user_id), '{}'), coalesce(array_agg(b.net_cents order by b.net_cents desc, b.user_id), '{}')
    into cr, crv from pay_balances() b where b.net_cents > 0;
  select coalesce(array_agg(b.user_id order by b.net_cents, b.user_id), '{}'), coalesce(array_agg(-b.net_cents order by b.net_cents, b.user_id), '{}')
    into db, dbv from pay_balances() b where b.net_cents < 0;
  while i <= coalesce(array_length(cr, 1), 0) and j <= coalesce(array_length(db, 1), 0) loop
    m := least(crv[i], dbv[j]);
    from_id := db[j]; to_id := cr[i]; amount_cents := m; return next;
    crv[i] := crv[i] - m; dbv[j] := dbv[j] - m;
    if crv[i] = 0 then i := i + 1; end if;
    if dbv[j] = 0 then j := j + 1; end if;
  end loop;
end $$;
revoke execute on function public.pay_transfers() from public, anon, authenticated;

-- tutto quello che serve alla pagina, già filtrato: chi non ha i poteri del Leader vede solo ciò che lo riguarda
create or replace function public.pay_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); boss boolean := has_leader_powers(auth.uid()); tr jsonb; people uuid[];
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
    'settings', case when boss then (select jsonb_build_object('public', public, 'preview_users', preview_users) from pay_settings where id = 1) end
  );
end $$;
revoke execute on function public.pay_overview() from public, anon;
grant execute on function public.pay_overview() to authenticated;

-- nuova spesa: chi paga anticipa, le quote si dividono in parti uguali (i centesimi in più ai primi)
create or replace function public.pay_add_expense(p_title text, p_amount_cents int, p_payer uuid, p_users uuid[], p_match uuid default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; q int; r int; eid bigint; who uuid[]; k int := 0; u uuid;
begin
  perform assert_not_punished();
  perform pay_require();
  if p_payer is distinct from me and not has_leader_powers(me) then raise exception 'Puoi inserire solo le spese che hai pagato tu'; end if;
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
  return eid;
end $$;
revoke execute on function public.pay_add_expense(text, int, uuid, uuid[], uuid) from public, anon;
grant execute on function public.pay_add_expense(text, int, uuid, uuid[], uuid) to authenticated;

-- togliere una spesa: chi l'ha inserita, chi l'ha pagata o il Leader
create or replace function public.pay_delete_expense(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare e pay_expenses;
begin
  perform assert_not_punished();
  perform pay_require();
  select * into e from pay_expenses where id = p_id and deleted_at is null;
  if e.id is null then raise exception 'Spesa non trovata'; end if;
  if auth.uid() not in (coalesce(e.created_by, e.payer_id), e.payer_id) and not has_leader_powers() then
    raise exception 'Può toglierla solo chi l''ha inserita o il Leader';
  end if;
  update pay_expenses set deleted_at = now() where id = p_id;
end $$;
revoke execute on function public.pay_delete_expense(bigint) from public, anon;
grant execute on function public.pay_delete_expense(bigint) to authenticated;

-- «Ho pagato»: chi deve segna il pagamento, chi riceve conferma. Il Leader può segnarlo per altri (già confermato).
create or replace function public.pay_mark_paid(p_to uuid, p_amount_cents int, p_method text, p_from uuid default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); src uuid := coalesce(p_from, auth.uid()); boss boolean := has_leader_powers(auth.uid()); sid bigint;
begin
  perform assert_not_punished();
  perform pay_require();
  if src is distinct from me and not boss then raise exception 'Puoi segnare solo i tuoi pagamenti'; end if;
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

-- «Ricevuto» / «Non ricevuto»: chi riceve (o il Leader)
create or replace function public.pay_decide(p_id bigint, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s pay_settlements; me uuid := auth.uid();
begin
  perform assert_not_punished();
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

-- i propri metodi di pagamento
create or replace function public.pay_save_methods(p_paypal text, p_iban text, p_holder text) returns void
language plpgsql security definer set search_path = public as $$
declare pp text; ib text;
begin
  perform assert_not_punished();
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

-- il Leader decide chi vede i Pagamenti
create or replace function public.pay_set_visibility(p_public boolean, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader decide chi vede i Pagamenti'; end if;
  update pay_settings set public = coalesce(p_public, false),
    preview_users = coalesce((select array_agg(distinct u) from unnest(coalesce(p_users, '{}')) u
                              where exists (select 1 from profiles p where p.id = u and p.active and not p.guest)), '{}')
  where id = 1;
end $$;
revoke execute on function public.pay_set_visibility(boolean, uuid[]) from public, anon;
grant execute on function public.pay_set_visibility(boolean, uuid[]) to authenticated;

-- collegando un account a un giocatore senza account, anche i conti passano all'account
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

  delete from profiles where id = p_from;
end $$;

