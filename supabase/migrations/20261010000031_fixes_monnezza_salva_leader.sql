-- =====================================================================
-- Correzioni e due premi
--  * avviso del Leader che cambia lo stato di un giocatore: con «sceglie il
--    Leader» i posti non sono numerati e il testo risultava vuoto (errore
--    "null value in column body"); stesso difetto nelle azioni rapide;
--    chi va tra i disponibili ora riceve il messaggio giusto; con «sceglie il
--    Leader» il giocatore riceveva due avvisi per la stessa azione: ora uno;
--  * Monnezza: solo chi era nella formazione ufficiale e si ritira da sé;
--  * nuovo premio automatico «Salva Leader»: dice «ci sono» da sé nelle 24 ore
--    prima della partita ed entra in squadra.
-- =====================================================================

-- quando un titolare della formazione ufficiale si è ritirato da sé, e quando ha detto «ci sono»
alter table public.bookings add column left_official_lineup boolean not null default false;
alter table public.bookings add column present_at timestamptz;

create or replace function public.trg_bookings_flags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- il ritiro si registra prima che il giocatore esca dalla formazione: qui la riga c'è ancora
  if tg_op = 'UPDATE' and old.list = 'team' and new.list <> 'team' and auth.uid() = new.user_id
     and exists (select 1 from matches m where m.id = new.match_id and m.lineup_status = 'official')
     and exists (select 1 from lineup l where l.match_id = new.match_id and l.user_id = new.user_id) then
    new.left_official_lineup := true;
  end if;
  -- «ci sono» detto dal giocatore stesso (non l'inserimento automatico del Leader alla creazione della partita)
  if new.choice = 'present' and (tg_op = 'INSERT' or old.choice is distinct from 'present')
     and auth.uid() = new.user_id and new.sort_key is distinct from '-infinity'::timestamptz then
    new.present_at := now();
  end if;
  return new;
end $$;
create trigger bookings_flags before insert or update on public.bookings
  for each row execute function public.trg_bookings_flags();

-- i premi si ricontrollano anche quando cambia una risposta (per Salva Leader)
drop trigger achievements_on_bookings on public.bookings;
create trigger achievements_on_bookings after insert or update of choice, list, withdrew, left_official_lineup on public.bookings
  for each statement execute function public.trg_check_achievements();

-- Monnezza con la regola nuova; quelli assegnati in automatico con la regola vecchia si tolgono
-- (lo storico non dice se chi si ritirava era nella formazione ufficiale); quelli dati dal Leader restano
update public.achievements set mission = 'Ritirarsi dopo essere stato messo dal Leader nella formazione ufficiale.' where code = 'ritiro';
delete from public.player_achievements pa using public.achievements a
 where a.id = pa.achievement_id and a.code = 'ritiro' and pa.awarded_by is null;

-- Salva Leader: se il Leader l'ha già creato a mano con questo nome diventa automatico (immagine e assegnazioni restano)
do $$
declare v_id uuid;
begin
  select id into v_id from public.achievements
   where code is null and lower(regexp_replace(name, '[^[:alpha:]]', '', 'g')) = 'salvaleader'
   order by number limit 1;
  if v_id is not null then
    update public.achievements set code = 'salva_leader',
           mission = 'Prenotarsi nelle 24 ore prima della partita ed entrare in squadra.' where id = v_id;
  else
    insert into public.achievements (code, number, name, mission)
    values ('salva_leader', (select coalesce(max(number), 0) + 1 from public.achievements), 'Salva Leader',
            'Prenotarsi nelle 24 ore prima della partita ed entrare in squadra.');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------
create or replace function public.leader_book(p_match uuid, p_user uuid, p_choice text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_res jsonb;
  v_when text;
  v_who text := display_name(v_actor);
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può prenotare per altri'; end if;
  v_res := _book(v_actor, p_user, p_match, p_choice, false);

  -- niente avviso se il Leader modifica sé stesso; con «sceglie il Leader» lo manda già _book (niente doppioni)
  if p_user is distinct from v_actor and coalesce((select booking_mode from matches where id = p_match), 'order') <> 'free' then
    select fmt_when(starts_at) into v_when from matches where id = p_match;
    perform notify(
      array[p_user],
      'placed_by_leader',
      case v_res->>'list'
        when 'team' then 'Sei in squadra'
        when 'reserve' then 'Sei tra le riserve'
        when 'pending' then 'Sei tra i disponibili'
        else 'Segnato come assente' end,
      -- con «sceglie il Leader» i posti non sono numerati: il numero c'è solo se esiste
      case v_res->>'list'
        when 'team' then v_who || ' ti ha inserito per ' || v_when || coalesce(': hai il numero ' || (v_res->>'slot'), '') || '.'
        when 'reserve' then v_who || ' ti ha messo tra le riserve per ' || v_when || coalesce(': sei il numero ' || (v_res->>'slot'), '') || '.'
        when 'pending' then v_who || ' ti ha segnato disponibile per ' || v_when || ': titolari e riserve li sceglie il Leader.'
        else v_who || ' ti ha segnato come assente per ' || v_when || '.' end,
      '/partita/' || p_match,
      p_match,
      case when v_res->>'list' = 'out' then null
           else '[{"action":"absent","title":"Non posso"}]'::jsonb end
    );
  end if;

  return v_res;
end $$;

create or replace function public.quick_action(p_user uuid, p_match uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_res jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);

  case p_action
    when 'present', 'absent', 'reserve' then
      v_res := book(p_match, p_action);
      return case
        when v_res->>'list' = 'team' then 'Sei dentro' || coalesce(' con il numero ' || (v_res->>'slot'), '') || '.'
        when v_res->>'list' = 'reserve' then 'Sei tra le riserve' || coalesce(' con il numero ' || (v_res->>'slot'), '') || '.'
        when v_res->>'list' = 'pending' then 'Sei tra i disponibili: titolari e riserve li sceglie il Leader.'
        else 'Segnato come assente.' end;
    when 'reserve_yes' then
      perform reserve_reply(p_match, 'confirmed');
      return 'Grazie, sei disponibile come riserva.';
    when 'reserve_no' then
      perform reserve_reply(p_match, 'declined');
      return 'Ok, risulti assente.';
    when 'confirm_result' then
      perform review_result(p_match, true);
      return 'Risultato confermato.';
    else
      raise exception 'Azione sconosciuta';
  end case;
end $$;

create or replace function public.check_achievements() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with
  -- partite giocate dal gruppo, in ordine
  pm as (select id, starts_at, row_number() over (order by starts_at, id) as k from matches where status = 'played'),
  -- presenza di ogni giocatore a ogni partita del gruppo (da quando è iscritto)
  pres as (
    select p.id as user_id, pm.k,
           exists (select 1 from bookings b where b.match_id = pm.id and b.user_id = p.id and b.list = 'team') as here
    from profiles p cross join pm
    where p.active and pm.starts_at >= p.created_at - interval '1 day'
  ),
  pres_isl as (select user_id, k, here, k - row_number() over (partition by user_id, here order by k) as grp from pres),
  -- partite giocate da ognuno con risultato omologato: gol, autogol, esito
  pf as (
    select l.user_id, m.id as match_id, coalesce(s.goals, 0) as goals,
           case when r.diff = 0 then 'D' when (r.diff > 0) = (l.team = 'white') then 'W' else 'L' end as outcome,
           exists (select 1 from scorers x where x.match_id = m.id) as scorers_in,
           row_number() over (partition by l.user_id order by m.starts_at, m.id) as n
    from lineup l
    join matches m on m.id = l.match_id and m.status = 'played'
    join results r on r.match_id = m.id and r.status = 'homologated'
    join profiles p on p.id = l.user_id and p.active
    left join scorers s on s.match_id = m.id and s.user_id = l.user_id
  ),
  goal_isl as (select user_id, n, goals > 0 as scored, n - row_number() over (partition by user_id, goals > 0 order by n) as grp from pf),
  loss_isl as (select user_id, n, outcome = 'L' as lost, n - row_number() over (partition by user_id, outcome = 'L' order by n) as grp from pf),
  top_scorer as (
    select pf.user_id, pf.match_id from pf
    where pf.goals > 0 and pf.goals = (select max(x.goals) from pf x where x.match_id = pf.match_id)
  ),
  earned as (
    -- 1. presente per 5 partite consecutive
    select distinct user_id, 'presenze_5' as code from pres_isl where here group by user_id, grp having count(*) >= 5
    -- 2. 0 gol in una partita (con i marcatori inseriti)
    union select distinct user_id, 'zero_gol' from pf where goals = 0 and scorers_in
    -- 3. miglior marcatore della partita per almeno 5 partite
    union select user_id, 'asso_5' from top_scorer group by user_id having count(*) >= 5
    -- 4. un autogol
    union select distinct s.user_id, 'autogol' from scorers s join matches m on m.id = s.match_id and m.status = 'played'
          join profiles p on p.id = s.user_id and p.active where s.own_goals > 0
    -- 5. di nuovo presente dopo 5 assenze consecutive
    union select distinct a.user_id, 'ritorno_5' from (
            select user_id, max(k) as last_k from pres_isl where not here group by user_id, grp having count(*) >= 5
          ) a where exists (select 1 from pres p2 where p2.user_id = a.user_id and p2.k = a.last_k + 1 and p2.here)
    -- 6. almeno un gol per 6 partite di fila
    union select distinct user_id, 'gol_6' from goal_isl where scored group by user_id, grp having count(*) >= 6
    -- 7. 4 sconfitte di fila
    union select distinct user_id, 'sconfitte_4' from loss_isl where lost group by user_id, grp having count(*) >= 4
    -- 8. si ritira da sé dopo essere stato messo dal Leader nella formazione ufficiale
    union select distinct b.user_id, 'ritiro' from bookings b join profiles p on p.id = b.user_id and p.active where b.left_official_lineup
    -- 9. Salva Leader: dice «ci sono» da sé nelle 24 ore prima della partita ed entra in squadra
    union select distinct b.user_id, 'salva_leader' from bookings b
          join matches m on m.id = b.match_id and m.status <> 'cancelled'
          join profiles p on p.id = b.user_id and p.active
          where b.list = 'team' and b.choice = 'present' and b.placed_by is null and b.present_at is not null
            and b.present_at >= m.starts_at - interval '24 hours' and b.present_at < m.starts_at
  ),
  ins as (
    insert into player_achievements (user_id, achievement_id)
    select e.user_id, a.id from earned e join achievements a on a.code = e.code
    on conflict do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

revoke execute on function public.trg_bookings_flags() from public, anon, authenticated;
