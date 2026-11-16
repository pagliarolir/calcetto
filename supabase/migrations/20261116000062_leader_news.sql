-- Leader News: un avviso scritto dal Leader che ognuno vede una volta, al primo avvio dell'app dopo la pubblicazione
-- (riquadro «Leader News» come quello delle novità dell'app). Si vedono solo le notizie degli ultimi 14 giorni:
-- chi entra nel gruppo dopo non si trova tutto l'arretrato. Il testo è semplice (mai HTML).

create table public.leader_news (
  id bigserial primary key,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.leader_news enable row level security;
revoke all on public.leader_news from anon, authenticated;
grant select, insert, update, delete on public.leader_news to service_role;

-- fin dove ognuno ha già letto (colonna del proprio profilo: non riguarda altri giocatori)
alter table public.profiles add column if not exists news_seen_id bigint not null default 0;

-- pubblica (solo chi ha i poteri del Leader); chi la scrive non deve rivederla
create or replace function public.leader_news_post(p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); nid bigint;
begin
  if not has_leader_powers(me) then raise exception 'Solo il Leader può scrivere le Leader News'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Scrivi il testo della notizia'; end if;
  if char_length(trim(p_body)) > 1000 then raise exception 'Massimo 1000 caratteri'; end if;
  insert into leader_news (body, created_by) values (trim(p_body), me) returning id into nid;
  update profiles set news_seen_id = greatest(news_seen_id, nid) where id = me;
  return nid;
end $$;
revoke execute on function public.leader_news_post(text) from public, anon;
grant execute on function public.leader_news_post(text) to authenticated;

-- notizie non ancora lette da chi apre l'app (al massimo 5, dalla più vecchia)
create or replace function public.leader_news_pending() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at) order by n.id), '[]'::jsonb)
  from (
    select n.* from leader_news n
    where is_active_member(auth.uid()) and n.deleted_at is null and n.created_at > now() - interval '14 days'
      and n.id > coalesce((select news_seen_id from profiles where id = auth.uid()), 0)
    order by n.id desc limit 5
  ) n
$$;
revoke execute on function public.leader_news_pending() from public, anon;
grant execute on function public.leader_news_pending() to authenticated;

-- «letto»: fino a questa notizia compresa
create or replace function public.leader_news_seen(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update profiles set news_seen_id = greatest(news_seen_id, coalesce(p_id, 0)) where id = auth.uid();
$$;
revoke execute on function public.leader_news_seen(bigint) from public, anon;
grant execute on function public.leader_news_seen(bigint) to authenticated;

-- per la Gestione: le ultime pubblicate, con quanti le hanno già lette
create or replace function public.leader_news_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_leader_powers(auth.uid()) then raise exception 'Solo il Leader'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'id')::bigint desc) from (
    select jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at, 'created_by', n.created_by,
             'seen', (select count(*) from profiles p where p.active and not p.guest and p.news_seen_id >= n.id),
             'members', (select count(*) from profiles p where p.active and not p.guest)) x
    from leader_news n where n.deleted_at is null order by n.id desc limit 10) y), '[]'::jsonb);
end $$;
revoke execute on function public.leader_news_list() from public, anon;
grant execute on function public.leader_news_list() to authenticated;

-- togli una notizia (chi non l'ha ancora vista non la vedrà più)
create or replace function public.leader_news_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers(auth.uid()) then raise exception 'Solo il Leader'; end if;
  update leader_news set deleted_at = now() where id = p_id and deleted_at is null;
end $$;
revoke execute on function public.leader_news_delete(bigint) from public, anon;
grant execute on function public.leader_news_delete(bigint) to authenticated;

-- unione di un giocatore senza account con un account: anche le Leader News (copia della migrazione 54 con le righe nuove)
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

  delete from profiles where id = p_from;
end $$;
