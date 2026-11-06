-- =====================================================================
-- FantaLeader: nuove regole e correzione per Supabase
--  * il motore non usa più DELETE/UPDATE senza condizione: su Supabase le richieste
--    dell'app passano da pg-safeupdate, che le rifiuta («DELETE requires a WHERE
--    clause»): falliva «Ricalcola tutte le giornate» e il calcolo automatico dei
--    punti quando si salvano marcatori o voti (restava solo il lavoro ogni 10 minuti);
--  * migliore in campo +1 (solo lui); vittoria +2; sconfitta -1;
--  * coefficienti: 1°-5° x1,00, 6°-10° x1,25, dall'11° x1,50;
--  * skill: Vincenzo (+2 a tutta la squadra se subisce meno di 6 gol; -1 a tutta la
--    squadra se ne subisce più di 8), Max (se perde senza segnare, -1 a tutta la
--    squadra), Leader (le sue skill valgono solo quando gioca); nuova condizione
--    conceded_gt (la squadra subisce più di N gol);
--  * nessuno può scegliere sé stesso nella propria fantasquadra;
--  * quotazione attuale: le assenze contano 0 nella media (pesano in negativo);
--  * FantaLeader è in anteprima: tutte le giornate si ricalcolano con le regole
--    nuove (coefficienti compresi), versione delle regole 2.
-- =====================================================================

update public.fl_settings set rules_version = 2,
  params = params || '{"win": 2, "loss": -1, "mvp": 1, "coef_bands": [[5, 1.00], [10, 1.25], [null, 1.50]]}'::jsonb
where id = 1;

update public.fl_skills set name = 'Vincenzo +', description = 'Se la sua squadra subisce meno di 6 gol, tutta la squadra prende +2 punti.',
  rule = '{"conceded_lt":6,"amount":2,"to":"self_teammates"}' where code = 'vincenzo+';
update public.fl_skills set name = 'Vincenzo −', description = 'Se la sua squadra subisce più di 8 gol, tutta la squadra prende −1 punto.',
  rule = '{"conceded_gt":8,"amount":-1,"to":"self_teammates"}' where code = 'vincenzo-';
update public.fl_skills set description = 'Se perde senza fare un gol, tutta la squadra prende −1 punto.',
  rule = '{"outcome":"L","goals_max":0,"amount":-1,"to":"self_teammates"}' where code = 'max-';
update public.fl_skills set description = 'Quando gioca, la sua fantasquadra prende +1.',
  rule = '{"amount":1,"to":"fanta_others"}' where code = 'leader+';
update public.fl_skills set description = 'Quando gioca, i suoi avversari in campo prendono −1.' where code = 'leader-';

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------
create or replace function public.fl_compute_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches; r results; st fl_settings; pr jsonb;
  v_final boolean; v_voters int; v_week_from timestamptz; v_week_to timestamptz; v_first_in_week boolean;
  s record; cx record; v_rule jsonb; v_ok boolean; v_qty numeric; v_val numeric; v_vs_goals int; v_vs_played boolean;
  v_low numeric; v_old fl_points;
