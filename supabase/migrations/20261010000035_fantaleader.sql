-- =====================================================================
-- FantaLeader: fantagioco interno (6 giocatori, 100 euroLeader, capitano,
-- skill, classifica individuale con coefficienti settimanali, classifica
-- delle fantasquadre). Livello DERIVATO: legge formazioni, risultati,
-- marcatori, voti e Punti Leader senza modificarne la logica.
--
-- Decisioni (vedi docs in README):
--  * punti base: presenza +1, gol +1, autogol -2, voto = media (6 se meno di
--    2 votanti), vittoria +3, sconfitta -2, pareggio 0, assist 0, Punti Leader
--    assegnati nella settimana (lun-dom, ora italiana) della partita;
--  * chi non gioca prende 0 (salvo skill e Punti Leader);
--  * ordine: base + skill individuali -> (azzeramento) -> x coefficiente ->
--    x 1,25 capitano (agli altri 5, se il capitano gioca e vince) -> skill di
--    fantasquadra (sommate alla fantasquadra, non alla classifica individuale);
--  * coefficiente di una giornata dalla classifica consolidata prima della
--    partita: 1-6 -> 1,00; 7-12 -> 1,25; 13+ -> 1,50; prima giornata 1,00;
--    pari merito = stessa posizione; salvato una volta e mai ricalcolato;
--  * punti provvisori finché le pagelle sono aperte, definitivi dopo;
--    le correzioni successive creano una revisione registrata;
--  * nuove fantasquadre: punti passati dei giocatori senza coefficienti e
--    senza bonus del capitano.
-- =====================================================================

-- ---------------------------------------------------------------- impostazioni
create table public.fl_settings (
  id            smallint primary key default 1 check (id = 1),
  market_open   boolean not null default false,
  market_changed_at timestamptz,
  prices_since  timestamptz not null default '-infinity',   -- la quotazione attuale guarda le partite da qui
  budget        int not null default 100 check (budget > 0),
  team_size     int not null default 6 check (team_size between 1 and 15),
  rules_version int not null default 1,
  params        jsonb not null default '{
    "presence": 1, "goal": 1, "own_goal": -2, "assist": 0,
    "win": 3, "loss": -2, "draw": 0, "vote_default": 6, "vote_min_voters": 2,
    "captain_bonus": 1.25,
    "coef_bands": [[6, 1.00], [12, 1.25], [null, 1.50]], "coef_first": 1.00,
    "price_k": 0.5, "price_cap": 0.3, "price_min": 1, "price_min_played": 2
  }'::jsonb
);
insert into public.fl_settings default values;

-- ---------------------------------------------------------------- schede dei giocatori del documento
-- (il Leader le collega ai profili veri: quotazione, descrizione e skill)
create table public.fl_presets (
  code        text primary key,
  name        text not null,
  price       int not null check (price > 0),
  description text,
  sort        int not null default 0
);

create table public.fl_players (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  preset_code   text unique references public.fl_presets (code) on delete set null,
  eligible      boolean not null default true,
  price_initial int not null check (price_initial > 0),
  description   text check (description is null or length(description) <= 2000),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);

create table public.fl_price_history (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  price      int not null,
  reason     text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);
create index fl_price_history_user on public.fl_price_history (user_id, created_at);

