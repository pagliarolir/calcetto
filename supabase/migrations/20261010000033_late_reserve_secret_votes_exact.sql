-- =====================================================================
-- Prenotazioni dopo la chiusura, segretezza dei voti, risultato esatto
--  * chi non ha risposto entro la chiusura può ancora prenotarsi, ma come riserva
--    (in coda); chi aveva già risposto cambia solo tramite il Leader;
--  * pagelle: medie visibili dopo almeno 2 votanti; il migliore in campo resta
--    segreto finché non ha votato il 60% di chi ha giocato (6 su 10), anche nelle
--    statistiche (o fino alla chiusura delle votazioni); il Leader vede tutto;
--  * il risultato si inserisce solo esatto (niente più «chi ha vinto e di quanto»).
-- Funzioni esistenti adattate con modifiche mirate al testo originale.
-- =====================================================================

create or replace function public._book(
  p_actor uuid, p_user uuid, p_match uuid, p_choice text, p_system boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s app_settings;
  m matches;
  cur bookings;
  v_leader uuid := titular_leader();
  v_is_leader boolean := (p_user = v_leader);
  v_forced boolean := (p_actor is distinct from p_user) and not p_system;
  v_team_before int;
  v_team_after int;
  v_late boolean;
  v_new_list text;
  v_moved uuid;
  v_name text := display_name(p_user);
  v_url text := '/partita/' || p_match;
  v_slot int;
  v_size int;
  v_after_close boolean := false;
begin
  if p_choice not in ('present','absent','reserve') then raise exception 'Scelta non valida'; end if;
  select * into s from app_settings where id = 1;

  -- blocco sulla partita: le prenotazioni concorrenti vengono serializzate
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  v_size := m.players_per_team * 2;   -- 5 contro 5 = 10 posti, 6 contro 6 = 12, ...
  if m.status <> 'scheduled' then raise exception 'Le prenotazioni per questa partita sono chiuse'; end if;
  if now() >= m.starts_at then raise exception 'La partita è già iniziata'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Utente non attivo'; end if;
  if v_forced and not has_leader_powers(p_actor) then raise exception 'Solo il Leader può prenotare per altri'; end if;
  if v_is_leader and p_choice = 'reserve' then
    raise exception 'Il Leader è sempre il numero 1: scegli presente o assente';
  end if;

  if not (p_system or v_forced or v_is_leader) and now() < m.bookings_open_at
     and not exists (select 1 from priority_windows w
                     where w.match_id = p_match and w.user_id = p_user and w.opens_at <= now()) then
    raise exception 'Le prenotazioni aprono %',
      fmt_when(m.bookings_open_at);
  end if;

  -- chiusura delle prenotazioni: dopo, cambia solo il Leader (fino all'inizio)
  if not (p_system or v_forced or v_is_leader or has_leader_powers(p_actor)) and now() >= m.bookings_close_at then
    -- chi non aveva ancora risposto può ancora prenotarsi, ma solo come riserva (o dire che non c'è);
    -- chi aveva già risposto, per cambiare passa dal Leader
    if exists (select 1 from bookings where match_id = p_match and user_id = p_user) then
      raise exception 'Le prenotazioni si sono chiuse %. Per cambiare, scrivi al Leader.', fmt_when(m.bookings_close_at);
    end if;
    v_after_close := true;
  end if;

  -- REQ-021: il Leader titolare ha sempre la sua riga (anche se la partita è nata prima di lui)
  if v_leader is not null and not exists (select 1 from bookings where match_id = p_match and user_id = v_leader) then
    insert into bookings (match_id, user_id, choice, list, sort_key) values (p_match, v_leader, 'present', 'team', '-infinity');
  end if;

  -- Modalità "sceglie il Leader": nessun ordine. I giocatori dicono solo se ci sono
  -- (diventano disponibili); titolari e riserve li decide il Leader.
  if m.booking_mode = 'free' then
    select * into cur from bookings where match_id = p_match and user_id = p_user;
    if p_choice = 'reserve' and not (v_forced or p_system or v_after_close) then
      raise exception 'In questa partita titolari e riserve li sceglie il Leader: rispondi Ci sono o Non ci sono';
    end if;
    v_new_list := case
      when p_choice = 'absent' then 'out'
      when v_is_leader then 'team'
      when v_forced then case p_choice when 'present' then 'team' else 'reserve' end
      when cur.list in ('team', 'reserve') then cur.list      -- già scelto dal Leader: resta dov'è
      else 'pending' end;
    if v_after_close and v_new_list in ('team', 'pending') then v_new_list := 'reserve'; end if;   -- dopo la chiusura: riserva
    if v_new_list = 'team' and coalesce(cur.list, '') <> 'team'
       and (select count(*) from bookings where match_id = p_match and list = 'team') >= v_size then
      raise exception 'I titolari sono già % su %: sposta prima qualcuno tra le riserve', v_size, v_size;
    end if;
    insert into bookings as b (match_id, user_id, choice, list, sort_key, placed_by, updated_at)
    values (p_match, p_user, p_choice, v_new_list, clock_timestamp(), case when v_forced then p_actor end, now())
    on conflict (match_id, user_id) do update set
      choice = excluded.choice, list = excluded.list, updated_at = now(),
      withdrew = b.withdrew or (b.list = 'team' and excluded.list <> 'team'),
      sort_key = case when b.list = excluded.list then b.sort_key else excluded.sort_key end,
      placed_by = case when v_forced then excluded.placed_by when excluded.list = 'out' then null else b.placed_by end;
    if v_new_list <> 'team' and coalesce(cur.list, '') = 'team' then
      delete from lineup where match_id = p_match and user_id = p_user;
      perform notify_lineup_change(p_match, v_name || ' non c''è più.');
    end if;
    if v_forced then
      perform notify(array[p_user], 'placed_by_leader', 'Il Leader ha aggiornato la tua presenza',
        case v_new_list when 'team' then 'Sei titolare' when 'reserve' then 'Sei tra le riserve' else 'Sei segnato assente' end
          || ' per ' || fmt_when(m.starts_at) || '.', v_url, p_match);
    end if;
    return jsonb_build_object('list', v_new_list, 'slot', null);
  end if;

  -- dopo la chiusura chi non aveva risposto è una riserva «se serve»: non occupa da solo i posti liberi
  -- (entra se un titolare si ritira, come le altre riserve, o se lo sposta il Leader)
  if v_after_close and p_choice = 'present' then p_choice := 'reserve'; end if;

  select * into cur from bookings where match_id = p_match and user_id = p_user;
  select count(*) into v_team_before from bookings where match_id = p_match and list = 'team';
  v_late := now() > m.starts_at - interval '24 hours';

  -- dove finisce l'utente
  if p_choice = 'present' then
    if cur.list = 'team' or v_team_before < v_size or v_is_leader or v_forced then
      v_new_list := 'team';           -- REQ-017: se c'è posto entra subito
    else
      v_new_list := 'reserve';        -- REQ-014: oltre i 10 si scala tra le riserve
    end if;
  elsif p_choice = 'reserve' then
    v_new_list := 'reserve';          -- REQ-013
  else
    v_new_list := 'out';
  end if;
  if v_after_close and v_new_list = 'team' then v_new_list := 'reserve'; end if;   -- dopo la chiusura: riserva, in coda

  insert into bookings as b (match_id, user_id, choice, list, sort_key, placed_by, updated_at)
  values (p_match, p_user, p_choice, v_new_list, clock_timestamp(),
          case when v_forced then p_actor end, now())
  on conflict (match_id, user_id) do update set
    choice     = excluded.choice,
    list       = excluded.list,
    -- chi resta nella stessa lista mantiene la posizione; chi cambia lista va in coda
    sort_key   = case when b.list = excluded.list then b.sort_key else excluded.sort_key end,
    placed_by  = case when v_forced then excluded.placed_by
                      when excluded.list = 'out' then null else b.placed_by end,
    late_withdrawal = b.late_withdrawal or (v_late and b.list = 'team' and excluded.list <> 'team'),
    withdrew        = b.withdrew or (b.list = 'team' and excluded.list <> 'team'),   -- rinuncia in qualsiasi momento
    reserve_reply   = case when excluded.list = 'reserve' then b.reserve_reply end,
    updated_at = now();

  -- troppi in squadra (Leader che rientra o inserimento forzato):
  -- l'ultimo arrivato non "protetto" scende in testa alle riserve
  while (select count(*) from bookings where match_id = p_match and list = 'team') > v_size loop
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'team' and user_id is distinct from v_leader and user_id <> p_user
    order by (placed_by is not null), sort_key desc
    limit 1;
    exit when v_moved is null;
    update bookings
       set list = 'reserve', updated_at = now(),
           sort_key = coalesce((select min(sort_key) from bookings where match_id = p_match and list = 'reserve'),
                               clock_timestamp()) - interval '1 millisecond'
     where match_id = p_match and user_id = v_moved;
    perform notify(array[v_moved], 'demoted', 'Sei passato tra le riserve',
                   'Sei il primo della lista: se si libera un posto entri tu.', v_url, p_match);
    perform notify_lineup_change(p_match, display_name(v_moved) || ' è passato tra le riserve.');
    delete from lineup where match_id = p_match and user_id = v_moved;
    v_moved := null;
  end loop;

  -- REQ-016: chi esce dalla squadra libera il posto e le riserve scalano
  if cur.list = 'team' and v_new_list <> 'team' then
    delete from lineup where match_id = p_match and user_id = p_user;
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'reserve' and user_id <> p_user
    order by sort_key limit 1;
    if v_moved is not null then
      update bookings set list = 'team', sort_key = clock_timestamp(), updated_at = now()
       where match_id = p_match and user_id = v_moved;
      perform notify(array[v_moved], 'promoted', 'Sei dentro!',
                     'Si è liberato un posto: sei in squadra.', v_url, p_match);
      perform notify_lineup_change(p_match,
        v_name || ' non c''è più, entra ' || display_name(v_moved) || '.');
    else
      perform notify_lineup_change(p_match, v_name || ' non c''è più.');
    end if;
  elsif v_new_list = 'team' and cur.list is distinct from 'team' then
    perform notify_lineup_change(p_match, v_name || ' entra in squadra.');
  end if;

  -- chi si è dichiarato presente ma è in riserva entra se c'è spazio
  loop
    exit when (select count(*) from bookings where match_id = p_match and list = 'team') >= v_size;
    select user_id into v_moved from bookings
    where match_id = p_match and list = 'reserve' and choice = 'present'
    order by sort_key limit 1;
    exit when v_moved is null;
    update bookings set list = 'team', sort_key = clock_timestamp(), updated_at = now()
     where match_id = p_match and user_id = v_moved;
    perform notify(array[v_moved], 'promoted', 'Sei dentro!', 'Si è liberato un posto: sei in squadra.', v_url, p_match);
    v_moved := null;
  end loop;

  select count(*) into v_team_after from bookings where match_id = p_match and list = 'team';

  -- REQ-018: rinuncia nelle 24 ore, avvisati Leader e Premier
  if v_late and cur.list = 'team' and v_new_list <> 'team' then
    perform notify(staff_ids(), 'late_withdrawal', 'Rinuncia dell''ultimo momento',
                   v_name || ' ha dato forfait a meno di 24 ore dalla partita.', v_url, p_match);
  end if;

  -- REQ-019: si scende a 9, avviso speciale a chi non è in squadra (e allo staff)
  if v_team_before >= v_size and v_team_after = v_size - 1 then
    perform notify(
      array_remove(
        array(select id from profiles where active
                and id not in (select user_id from bookings where match_id = p_match and list = 'team'))
        || staff_ids(), p_user),
      'need_one', 'Manca un giocatore!',
      'Siamo in ' || v_team_after || ' per ' ||
        fmt_when(m.starts_at) || '. Ti unisci?',
      v_url, p_match,
      '[{"action":"present","title":"Ci sono"}]'::jsonb);
  end if;

  select slot into v_slot from booking_board where match_id = p_match and user_id = p_user;
  return jsonb_build_object(
    'list', (select list from bookings where match_id = p_match and user_id = p_user),
    'slot', v_slot);
end $$;

create or replace function public.vote_summary(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_voters int;
  v_min int;
  v_result jsonb;
  v_players int;
  v_mvp_needed int;
  v_show_avgs boolean;
  v_show_mvp boolean;
  v_leader boolean := has_leader_powers();
begin
  select vote_min_voters into v_min from app_settings where id = 1;
  select count(distinct voter_id) into v_voters from (
    select voter_id from player_votes where match_id = p_match
    union select voter_id from mvp_votes where match_id = p_match) x;

  -- medie: dopo almeno 2 votanti (con uno solo si leggerebbero i suoi voti);
  -- migliore in campo: segreto finché non ha votato il 60% di chi ha giocato (6 su 10). Il Leader vede tutto.
  select count(*) into v_players from bookings where match_id = p_match and list = 'team';
  v_mvp_needed := greatest(1, ceil(0.6 * v_players));
  v_show_avgs := v_voters >= 2 or v_leader;
  v_show_mvp := v_voters >= v_mvp_needed or v_leader;

  with avgs as (
    select target_id as user_id, round(avg(score), 2) as avg_score, count(*) as votes
    from player_votes where match_id = p_match group by target_id
  ),
  mvp as (
    select pick as user_id, team, count(*) as mvp_votes from mvp_picks(p_match) where pick is not null group by pick, team
  ),
  mvp_top as (
    select user_id, mvp_votes, mvp_votes = max(mvp_votes) over (partition by case when (select mvp_mode from matches where id = p_match) = 'per_team' then team end) as is_mvp from mvp
  )
  select jsonb_agg(jsonb_build_object(
           'user_id', b.user_id,
           'avg', case when v_show_avgs then a.avg_score end,
           'votes', case when v_show_avgs then coalesce(a.votes, 0) else 0 end,
           'mvp_votes', case when v_show_mvp then coalesce(t.mvp_votes, 0) else 0 end,
           'is_mvp', case when v_show_mvp then coalesce(t.is_mvp, false) else false end)
         order by case when v_show_avgs then a.avg_score end desc nulls last)
  into v_result
  from bookings b
  left join avgs a on a.user_id = b.user_id
  left join mvp_top t on t.user_id = b.user_id
  where b.match_id = p_match and b.list = 'team';

  return jsonb_build_object('voters', v_voters, 'threshold', v_min, 'players', coalesce(v_result, '[]'::jsonb),
                            'avgs_hidden', not v_show_avgs, 'avg_threshold', 2,
                            'mvp_hidden', not v_show_mvp, 'mvp_threshold', v_mvp_needed,
                            'my_votes_done', exists (select 1 from player_votes where match_id = p_match and voter_id = auth.uid()));
end $$;

create or replace function public.player_match_facts(p_from timestamptz default '-infinity', p_to timestamptz default 'infinity')
returns table (
  match_id uuid, starts_at timestamptz, user_id uuid, team text, outcome text,
  team_goals int, opp_goals int, diff int,
  goals int, assists int, own_goals int,
  avg_vote numeric, is_mvp boolean
)
language sql stable security definer set search_path = public as $$
  with ms as (
    select m.id, m.starts_at, r.diff, r.white_goals, r.black_goals
    from matches m join results r on r.match_id = m.id and r.status = 'homologated'
    where m.status <> 'cancelled' and m.starts_at >= p_from and m.starts_at < p_to
  ),
  voters as (
    select x.match_id, count(distinct x.voter_id) as n from (
      select match_id, voter_id from player_votes union select match_id, voter_id from mvp_votes) x
    join ms on ms.id = x.match_id group by x.match_id
  ),
  avgs as (
    select v.match_id, v.target_id, avg(v.score) as a
    from player_votes v join voters vc on vc.match_id = v.match_id
    where vc.n >= (select vote_min_voters from app_settings where id = 1)
    group by v.match_id, v.target_id
  ),
  mvp as (
    select ms.id as match_id, p.pick, p.team, (select mm.mvp_mode from matches mm where mm.id = ms.id) as mode, count(*) as c
    from ms cross join lateral mvp_picks(ms.id) p
    where p.pick is not null
      -- il migliore in campo conta solo quando non è più segreto: votazioni chiuse o 60% dei votanti
      and (now() > (select mm.votes_closes_at from matches mm where mm.id = ms.id)
           or (select count(distinct x.voter_id) from (select voter_id from player_votes where match_id = ms.id
                                                       union select voter_id from mvp_votes where match_id = ms.id) x)
              >= greatest(1, ceil(0.6 * (select count(*) from lineup lx where lx.match_id = ms.id))))
    group by ms.id, p.pick, p.team
  ),
  mvp_top as (
    select match_id, pick from (
      select match_id, pick, c, max(c) over (partition by match_id, case when mode = 'per_team' then team end) as mx from mvp) x
    where c = mx
  )
  select ms.id, ms.starts_at, l.user_id, l.team,
         case when ms.diff = 0 then 'D'
              when (ms.diff > 0) = (l.team = 'white') then 'W' else 'L' end,
         case l.team when 'white' then ms.white_goals else ms.black_goals end,
         case l.team when 'white' then ms.black_goals else ms.white_goals end,
         case l.team when 'white' then ms.diff else -ms.diff end,
         coalesce(s.goals, 0), coalesce(s.assists, 0), coalesce(s.own_goals, 0),
         round(a.a, 2),
         exists (select 1 from mvp_top t where t.match_id = ms.id and t.pick = l.user_id)
  from ms
  join lineup l on l.match_id = ms.id
  left join scorers s on s.match_id = ms.id and s.user_id = l.user_id
  left join avgs a on a.match_id = ms.id and a.target_id = l.user_id
  join profiles pr on pr.id = l.user_id
  -- statistiche azzerate: contano solo le partite dalla data di azzeramento (generale o del giocatore)
  where ms.starts_at >= coalesce(greatest((select stats_since from app_settings where id = 1), pr.stats_since), '-infinity'::timestamptz)
$$;

create or replace function public.submit_result_unchecked(
  p_match uuid, p_diff int, p_white int default null, p_black int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  r results;
  v_uid uuid := auth.uid();
  v_leader boolean := has_leader_powers(v_uid);
  v_staff boolean := is_staff(v_uid);
  v_agree int; v_disagree int;
  v_text text;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  if not (is_participant(p_match, v_uid) or v_staff) then raise exception 'Il risultato lo inserisce chi ha giocato'; end if;
  if now() < result_opens_at(m) then
    raise exception 'Il risultato si inserisce da %', fmt_when(result_opens_at(m));
  end if;
  if m.locked and not v_leader then raise exception 'Risultato chiuso: solo il Leader può modificarlo'; end if;
  if (p_white is null) <> (p_black is null) then raise exception 'Indica i gol di entrambe le squadre'; end if;
  if p_white is not null then p_diff := p_white - p_black; end if;
  -- solo il risultato esatto (niente più «chi ha vinto e di quanto»)
  if p_white is null then raise exception 'Inserisci il risultato esatto: i gol di entrambe le squadre'; end if;

  select * into r from results where match_id = p_match;
  if found and not v_staff then
    if r.status = 'homologated' then raise exception 'Il risultato è già omologato'; end if;
    select count(*) filter (where agree), count(*) filter (where not agree) into v_agree, v_disagree
    from result_reviews where match_id = p_match;
    -- un risultato già inserito si può sostituire solo se è più contestato che confermato
    if v_disagree <= v_agree then raise exception 'C''è già un risultato: confermalo o contestalo'; end if;
  end if;

  insert into results as x (match_id, diff, white_goals, black_goals, entered_by, entered_at, status, homologated_by, homologated_at)
  values (p_match, p_diff, p_white, p_black, v_uid, now(),
          case when m.locked then 'homologated' else 'pending' end,
          case when m.locked then 'leader' end,
          case when m.locked then now() end)
  on conflict (match_id) do update set
    diff = excluded.diff, white_goals = excluded.white_goals, black_goals = excluded.black_goals,
    entered_by = excluded.entered_by, entered_at = excluded.entered_at,
    status = excluded.status, homologated_by = excluded.homologated_by, homologated_at = excluded.homologated_at;
  delete from result_reviews where match_id = p_match;

  v_text := case
    when p_white is not null then format('%s %s - %s %s', team_name(m, 'white'), p_white, p_black, team_name(m, 'black'))
    when p_diff = 0 then 'Pareggio'
    when p_diff > 0 then format('%s vincono di %s', team_name(m, 'white'), p_diff)
    else format('%s vincono di %s', team_name(m, 'black'), -p_diff) end;

  if m.locked then
    perform notify(array(select user_id from bookings where match_id = p_match and list = 'team'),
      'result_final', 'Risultato corretto dal Leader', v_text, '/partita/' || p_match || '/risultato', p_match);
  else
    perform notify(array(select user_id from bookings where match_id = p_match and list = 'team' and user_id <> v_uid),
      'result_review', 'Risultato inserito: ' || v_text,
      display_name(v_uid) || ' ha inserito il risultato. Confermi?', '/partita/' || p_match || '/risultato', p_match,
      '[{"action":"confirm_result","title":"Confermo"}]'::jsonb);
    -- il Leader omologa: gli arriva la richiesta
    perform notify(array_remove(leader_ids(), v_uid), 'homologate_needed', 'Risultato da omologare',
      'Risultato inserito: ' || v_text || '.', '/partita/' || p_match || '/risultato', p_match);
  end if;
end $$;