begin
  select * into m from matches where id = p_match;
  select * into r from results where match_id = p_match and status = 'homologated';
  if m is null or r is null or m.status = 'cancelled' then
    delete from fl_points where match_id = p_match and status = 'provisional';
    return;
  end if;
  select * into st from fl_settings where id = 1;
  pr := st.params;
  v_final := now() >= coalesce(m.votes_closes_at, m.starts_at);
  perform fl_snapshot_coef(p_match);

  select count(distinct voter_id) into v_voters from player_votes where match_id = p_match;
  -- Punti Leader: quelli assegnati nella settimana (lun-dom, ora italiana) della partita; alla prima partita della settimana
  v_week_from := (date_trunc('week', m.starts_at at time zone 'Europe/Rome')) at time zone 'Europe/Rome';
  v_week_to := v_week_from + interval '7 days';
  v_first_in_week := not exists (select 1 from matches x join results rx on rx.match_id = x.id and rx.status = 'homologated'
                                 where x.status <> 'cancelled' and x.starts_at >= v_week_from and x.starts_at < m.starts_at);

  -- contesto per ogni giocatore eleggibile
  create temp table if not exists fl_ctx (
    user_id uuid primary key, played boolean, team text, outcome text, goals int, own_goals int,
    scored int, conceded int, diff int, avg numeric, mvp boolean, worst boolean, consec int,
    leader_pts numeric, base numeric, skills numeric, zeroed boolean, fanta jsonb, bd jsonb, coef numeric
  ) on commit drop;
  delete from fl_ctx where true;   -- Supabase vieta DELETE e UPDATE senza condizione (pg-safeupdate)
  insert into fl_ctx (user_id, played, team, outcome, goals, own_goals, scored, conceded, diff, avg, mvp, worst, consec, leader_pts,
                      base, skills, zeroed, fanta, bd, coef)
  select f.user_id, l.user_id is not null, l.team,
         case when l.user_id is null then null
              when r.diff = 0 then 'D'
              when (l.team = 'white') = (r.diff > 0) then 'W' else 'L' end,
         coalesce(sc.goals, 0), coalesce(sc.own_goals, 0),
         case when l.team = 'white' then r.white_goals else r.black_goals end,
         case when l.team = 'white' then r.black_goals else r.white_goals end,
         case when l.team = 'white' then r.diff else -r.diff end,
         case when v_voters >= (pr ->> 'vote_min_voters')::int then (select round(avg(v.score)::numeric, 2) from player_votes v where v.match_id = p_match and v.target_id = f.user_id) end,
         false, false, 0,
         case when v_first_in_week then coalesce((select sum(lp.points) from leader_points lp where lp.user_id = f.user_id and lp.created_at >= v_week_from and lp.created_at < v_week_to), 0) else 0 end,
         0, 0, false, '[]'::jsonb, '[]'::jsonb,
         coalesce((select co.coef from fl_coefficients co where co.match_id = p_match and co.user_id = f.user_id), 1)
  from fl_players f
  left join lineup l on l.match_id = p_match and l.user_id = f.user_id
  left join scorers sc on sc.match_id = p_match and sc.user_id = f.user_id
  where f.eligible;

  -- migliore in campo (già protetto dalla regola del 60%) e peggiore della squadra (media più bassa, da 2 votanti)
  update fl_ctx c set mvp = true from player_match_facts(m.starts_at - interval '1 second', m.starts_at + interval '1 second') x
  where x.match_id = p_match and x.user_id = c.user_id and x.is_mvp;
  update fl_ctx c set worst = true
  where c.played and c.avg is not null and c.avg = (select min(c2.avg) from fl_ctx c2 where c2.played and c2.team = c.team);
  -- presenze consecutive fino a questa partita (Bog)
  update fl_ctx c set consec = (
    select count(*) from (
      select x.starts_at, exists (select 1 from lineup lx where lx.match_id = x.id and lx.user_id = c.user_id) as pres
      from matches x join results rx on rx.match_id = x.id and rx.status = 'homologated'
      where x.status <> 'cancelled' and x.starts_at <= m.starts_at
      order by x.starts_at desc
    ) h where h.starts_at > coalesce((
      select max(x2.starts_at) from matches x2 join results r2 on r2.match_id = x2.id and r2.status = 'homologated'
      where x2.status <> 'cancelled' and x2.starts_at <= m.starts_at
        and not exists (select 1 from lineup l2 where l2.match_id = x2.id and l2.user_id = c.user_id)), '-infinity'))
  where c.played;

  -- punti base
  update fl_ctx c set
    base = case when c.played then
             (pr ->> 'presence')::numeric
             + c.goals * (pr ->> 'goal')::numeric
             + c.own_goals * (pr ->> 'own_goal')::numeric
             + coalesce(c.avg, (pr ->> 'vote_default')::numeric)
             + case c.outcome when 'W' then (pr ->> 'win')::numeric when 'L' then (pr ->> 'loss')::numeric else (pr ->> 'draw')::numeric end
             + case when c.mvp then coalesce((pr ->> 'mvp')::numeric, 0) else 0 end
           else 0 end + c.leader_pts,
    bd = case when c.played then jsonb_build_array(
           jsonb_build_object('label', 'Presenza', 'value', (pr ->> 'presence')::numeric),
           jsonb_build_object('label', 'Voto' || case when c.avg is null then ' (non disponibile: ' || (pr ->> 'vote_default') || ')' else '' end, 'value', coalesce(c.avg, (pr ->> 'vote_default')::numeric)),
           jsonb_build_object('label', case c.outcome when 'W' then 'Vittoria' when 'L' then 'Sconfitta' else 'Pareggio' end,
                              'value', case c.outcome when 'W' then (pr ->> 'win')::numeric when 'L' then (pr ->> 'loss')::numeric else (pr ->> 'draw')::numeric end))
           || case when c.goals > 0 then jsonb_build_array(jsonb_build_object('label', 'Gol x' || c.goals, 'value', c.goals * (pr ->> 'goal')::numeric)) else '[]'::jsonb end
           || case when c.own_goals > 0 then jsonb_build_array(jsonb_build_object('label', 'Autogol x' || c.own_goals, 'value', c.own_goals * (pr ->> 'own_goal')::numeric)) else '[]'::jsonb end
           || case when c.mvp and coalesce((pr ->> 'mvp')::numeric, 0) <> 0 then jsonb_build_array(jsonb_build_object('label', 'Migliore in campo', 'value', (pr ->> 'mvp')::numeric)) else '[]'::jsonb end
         else jsonb_build_array(jsonb_build_object('label', 'Non ha giocato', 'value', 0)) end
         || case when c.leader_pts <> 0 then jsonb_build_array(jsonb_build_object('label', 'Punti Leader della settimana', 'value', c.leader_pts)) else '[]'::jsonb end
  where true;

  -- skill (attive, assegnate a giocatori eleggibili), nell'ordine del catalogo
  for s in
    select k.*, ps.user_id as owner from fl_player_skills ps join fl_skills k on k.id = ps.skill_id and k.active
    join fl_ctx o on o.user_id = ps.user_id order by k.id, ps.user_id
  loop
    v_rule := s.rule;
    if coalesce(v_rule ->> 'special', '') = 'half_lowest' then continue; end if;   -- dopo, quando i totali sono noti
    select * into cx from fl_ctx where user_id = s.owner;
    v_ok := case coalesce(v_rule ->> 'when', 'played') when 'played' then cx.played when 'absent' then not cx.played else true end;
    if v_ok and v_rule ? 'outcome' then v_ok := cx.played and cx.outcome = v_rule ->> 'outcome'; end if;
    if v_ok and v_rule ? 'goals_min' then v_ok := cx.goals >= (v_rule ->> 'goals_min')::int; end if;
    if v_ok and v_rule ? 'goals_max' then v_ok := cx.goals <= (v_rule ->> 'goals_max')::int; end if;
    if v_ok and v_rule ? 'conceded_lt' then v_ok := cx.conceded is not null and cx.conceded < (v_rule ->> 'conceded_lt')::int; end if;
    if v_ok and v_rule ? 'conceded_gt' then v_ok := cx.conceded is not null and cx.conceded > (v_rule ->> 'conceded_gt')::int; end if;
    if v_ok and coalesce((v_rule ->> 'mvp')::boolean, false) then v_ok := cx.mvp; end if;
    if v_ok and coalesce((v_rule ->> 'worst')::boolean, false) then v_ok := cx.worst; end if;
    if v_ok and v_rule ? 'avg_gt' then v_ok := cx.avg is not null and cx.avg > (v_rule ->> 'avg_gt')::numeric; end if;
    if v_ok and v_rule ? 'avg_lt' then v_ok := cx.avg is not null and cx.avg < (v_rule ->> 'avg_lt')::numeric; end if;
    if not v_ok then continue; end if;
    v_qty := case v_rule ->> 'per'
      when 'goal' then cx.goals
      when 'own_goal' then cx.own_goals
      when 'conceded' then coalesce(cx.conceded, 0)
      when 'diff_abs' then abs(coalesce(cx.diff, 0))
      when 'diff_sign' then sign(coalesce(cx.diff, 0))
      when 'consecutive' then cx.consec
      else 1 end;
    if v_rule ->> 'per' = 'goals_vs' then
      select o.played, o.goals into v_vs_played, v_vs_goals from fl_ctx o join fl_players fp on fp.user_id = o.user_id where fp.preset_code = v_rule ->> 'vs';
      if not coalesce(v_vs_played, false) then continue; end if;          -- l'altro non ha giocato: non si applica
      v_qty := cx.goals - v_vs_goals;
      if v_rule ->> 'sign' = 'pos' then v_qty := greatest(v_qty, 0); elsif v_rule ->> 'sign' = 'neg' then v_qty := least(v_qty, 0); end if;
    end if;
    v_val := round(coalesce((v_rule ->> 'amount')::numeric, 0) * v_qty, 2);
    if coalesce((v_rule ->> 'zero')::boolean, false) then
      update fl_ctx t set zeroed = true,
        bd = t.bd || jsonb_build_array(jsonb_build_object('label', 'Skill ' || s.name || ': punti azzerati', 'value', 0))
      where (v_rule ->> 'to' in ('self', 'self_teammates') and t.user_id = s.owner)
         or (v_rule ->> 'to' in ('teammates', 'self_teammates') and t.played and t.team = cx.team and t.user_id <> s.owner);
      continue;
    end if;
    if v_val = 0 then continue; end if;
    if v_rule ->> 'to' in ('fanta_others', 'fanta_all') then
      update fl_ctx t set fanta = t.fanta || jsonb_build_array(jsonb_build_object('label', s.name, 'amount', v_val,
                         'to', case when v_rule ->> 'to' = 'fanta_all' then 'all' else 'others' end))
      where t.user_id = s.owner;
    else
      update fl_ctx t set skills = t.skills + v_val,
        bd = t.bd || jsonb_build_array(jsonb_build_object('label', 'Skill ' || s.name, 'value', v_val))
      where (v_rule ->> 'to' in ('self', 'self_teammates') and t.user_id = s.owner)
         or (v_rule ->> 'to' in ('teammates', 'self_teammates') and cx.played and t.played and t.team = cx.team and t.user_id <> s.owner)
         or (v_rule ->> 'to' = 'opponents' and cx.played and t.played and t.team <> cx.team);
    end if;
  end loop;

  -- skill «metà del punteggio più basso dei presenti» (Ben assente)
  select min(case when zeroed then 0 else base + skills end) into v_low from fl_ctx where played;
  for s in
    select k.*, ps.user_id as owner from fl_player_skills ps join fl_skills k on k.id = ps.skill_id and k.active
    join fl_ctx o on o.user_id = ps.user_id where k.rule ->> 'special' = 'half_lowest' order by k.id
  loop
    select * into cx from fl_ctx where user_id = s.owner;
    if (case coalesce(s.rule ->> 'when', 'absent') when 'absent' then not cx.played when 'played' then cx.played else true end) and v_low is not null then
      update fl_ctx t set skills = t.skills + round(v_low / 2, 2),
        bd = t.bd || jsonb_build_array(jsonb_build_object('label', 'Skill ' || s.name || ' (metà del più basso dei presenti)', 'value', round(v_low / 2, 2)))
      where t.user_id = s.owner;
    end if;
  end loop;

  -- scrittura: provvisori sovrascritti; definitivi cambiati = revisione registrata
  for cx in select * from fl_ctx loop
    select * into v_old from fl_points where match_id = p_match and user_id = cx.user_id;
    if v_old.status = 'final' and (v_old.total, v_old.pre, v_old.fanta, v_old.played)
         is not distinct from (round((case when cx.zeroed then 0 else cx.base + cx.skills end) * cx.coef, 2),
                               round(case when cx.zeroed then 0 else cx.base + cx.skills end, 2), cx.fanta, cx.played) then
      continue;   -- nulla di nuovo
    end if;
    if v_old.status = 'final' then
      insert into fl_points_revisions (match_id, user_id, revision, old_total, new_total, old_row)
      values (p_match, cx.user_id, v_old.revision + 1, v_old.total,
              round((case when cx.zeroed then 0 else cx.base + cx.skills end) * cx.coef, 2), to_jsonb(v_old));
    end if;
    insert into fl_points (match_id, user_id, played, team, won, base, skills, zeroed, pre, coef, total, fanta, breakdown, status, revision, rules_version, computed_at)
    values (p_match, cx.user_id, cx.played, cx.team, coalesce(cx.outcome = 'W', false), round(cx.base, 2), round(cx.skills, 2), cx.zeroed,
            round(case when cx.zeroed then 0 else cx.base + cx.skills end, 2), cx.coef,
            round((case when cx.zeroed then 0 else cx.base + cx.skills end) * cx.coef, 2),
            cx.fanta, cx.bd, case when v_final then 'final' else 'provisional' end,
            case when v_old.status = 'final' then v_old.revision + 1 else 0 end, st.rules_version, now())
    on conflict (match_id, user_id) do update set
      played = excluded.played, team = excluded.team, won = excluded.won, base = excluded.base, skills = excluded.skills,
      zeroed = excluded.zeroed, pre = excluded.pre, coef = excluded.coef, total = excluded.total, fanta = excluded.fanta,
      breakdown = excluded.breakdown, status = excluded.status, revision = excluded.revision,
      rules_version = excluded.rules_version, computed_at = excluded.computed_at;
  end loop;
  -- chi non è più eleggibile esce da questa giornata
  delete from fl_points p where p.match_id = p_match and not exists (select 1 from fl_ctx q where q.user_id = p.user_id);