-- ---------------------------------------------------------------- skill
-- rule (jsonb), tutte le condizioni devono valere:
--   when: played | absent | always      outcome: W | L | D
--   goals_min / goals_max (gol suoi)    conceded_lt (gol subiti dalla sua squadra <)
--   mvp: true (migliore in campo)       worst: true (media più bassa della sua squadra)
--   avg_gt / avg_lt (sua media voto)
--   per: goal | own_goal | conceded | diff_abs | diff_sign | goals_vs | consecutive  (moltiplica amount)
--   vs: codice della scheda di confronto (goals_vs)   sign: pos | neg (tiene solo la parte positiva/negativa)
--   amount: punti          to: self | teammates | self_teammates | opponents | fanta_others | fanta_all
--   zero: true (azzera il totale della partita dei destinatari)   special: half_lowest (metà del più basso dei presenti)
create table public.fl_skills (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  preset_code text references public.fl_presets (code) on delete set null,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  kind        text not null check (kind in ('pos', 'neg')),
  description text not null,
  rule        jsonb not null,
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table public.fl_player_skills (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  skill_id bigint not null references public.fl_skills (id) on delete cascade,
  primary key (user_id, skill_id)
);

-- ---------------------------------------------------------------- fantasquadre (una per allenatore) con le versioni
create table public.fl_teams (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null unique references public.profiles (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 2 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fl_team_versions (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.fl_teams (id) on delete cascade,
  valid_from timestamptz not null,          -- '-infinity' per la prima versione: prende i punti passati
  valid_to   timestamptz,                   -- null = versione in corso
  captain_id uuid not null references public.profiles (id) on delete cascade,
  members    uuid[] not null,
  prices     int[] not null,                -- quotazioni pagate alla conferma (mai riscritte)
  spent      int not null,
  created_at timestamptz not null default now(),
  check (captain_id = any (members)),
  check (cardinality(members) = cardinality(prices))
);
create unique index fl_team_versions_current on public.fl_team_versions (team_id) where valid_to is null;

-- ---------------------------------------------------------------- punti per giornata
create table public.fl_coefficients (
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  position   int,                            -- posizione nella classifica consolidata prima della partita
  total_before numeric(9,2) not null default 0,
  coef       numeric(4,2) not null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table public.fl_points (
  match_id    uuid not null references public.matches (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  played      boolean not null,
  team        text,
  won         boolean not null default false,
  base        numeric(8,2) not null default 0,
  skills      numeric(8,2) not null default 0,
  zeroed      boolean not null default false,
  pre         numeric(8,2) not null default 0,   -- base + skill (0 se azzerato): senza coefficiente
  coef        numeric(4,2) not null default 1,
  total       numeric(8,2) not null default 0,   -- pre x coef
  fanta       jsonb not null default '[]'::jsonb,  -- [{label, amount, to: others|all}] per le fantasquadre
  breakdown   jsonb not null default '[]'::jsonb,  -- [{label, value}]
  status      text not null check (status in ('provisional', 'final')),
  revision    int not null default 0,
  rules_version int not null,
  computed_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index fl_points_user on public.fl_points (user_id);

create table public.fl_points_revisions (
  id         bigint generated always as identity primary key,
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  revision   int not null,
  old_total  numeric(8,2),
  new_total  numeric(8,2),
  old_row    jsonb,
  created_at timestamptz not null default now()
);

create table public.fl_audit (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  actor   uuid references public.profiles (id) on delete set null,
  action  text not null,
  details jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------- permessi: si legge da membri, si scrive solo con le funzioni
do $$ declare t text; begin
  foreach t in array array['fl_settings','fl_presets','fl_players','fl_price_history','fl_skills','fl_player_skills',
                           'fl_teams','fl_team_versions','fl_coefficients','fl_points','fl_points_revisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "membri leggono" on public.%I for select to authenticated using (is_active_member())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
alter table public.fl_audit enable row level security;
create policy "il Leader legge il registro" on public.fl_audit for select to authenticated using (has_leader_powers());
revoke all on public.fl_audit from anon, authenticated;
grant select on public.fl_audit to authenticated;
grant all on public.fl_audit to service_role;

-- ---------------------------------------------------------------- utilità
create or replace function public.fl_param(p_key text) returns jsonb
language sql stable set search_path = public as $$ select params -> p_key from fl_settings where id = 1 $$;

create or replace function public.fl_log(p_action text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into fl_audit (actor, action, details) values (auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function public.fl_log(text, jsonb) from public, anon, authenticated;

create or replace function public.fl_require_leader() returns void
language plpgsql stable set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader gestisce FantaLeader'; end if;
end $$;

-- ---------------------------------------------------------------- quotazione attuale (dalle prestazioni)
-- media dei punti FantaLeader per partita giocata dall'ultimo mercato, confrontata con la media di tutti:
-- attuale = iniziale x (1 + k x scarto relativo), entro ±cap, arrotondata, mai sotto il minimo;
-- con meno di price_min_played partite resta uguale.
create or replace function public.fl_current_price(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  st fl_settings; pl fl_players; n int; mine numeric; allavg numeric; rel numeric;
begin
  select * into st from fl_settings where id = 1;
  select * into pl from fl_players where user_id = p_user;
  if pl is null then return null; end if;
  select count(*), avg(p.total) into n, mine
  from fl_points p join matches m on m.id = p.match_id
  where p.user_id = p_user and p.played and p.status = 'final' and m.starts_at > st.prices_since;
  if n < (st.params ->> 'price_min_played')::int then return pl.price_initial; end if;
  select avg(p.total) into allavg
  from fl_points p join matches m on m.id = p.match_id join fl_players f on f.user_id = p.user_id and f.eligible
  where p.played and p.status = 'final' and m.starts_at > st.prices_since;
  if allavg is null or abs(allavg) < 0.01 then return pl.price_initial; end if;
  rel := (mine - allavg) / abs(allavg) * (st.params ->> 'price_k')::numeric;
  rel := greatest(-(st.params ->> 'price_cap')::numeric, least((st.params ->> 'price_cap')::numeric, rel));
  return greatest((st.params ->> 'price_min')::int, round(pl.price_initial * (1 + rel))::int);
end $$;
grant execute on function public.fl_current_price(uuid) to authenticated;

-- ---------------------------------------------------------------- coefficienti della giornata (salvati una volta)
create or replace function public.fl_snapshot_coef(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_any boolean;
begin
  if exists (select 1 from fl_coefficients where match_id = p_match) then return; end if;   -- mai ricalcolati
  select starts_at into v_start from matches where id = p_match;
  select exists (select 1 from fl_points p join matches m on m.id = p.match_id where p.status = 'final' and m.starts_at < v_start) into v_any;
  insert into fl_coefficients (match_id, user_id, position, total_before, coef)
  select p_match, r.user_id, case when v_any then r.pos end, r.tot,
         case when not v_any then (fl_param('coef_first'))::text::numeric
              else coalesce((select (b ->> 1)::numeric from jsonb_array_elements(fl_param('coef_bands')) b
                             where b ->> 0 is null or r.pos <= (b ->> 0)::int order by (b ->> 0)::int nulls last limit 1), 1) end
  from (
    select f.user_id, coalesce(sum(p.total), 0) as tot, rank() over (order by coalesce(sum(p.total), 0) desc)::int as pos
    from fl_players f
    left join fl_points p on p.user_id = f.user_id and p.status = 'final'
         and p.match_id in (select id from matches where starts_at < v_start)
    where f.eligible
    group by f.user_id
  ) r;
end $$;
revoke execute on function public.fl_snapshot_coef(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- motore dei punti di una partita
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
  delete from fl_ctx;
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
           else 0 end + c.leader_pts,
    bd = case when c.played then jsonb_build_array(
           jsonb_build_object('label', 'Presenza', 'value', (pr ->> 'presence')::numeric),
           jsonb_build_object('label', 'Voto' || case when c.avg is null then ' (non disponibile: ' || (pr ->> 'vote_default') || ')' else '' end, 'value', coalesce(c.avg, (pr ->> 'vote_default')::numeric)),
           jsonb_build_object('label', case c.outcome when 'W' then 'Vittoria' when 'L' then 'Sconfitta' else 'Pareggio' end,
                              'value', case c.outcome when 'W' then (pr ->> 'win')::numeric when 'L' then (pr ->> 'loss')::numeric else (pr ->> 'draw')::numeric end))
           || case when c.goals > 0 then jsonb_build_array(jsonb_build_object('label', 'Gol x' || c.goals, 'value', c.goals * (pr ->> 'goal')::numeric)) else '[]'::jsonb end
           || case when c.own_goals > 0 then jsonb_build_array(jsonb_build_object('label', 'Autogol x' || c.own_goals, 'value', c.own_goals * (pr ->> 'own_goal')::numeric)) else '[]'::jsonb end
         else jsonb_build_array(jsonb_build_object('label', 'Non ha giocato', 'value', 0)) end
         || case when c.leader_pts <> 0 then jsonb_build_array(jsonb_build_object('label', 'Punti Leader della settimana', 'value', c.leader_pts)) else '[]'::jsonb end;

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
revoke execute on function public.fl_compute_match(uuid) from public, anon, authenticated;

-- ricalcolo sicuro: un errore di FantaLeader non deve MAI bloccare risultati, marcatori, voti o formazioni
create or replace function public.fl_touch(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_match is null or not exists (select 1 from results where match_id = p_match and status = 'homologated') then
    if p_match is not null then delete from fl_points where match_id = p_match and status = 'provisional'; end if;
    return;
  end if;
  perform fl_compute_match(p_match);
exception when others then
  raise warning 'FantaLeader: ricalcolo della partita % non riuscito: %', p_match, sqlerrm;
end $$;
revoke execute on function public.fl_touch(uuid) from public, anon, authenticated;

create or replace function public.trg_fl_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform fl_touch(case when tg_op = 'DELETE' then old.match_id else new.match_id end);
  return null;
end $$;
create trigger fl_results after insert or update or delete on public.results for each row execute function public.trg_fl_touch();
create trigger fl_scorers after insert or update or delete on public.scorers for each row execute function public.trg_fl_touch();
create trigger fl_lineup after insert or update or delete on public.lineup for each row execute function public.trg_fl_touch();
create trigger fl_mvp after insert or update or delete on public.mvp_votes for each row execute function public.trg_fl_touch();
-- i voti arrivano a gruppi: una volta per istruzione
create or replace function public.trg_fl_touch_votes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  for v in select distinct match_id from new_rows loop perform fl_touch(v); end loop;
  return null;
end $$;
create or replace function public.trg_fl_touch_votes_old() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  for v in select distinct match_id from old_rows loop perform fl_touch(v); end loop;
  return null;
end $$;
create trigger fl_votes_ins after insert on public.player_votes referencing new table as new_rows for each statement execute function public.trg_fl_touch_votes();
create trigger fl_votes_upd after update on public.player_votes referencing new table as new_rows for each statement execute function public.trg_fl_touch_votes();
create trigger fl_votes_del after delete on public.player_votes referencing old table as old_rows for each statement execute function public.trg_fl_touch_votes_old();
-- Punti Leader: si ricalcola la partita della loro settimana
create or replace function public.trg_fl_leader_points() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz; v_from timestamptz; v uuid;
begin
  v_at := case when tg_op = 'DELETE' then old.created_at else new.created_at end;
  v_from := (date_trunc('week', v_at at time zone 'Europe/Rome')) at time zone 'Europe/Rome';
  for v in select x.id from matches x where x.starts_at >= v_from and x.starts_at < v_from + interval '7 days' loop perform fl_touch(v); end loop;
  return null;
end $$;
create trigger fl_leader_points after insert or update or delete on public.leader_points for each row execute function public.trg_fl_leader_points();
revoke execute on function public.trg_fl_touch(), public.trg_fl_touch_votes(), public.trg_fl_touch_votes_old(), public.trg_fl_leader_points() from public, anon, authenticated;

-- consolidamento: quando le pagelle si chiudono, i provvisori diventano definitivi (ogni 10 minuti)
create or replace function public.fl_refresh() returns int
language plpgsql security definer set search_path = public as $$
declare v uuid; n int := 0;
begin
  for v in
    select m.id from matches m join results r on r.match_id = m.id and r.status = 'homologated'
    where m.status <> 'cancelled' and (
      exists (select 1 from fl_points p where p.match_id = m.id and p.status = 'provisional' and now() >= coalesce(m.votes_closes_at, m.starts_at))
      or not exists (select 1 from fl_points p where p.match_id = m.id))
    order by m.starts_at
  loop
    perform fl_touch(v); n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.fl_refresh() from public, anon, authenticated;
select cron.schedule('fantaleader-refresh', '*/10 * * * *', $$select public.fl_refresh()$$);

-- ---------------------------------------------------------------- classifiche
-- classifica individuale: punti (definitivi + provvisori), ultima giornata, coefficiente della prossima giornata
create or replace function public.fl_player_ranking()
returns table (user_id uuid, pos int, total numeric, provisional numeric, last_points numeric, played int,
               price_initial int, price_current int, next_coef numeric)
language sql stable security definer set search_path = public as $$
  with t as (
    select f.user_id, f.price_initial,
           coalesce(sum(p.total), 0) as total,
           coalesce(sum(p.total) filter (where p.status = 'provisional'), 0) as provisional,
           count(*) filter (where p.played)::int as played,
           (select p2.total from fl_points p2 join matches m2 on m2.id = p2.match_id where p2.user_id = f.user_id order by m2.starts_at desc limit 1) as last_points,
           coalesce(sum(p.total) filter (where p.status = 'final'), 0) as final_total
    from fl_players f left join fl_points p on p.user_id = f.user_id
    where f.eligible
    group by f.user_id, f.price_initial
  ), ranked as (
    select t.*, rank() over (order by t.total desc)::int as pos,
           rank() over (order by t.final_total desc)::int as final_pos,
           exists (select 1 from fl_points where status = 'final') as any_final
    from t
  )
  select user_id, pos, total, provisional, last_points, played, price_initial, fl_current_price(user_id),
         case when not any_final then (fl_param('coef_first'))::text::numeric
              else coalesce((select (b ->> 1)::numeric from jsonb_array_elements(fl_param('coef_bands')) b
                             where b ->> 0 is null or final_pos <= (b ->> 0)::int order by (b ->> 0)::int nulls last limit 1), 1) end
  from ranked
  where is_active_member()
  order by pos, user_id;
$$;
grant execute on function public.fl_player_ranking() to authenticated;

-- contributi di ogni fantasquadra per giornata
create or replace function public.fl_team_match_points()
returns table (team_id uuid, match_id uuid, starts_at timestamptz, points numeric, captain_points numeric, provisional boolean)
language sql stable security definer set search_path = public as $$
  with v as (
    select tv.*, t.created_at as team_created from fl_team_versions tv join fl_teams t on t.id = tv.team_id
  ), cells as (
    select v.team_id, m.id as match_id, m.starts_at, v.captain_id, v.members, v.created_at as version_created,
           (m.starts_at < v.team_created) as retro
    from v join matches m on m.starts_at >= v.valid_from and (v.valid_to is null or m.starts_at < v.valid_to)
    where exists (select 1 from fl_points p where p.match_id = m.id)
  ), per_member as (
    select c.team_id, c.match_id, c.starts_at, mem as user_id, c.captain_id,
           p.status,
           -- nuove fantasquadre: punti passati senza coefficiente e senza bonus del capitano
           case when c.retro then p.pre else p.total end
           * case when not c.retro and mem <> c.captain_id and cp.played and cp.won then (fl_param('captain_bonus'))::text::numeric else 1 end as pts,
           (select coalesce(sum((e ->> 'amount')::numeric * case when e ->> 'to' = 'all' then cardinality(c.members) else cardinality(c.members) - 1 end), 0)
              from jsonb_array_elements(p.fanta) e) as fanta_pts
    from cells c
    cross join lateral unnest(c.members) mem
    join fl_points p on p.match_id = c.match_id and p.user_id = mem
    left join fl_points cp on cp.match_id = c.match_id and cp.user_id = c.captain_id
  )
  select team_id, match_id, starts_at,
         round(sum(pts + fanta_pts), 2),
         round(sum(pts) filter (where user_id = captain_id), 2),
         bool_or(status = 'provisional')
  from per_member
  where is_active_member()
  group by team_id, match_id, starts_at;
$$;
grant execute on function public.fl_team_match_points() to authenticated;

-- classifica delle fantasquadre con gli spareggi: capitano, presenza del Leader, punti dell'allenatore
create or replace function public.fl_team_ranking()
returns table (team_id uuid, pos int, name text, owner_id uuid, total numeric, last_points numeric, captain_id uuid,
               members uuid[], spent int, captain_points numeric, has_leader boolean, owner_points numeric, provisional boolean)
language sql stable security definer set search_path = public as $$
  with tm as (select * from fl_team_match_points()),
  agg as (
    select t.id, t.name, t.owner_id, v.captain_id, v.members, v.spent,
           coalesce((select sum(points) from tm where tm.team_id = t.id), 0) as total,
           (select points from tm where tm.team_id = t.id order by starts_at desc limit 1) as last_points,
           coalesce((select sum(captain_points) from tm where tm.team_id = t.id), 0) as captain_points,
           exists (select 1 from profiles p where p.id = any (v.members) and p.role = 'leader') as has_leader,
           coalesce((select sum(total) from fl_points p where p.user_id = t.owner_id), 0) as owner_points,
           coalesce((select bool_or(provisional) from tm where tm.team_id = t.id), false) as provisional
    from fl_teams t join fl_team_versions v on v.team_id = t.id and v.valid_to is null
  )
  select id, rank() over (order by total desc, captain_points desc, has_leader desc, owner_points desc)::int,
         name, owner_id, total, last_points, captain_id, members, spent, captain_points, has_leader, owner_points, provisional
  from agg
  where is_active_member()
  order by 2, name;
$$;
grant execute on function public.fl_team_ranking() to authenticated;

-- ---------------------------------------------------------------- la fantasquadra: conferma in un'unica transazione
create or replace function public.fl_confirm_team(p_name text, p_members uuid[], p_captain uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st fl_settings; me uuid := auth.uid(); v_team fl_teams; v_prices int[]; v_spent int; v_has boolean; u uuid;
begin
  select * into st from fl_settings where id = 1;
  if me is null or not is_active_member(me) or exists (select 1 from profiles where id = me and guest) then
    raise exception 'Per partecipare serve il tuo account';
  end if;
  if not st.market_open then raise exception 'Il mercato è chiuso: le squadre si creano e si cambiano solo quando lo apre il Leader'; end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 40 then raise exception 'Dai un nome alla tua fantasquadra (da 2 a 40 caratteri)'; end if;
  if p_members is null or cardinality(p_members) <> st.team_size then
    raise exception 'La fantasquadra deve avere esattamente % giocatori', st.team_size;
  end if;
  if (select count(distinct x) from unnest(p_members) x) <> cardinality(p_members) then raise exception 'Lo stesso giocatore non può essere scelto due volte'; end if;
  foreach u in array p_members loop
    if not exists (select 1 from fl_players where user_id = u and eligible) then raise exception 'Giocatore non disponibile nel FantaLeader'; end if;
  end loop;
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
revoke execute on function public.fl_confirm_team(text, uuid[], uuid) from public, anon;
grant execute on function public.fl_confirm_team(text, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------- funzioni del Leader (autorizzate e registrate)
create or replace function public.fl_set_market(p_open boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f record; v_new int;
begin
  perform fl_require_leader();
  if p_open then
    update fl_settings set market_open = true, market_changed_at = now() where id = 1;
  else
    -- chiusura: le quotazioni attuali diventano le nuove iniziali (con storico)
    for f in select * from fl_players loop
      v_new := fl_current_price(f.user_id);
      if v_new is distinct from f.price_initial then
        update fl_players set price_initial = v_new, updated_at = now(), updated_by = auth.uid() where user_id = f.user_id;
        insert into fl_price_history (user_id, price, reason, created_by) values (f.user_id, v_new, 'chiusura del mercato', auth.uid());
      end if;
    end loop;
    update fl_settings set market_open = false, market_changed_at = now(), prices_since = now() where id = 1;
  end if;
  perform fl_log(case when p_open then 'mercato aperto' else 'mercato chiuso' end, '{}'::jsonb);
end $$;

create or replace function public.fl_save_player(p_user uuid, p_eligible boolean, p_price int, p_description text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old fl_players;
begin
  perform fl_require_leader();
  if p_price is null or p_price < 1 or p_price > 1000 then raise exception 'Quotazione non valida'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Giocatore non trovato'; end if;
  select * into v_old from fl_players where user_id = p_user;
  insert into fl_players (user_id, eligible, price_initial, description, updated_by)
  values (p_user, coalesce(p_eligible, true), p_price, nullif(trim(p_description), ''), auth.uid())
  on conflict (user_id) do update set eligible = excluded.eligible, price_initial = excluded.price_initial,
    description = excluded.description, updated_at = now(), updated_by = auth.uid();
  if v_old is null or v_old.price_initial <> p_price then
    insert into fl_price_history (user_id, price, reason, created_by) values (p_user, p_price, 'quotazione iniziale del Leader', auth.uid());
  end if;
  perform fl_log('giocatore aggiornato', jsonb_build_object('user', p_user, 'eligible', p_eligible, 'price', p_price, 'old_price', v_old.price_initial));
end $$;

-- collega una scheda del documento a un profilo: quotazione, descrizione e skill
create or replace function public.fl_link_preset(p_preset text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr fl_presets;
begin
  perform fl_require_leader();
  select * into pr from fl_presets where code = p_preset;
  if pr is null then raise exception 'Scheda non trovata'; end if;
  update fl_players set preset_code = null where preset_code = p_preset and user_id <> p_user;
  delete from fl_player_skills ps using fl_skills k where k.id = ps.skill_id and k.preset_code = p_preset and ps.user_id <> p_user;
  -- se il giocatore aveva un'altra scheda, le sue skill se ne vanno con lei
  delete from fl_player_skills ps using fl_skills k where k.id = ps.skill_id and k.preset_code is not null and k.preset_code <> p_preset and ps.user_id = p_user;
  perform fl_save_player(p_user, true, pr.price, pr.description);
  update fl_players set preset_code = p_preset where user_id = p_user;
  insert into fl_player_skills (user_id, skill_id) select p_user, id from fl_skills where preset_code = p_preset on conflict do nothing;
  perform fl_log('scheda collegata', jsonb_build_object('preset', p_preset, 'user', p_user));
end $$;

create or replace function public.fl_set_player_skills(p_user uuid, p_skills bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform fl_require_leader();
  delete from fl_player_skills where user_id = p_user and not (skill_id = any (coalesce(p_skills, '{}')));
  insert into fl_player_skills (user_id, skill_id) select p_user, x from unnest(coalesce(p_skills, '{}')) x on conflict do nothing;
  perform fl_log('skill assegnate', jsonb_build_object('user', p_user, 'skills', p_skills));
end $$;

create or replace function public.fl_save_skill(p_id bigint, p_name text, p_kind text, p_description text, p_rule jsonb, p_active boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_old fl_skills; v_id bigint;
begin
  perform fl_require_leader();
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' or not (p_rule ? 'to') then raise exception 'Regola della skill non valida'; end if;
  if p_id is null then
    insert into fl_skills (code, name, kind, description, rule, active, updated_by)
    values ('custom-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, trim(p_name), p_kind, coalesce(p_description, ''), p_rule, coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    select * into v_old from fl_skills where id = p_id;
    update fl_skills set name = trim(p_name), kind = p_kind, description = coalesce(p_description, ''), rule = p_rule,
      active = coalesce(p_active, true), updated_at = now(), updated_by = auth.uid() where id = p_id returning id into v_id;
  end if;
  perform fl_log('skill salvata', jsonb_build_object('id', v_id, 'old', to_jsonb(v_old), 'name', p_name, 'rule', p_rule, 'active', p_active));
  return v_id;
end $$;

-- ricalcolo controllato di tutte le giornate (le differenze sui definitivi diventano revisioni)
create or replace function public.fl_recompute_all() returns int
language plpgsql security definer set search_path = public as $$
declare v uuid; n int := 0;
begin
  perform fl_require_leader();
  for v in select m.id from matches m join results r on r.match_id = m.id and r.status = 'homologated' where m.status <> 'cancelled' order by m.starts_at loop
    perform fl_compute_match(v); n := n + 1;
  end loop;
  perform fl_log('ricalcolo completo', jsonb_build_object('giornate', n));
  return n;
end $$;

-- controlli per il pannello: dati mancanti e stato dei calcoli
create or replace function public.fl_checks() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform fl_require_leader();
  return jsonb_build_object(
    'unlinked_presets', (select coalesce(jsonb_agg(name order by sort), '[]') from fl_presets p where not exists (select 1 from fl_players f where f.preset_code = p.code)),
    'eligible', (select count(*) from fl_players where eligible),
    'matches_final', (select count(distinct match_id) from fl_points where status = 'final'),
    'matches_provisional', (select count(distinct match_id) from fl_points where status = 'provisional'),
    'homologated_without_points', (select count(*) from matches m join results r on r.match_id = m.id and r.status = 'homologated'
                                   where m.status <> 'cancelled' and not exists (select 1 from fl_points p where p.match_id = m.id)),
    'without_votes', (select count(*) from matches m join results r on r.match_id = m.id and r.status = 'homologated'
                      where m.status <> 'cancelled' and m.votes_closes_at < now()
                        and (select count(distinct voter_id) from player_votes v where v.match_id = m.id) < 2),
    'revisions', (select count(*) from fl_points_revisions),
    'teams', (select count(*) from fl_teams)
  );
end $$;

do $$ declare f text; begin
  foreach f in array array['fl_set_market(boolean)', 'fl_save_player(uuid, boolean, int, text)', 'fl_link_preset(text, uuid)',
                           'fl_set_player_skills(uuid, bigint[])', 'fl_save_skill(bigint, text, text, text, jsonb, boolean)',
                           'fl_recompute_all()', 'fl_checks()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- le schede e le skill del documento
insert into public.fl_presets (code, name, price, description, sort) values
('manuel', 'Manuel', 40, 'Macchina da guerra che garantisce bonus e presenze. Lato negativo, ha sempre un avversario che si dedica esclusivamente a lui.', 1),
('antonio', 'Antonio', 35, 'Giocatore che assicura gol in abbondanza, un top per le statistiche. Lato negativo, verso fine partita cala fisicamente e potrebbe lasciare punti per strada.', 2),
('damiano', 'Damiano', 35, 'Gol straordinari e presenze assicurate, uno dei top. Lato negativo, spesso preferisce l''estetica al concreto.', 3),
('ludovico', 'Ludovico', 35, 'Giocatore totale, una certezza per voto e prestazioni. Lato negativo, rapporto occasioni/gol degno di nota sul registro.', 4),
('bog', 'Bog', 25, 'El Pibe de Rame. Dribbling, gol e fase difensiva. Giocatore inarrestabile se in giornata. Se non fa 2 finte a ogni avversario che incontra non la passa. Le caviglie di porcellana ne abbassano il prezzo.', 5),
('gl', 'GL', 30, 'Veloce e letale, ogni tanto pecca di pigrizia nei rientri ma perfetto se in squadra con difensori solidi, sicuramente garantisce bonus. Le sue assenze ripetute pesano sul valore.', 6),
('matteusz', 'Matteusz', 25, 'Difensore solido con il guizzo del bomber. Sarebbe un top se non si distraesse per guardare i campi da padel vicino. Regala spesso gioie e altrettanto spesso dolori. Cavallo pazzo.', 7),
('maurizio', 'Maurizio', 20, 'Recordman di presenze, non salta una partita dal ''94. Sicuramente un giocatore importante per l''equilibrio della squadra, meno incisivo però fantacalcisticamente parlando. Comunque una garanzia.', 8),
('paolo', 'Paolo', 15, 'Da quando ha arretrato il suo raggio d''azione in difesa sembra aver trovato una nuova dimensione ed equilibrio. Meno prolifico sul fattore bonus ma garantisce voti buoni e in porta fa la differenza. Qualche acciacco di troppo ne fa perdere qualche certezza sulle presenze.', 9),
('jacopo', 'Jacopo', 15, 'Grande equilibrio tra difesa e attacco, prestazioni costanti: raramente brilla ma non spegne mai la luce.', 10),
('robertone', 'Robertone', 10, 'Grande e grosso e giuggiolone, rappresentazione perfetta di Davide contro Golia. Ha un''ossessione per il suo nemico più piccolo. Prestazioni altalenanti; se preso in giornata buona può dare soddisfazione ai suoi fantallenatori.', 11),
('leader', 'Leader', 10, 'La sua generosità gli fa spesso lasciare il posto e quindi non è più una certezza sulle presenze, ma quando c''è i compagni si sentono galvanizzati e gli avversari intimoriti. Girano voci che ci sia chi voglia la sua testa per prendere il potere. Quotazione che rispecchia il momento, ma il Leader promette cambiamenti.', 12),
('riccardo', 'Riccardo', 15, 'Storicamente altalenante, sta lavorando duro per migliorare sul piano tecnico e atletico. La presenza sempre più frequente e le prestazioni in costante crescita ne alzano il prezzo.', 13),
('marco', 'Marco', 10, 'Difensore roccioso, i suoi avversari escono spesso doloranti: per questo rischia o la grande prestazione o una punizione da parte del Leader. Le sue ginocchia non gli permettono presenze continue.', 14),
('vincenzo', 'Vincenzo', 15, 'Esperienza e dedizione al servizio della squadra. Raramente sbaglia partita; il poco feeling con il gol ne compromette la quotazione, ma il rapporto qualità prezzo è ottimo.', 15),
('max', 'Max', 10, 'Spesso sotto i riflettori, a volte in positivo a volte in negativo. Confidenza con il gol e presenze numerose assicurano voto e bonus.', 16),
('bobo', 'Bobo', 10, 'Prestazioni pazze in ogni partita, gol da capogiro e papere da presa in giro. Può essere l''arma in più se inserito nel giusto contesto.', 17),
('ben', 'Ben', 5, 'Tanta corsa e tanto cuore, con il vizietto del gol. Caviglie, lavoro, viaggi e minivan ne compromettono le presenze.', 18),
('renzo', 'Renzo', 5, '0 presenze nell''ultimo anno, ma promette un cambio di registro. Skill importante che potrebbe dare vantaggi.', 19),
('gianni', 'Gianni', 5, '0 presenze nell''ultimo anno, ma promette un cambio di registro. In campo garantisce solidità e pochi gol subiti: un ottimo acquisto se torna arruolabile.', 20),
('carlo', 'Carlo', 5, 'Qualità indiscutibile, garantisce ottimi voti e gioco. Non un portatore di bonus, ma se è in campo si sente.', 21);

insert into public.fl_skills (code, preset_code, name, kind, description, rule) values
('manuel+',   'manuel',   'Manuel +',     'pos', 'Se vince senza fare gol, tutti i suoi compagni di squadra guadagnano +5 punti.', '{"outcome":"W","goals_max":0,"amount":5,"to":"teammates"}'),
('manuel-1',  'manuel',   'Manuel −',     'neg', 'Se non segna e perde, lui e tutti i suoi compagni di squadra prendono 0 punti.', '{"outcome":"L","goals_max":0,"zero":true,"to":"self_teammates"}'),
('manuel-2',  'manuel',   'Manuel − (gol)', 'neg', 'Se segna meno di 3 gol, lui prende −3 punti.', '{"goals_max":2,"amount":-3,"to":"self"}'),
('antonio+',  'antonio',  'Antonio +',    'pos', 'Se vince segnando almeno 5 gol, tutta la sua squadra prende +1 punto.', '{"outcome":"W","goals_min":5,"amount":1,"to":"self_teammates"}'),
('antonio-',  'antonio',  'Antonio −',    'neg', 'Se segna almeno 3 gol e perde, lui e tutti i suoi compagni di squadra prendono −1 punto.', '{"outcome":"L","goals_min":3,"amount":-1,"to":"self_teammates"}'),
('damiano+',  'damiano',  'Damiano +',    'pos', 'Se vince e la sua squadra subisce meno di 6 gol, lui prende +3 punti.', '{"outcome":"W","conceded_lt":6,"amount":3,"to":"self"}'),
('damiano-',  'damiano',  'Damiano −',    'neg', 'Se perde, tutta la squadra prende −0,25 per ogni gol fatto da lui.', '{"outcome":"L","per":"goal","amount":-0.25,"to":"self_teammates"}'),
('ludovico+', 'ludovico', 'Ludovico +',   'pos', 'Se vince segnando meno di 3 gol, lui e tutta la sua squadra prendono +2 punti.', '{"outcome":"W","goals_max":2,"amount":2,"to":"self_teammates"}'),
('ludovico-', 'ludovico', 'Ludovico −',   'neg', 'Se segna almeno 3 gol e perde, lui e tutti i suoi compagni di squadra prendono −1 punto.', '{"outcome":"L","goals_min":3,"amount":-1,"to":"self_teammates"}'),
('bog+',      'bog',      'Bog +',        'pos', 'La sua presenza fa guadagnare a tutta la sua fantasquadra +1 punto (il bonus cresce di +1 a ogni partita consecutiva).', '{"per":"consecutive","amount":1,"to":"fanta_others"}'),
('bog-',      'bog',      'Bog −',        'neg', 'Se segna almeno 3 gol e perde, tutta la sua fantasquadra prende −1 punto.', '{"outcome":"L","goals_min":3,"amount":-1,"to":"fanta_others"}'),
('gl+',       'gl',       'GL +',         'pos', 'Se vince segnando almeno 5 gol, lui e tutta la sua fantasquadra prendono +1 punto.', '{"outcome":"W","goals_min":5,"amount":1,"to":"fanta_all"}'),
('gl-',       'gl',       'GL −',         'neg', 'Se segna almeno 3 gol e perde, lui e tutti i suoi compagni di fantasquadra prendono −1 punto.', '{"outcome":"L","goals_min":3,"amount":-1,"to":"fanta_all"}'),
('matteusz+', 'matteusz', 'Matteusz +',   'pos', 'Se vince ed è il migliore in campo, tutta la sua squadra prende +2 punti.', '{"outcome":"W","mvp":true,"amount":2,"to":"self_teammates"}'),
('matteusz-', 'matteusz', 'Matteusz −',   'neg', 'Se perde ed è il peggiore della sua squadra, tutta la squadra prende −2 punti.', '{"outcome":"L","worst":true,"amount":-2,"to":"self_teammates"}'),
('maurizio+', 'maurizio', 'Maurizio +',   'pos', 'A ogni suo gol guadagna un ulteriore +0,5.', '{"per":"goal","amount":0.5,"to":"self"}'),
('maurizio-', 'maurizio', 'Maurizio −',   'neg', 'A ogni gol subito dalla squadra prende −0,25.', '{"per":"conceded","amount":-0.25,"to":"self"}'),
('paolo+',    'paolo',    'Paolo +',      'pos', 'Se la sua squadra subisce meno di 6 gol, lui e tutta la sua squadra prendono +1 punto.', '{"conceded_lt":6,"amount":1,"to":"self_teammates"}'),
('paolo-',    'paolo',    'Paolo −',      'neg', 'Se perde, a ogni gol subito dalla squadra prende −0,25.', '{"outcome":"L","per":"conceded","amount":-0.25,"to":"self"}'),
('jacopo',    'jacopo',   'Jacopo',       'pos', 'Fa prendere a tutta la sua fantasquadra +0,5 o −0,5 in base alla differenza reti della partita (0 col pareggio).', '{"per":"diff_sign","amount":0.5,"to":"fanta_others"}'),
('robertone+','robertone','Robertone +',  'pos', 'Ogni gol che fa in più di Bobo prende +0,5 (se Bobo gioca).', '{"per":"goals_vs","vs":"bobo","sign":"pos","amount":0.5,"to":"self"}'),
('robertone-','robertone','Robertone −',  'neg', 'Ogni gol che fa in meno di Bobo prende −0,5 (se Bobo gioca).', '{"per":"goals_vs","vs":"bobo","sign":"neg","amount":0.5,"to":"self"}'),
('leader+',   'leader',   'Leader +',     'pos', 'La sua fantasquadra prende in automatico +1, a ogni giornata.', '{"when":"always","amount":1,"to":"fanta_others"}'),
('leader-',   'leader',   'Leader −',     'neg', 'I suoi avversari in campo prendono −1.', '{"amount":-1,"to":"opponents"}'),
('riccardo+', 'riccardo', 'Riccardo +',   'pos', 'Se vince e ha una media voto sopra 6,5 prende +2.', '{"outcome":"W","avg_gt":6.5,"amount":2,"to":"self"}'),
('riccardo-', 'riccardo', 'Riccardo −',   'neg', 'Se perde e ha una media sotto 6 prende −2.', '{"outcome":"L","avg_lt":6,"amount":-2,"to":"self"}'),
('marco+',    'marco',    'Marco +',      'pos', 'Se la sua squadra subisce meno di 6 gol, lui e tutta la sua squadra prendono +2 punti.', '{"conceded_lt":6,"amount":2,"to":"self_teammates"}'),
('marco-',    'marco',    'Marco −',      'neg', 'Se perde, a ogni gol subito dalla squadra prende −0,25.', '{"outcome":"L","per":"conceded","amount":-0.25,"to":"self"}'),
('vincenzo+', 'vincenzo', 'Vincenzo +',   'pos', 'Ogni suo gol porta +0,5 punti.', '{"per":"goal","amount":0.5,"to":"self"}'),
('vincenzo-', 'vincenzo', 'Vincenzo −',   'neg', 'Se perde, prende −0,25 per ogni gol di differenza dagli avversari.', '{"outcome":"L","per":"diff_abs","amount":-0.25,"to":"self"}'),
('max+',      'max',      'Max +',        'pos', 'Se vince segnando almeno 3 gol, tutta la squadra prende +1 punto.', '{"outcome":"W","goals_min":3,"amount":1,"to":"self_teammates"}'),
('max-',      'max',      'Max −',        'neg', 'Se perde segnando meno di 3 gol, lui prende −1.', '{"outcome":"L","goals_max":2,"amount":-1,"to":"self"}'),
('bobo+',     'bobo',     'Bobo +',       'pos', 'Ogni suo gol fa prendere +0,5 punti a tutta la squadra.', '{"per":"goal","amount":0.5,"to":"self_teammates"}'),
('bobo-',     'bobo',     'Bobo −',       'neg', 'Se perde, a ogni gol subito dalla squadra prende −0,25.', '{"outcome":"L","per":"conceded","amount":-0.25,"to":"self"}'),
('ben+1',     'ben',      'Ben +',        'pos', 'Se è presente, tutti i suoi compagni della fantasquadra prendono +1.', '{"amount":1,"to":"fanta_others"}'),
('ben+2',     'ben',      'Ben + (assente)', 'pos', 'Se assente prende la metà del punteggio più basso dei presenti.', '{"when":"absent","special":"half_lowest","to":"self"}'),
('ben-',      'ben',      'Ben −',        'neg', 'Se perde ed è il peggiore in campo della sua squadra, tutti i suoi compagni prendono −1.', '{"outcome":"L","worst":true,"amount":-1,"to":"teammates"}'),
('renzo+',    'renzo',    'Renzo +',      'pos', 'A ogni suo gol prende +2 punti.', '{"per":"goal","amount":2,"to":"self"}'),
('renzo-',    'renzo',    'Renzo −',      'neg', 'Se perde, tutta la squadra prende −0,5 per ogni gol fatto da lui.', '{"outcome":"L","per":"goal","amount":-0.5,"to":"self_teammates"}'),
('gianni+',   'gianni',   'Gianni +',     'pos', 'Se vince, tutti i suoi compagni prendono +3 punti.', '{"outcome":"W","amount":3,"to":"teammates"}'),
('gianni-',   'gianni',   'Gianni −',     'neg', 'Se perde, tutta la squadra prende −0,25 per ogni gol di differenza.', '{"outcome":"L","per":"diff_abs","amount":-0.25,"to":"self_teammates"}'),
('carlo+',    'carlo',    'Carlo +',      'pos', 'Tutta la squadra parte con +3.', '{"amount":3,"to":"self_teammates"}');