end $$;

create or replace function public.fl_current_price(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  st fl_settings; pl fl_players; n int; mine numeric; allavg numeric; rel numeric;
begin
  if auth.uid() is not null and not fl_can_see() then return null; end if;
  select * into st from fl_settings where id = 1;
  select * into pl from fl_players where user_id = p_user;
  if pl is null then return null; end if;
  -- tutte le giornate, non solo quelle giocate: un'assenza conta 0 e abbassa la media (e quindi la quotazione)
  select count(*), avg(p.total) into n, mine
  from fl_points p join matches m on m.id = p.match_id
  where p.user_id = p_user and p.status = 'final' and m.starts_at > st.prices_since;
  if n < (st.params ->> 'price_min_played')::int then return pl.price_initial; end if;
  select avg(p.total) into allavg
  from fl_points p join matches m on m.id = p.match_id join fl_players f on f.user_id = p.user_id and f.eligible
  where p.status = 'final' and m.starts_at > st.prices_since;
  if allavg is null or abs(allavg) < 0.01 then return pl.price_initial; end if;
  rel := (mine - allavg) / abs(allavg) * (st.params ->> 'price_k')::numeric;
  rel := greatest(-(st.params ->> 'price_cap')::numeric, least((st.params ->> 'price_cap')::numeric, rel));
  return greatest((st.params ->> 'price_min')::int, round(pl.price_initial * (1 + rel))::int);
end $$;

create or replace function public.fl_confirm_team(p_name text, p_members uuid[], p_captain uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st fl_settings; me uuid := auth.uid(); v_team fl_teams; v_prices int[]; v_spent int; v_has boolean; u uuid;
begin
  select * into st from fl_settings where id = 1;
  if me is null or not is_active_member(me) or exists (select 1 from profiles where id = me and guest) then
    raise exception 'Per partecipare serve il tuo account';
  end if;
  if not fl_can_see(me) then raise exception 'FantaLeader non è ancora aperto a tutti'; end if;
  if not st.market_open then raise exception 'Il mercato è chiuso: le squadre si creano e si cambiano solo quando lo apre il Leader'; end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 40 then raise exception 'Dai un nome alla tua fantasquadra (da 2 a 40 caratteri)'; end if;
  if p_members is null or cardinality(p_members) <> st.team_size then
    raise exception 'La fantasquadra deve avere esattamente % giocatori', st.team_size;
  end if;
  if (select count(distinct x) from unnest(p_members) x) <> cardinality(p_members) then raise exception 'Lo stesso giocatore non può essere scelto due volte'; end if;
  foreach u in array p_members loop
    if not exists (select 1 from fl_players where user_id = u and eligible) then raise exception 'Giocatore non disponibile nel FantaLeader'; end if;
  end loop;
  if me = any (p_members) then raise exception 'Non puoi scegliere te stesso nella tua fantasquadra'; end if;
  if p_captain is null or not (p_captain = any (p_members)) then raise exception 'Il capitano deve essere uno dei % giocatori', st.team_size; end if;
  -- si paga la quotazione attuale (alla prima apertura coincide con l'iniziale)
  select array_agg(fl_current_price(x) order by o), sum(fl_current_price(x)) into v_prices, v_spent
  from unnest(p_members) with ordinality as a(x, o);
  if v_spent > st.budget then raise exception 'Hai superato il budget: % euroLeader su %', v_spent, st.budget; end if;

  select * into v_team from fl_teams where owner_id = me for update;
  v_has := v_team is not null;
  if not v_has then
    insert into fl_teams (owner_id, name) values (me, trim(p_name)) returning * into v_team;
  else
    update fl_teams set name = trim(p_name), updated_at = now() where id = v_team.id;
    update fl_team_versions set valid_to = now() where team_id = v_team.id and valid_to is null;
  end if;
  insert into fl_team_versions (team_id, valid_from, captain_id, members, prices, spent)
  values (v_team.id, case when v_has then now() else '-infinity'::timestamptz end, p_captain, p_members, v_prices, v_spent);
  perform fl_log('squadra confermata', jsonb_build_object('team', v_team.id, 'name', trim(p_name), 'members', p_members, 'captain', p_captain, 'spent', v_spent));
  return jsonb_build_object('team_id', v_team.id, 'spent', v_spent, 'left', st.budget - v_spent);
end $$;

-- ripartenza con le regole nuove (FantaLeader è in anteprima): punti, revisioni e coefficienti da capo
delete from public.fl_points_revisions where true;
delete from public.fl_points where true;
delete from public.fl_coefficients where true;
select public.fl_refresh();
select public.fl_log('regole cambiate: ricalcolo completo (versione 2)', '{}'::jsonb);

-- l'ultima giornata calcolata (per la Home: «punti dell'ultima partita»)
create or replace function public.fl_last_round() returns table (match_id uuid, starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.starts_at from matches m
  where fl_can_see() and exists (select 1 from fl_points p where p.match_id = m.id)
  order by m.starts_at desc limit 1
$$;
revoke execute on function public.fl_last_round() from public, anon;
grant execute on function public.fl_last_round() to authenticated;
