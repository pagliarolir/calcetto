-- =====================================================================
-- Formazioni, risultato, marcatori, votazioni
-- =====================================================================

create or replace function public.is_participant(p_match uuid, p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bookings where match_id = p_match and user_id = p_uid and list = 'team')
$$;

create or replace function public.team_label(p_team text) returns text
language sql immutable as $$ select case p_team when 'white' then 'Bianchi' else 'Neri' end $$;

-- ---------------------------------------------------------------------
-- Formazioni (REQ-026..REQ-032)
-- ---------------------------------------------------------------------

-- REQ-028: il Leader sceglie chi fa le formazioni per una partita
create or replace function public.set_lineup_delegate(p_match uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può affidare le formazioni'; end if;
  update matches set lineup_delegate = p_user where id = p_match;
  if p_user is not null then
    perform notify(array[p_user], 'lineup_delegate', 'Fai tu le squadre',
      'Il Leader ti ha affidato le formazioni di questa partita.', '/partita/' || p_match || '/squadre', p_match);
  end if;
end $$;

-- Notifica personalizzata col colore di ciascuno (REQ-031)
create or replace function public.announce_lineup(p_match uuid, p_update boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  foreach t in array array['white','black'] loop
    perform notify(
      array(select user_id from lineup where match_id = p_match and team = t),
      case when p_update then 'lineup_change' else 'lineup_official' end,
      case when p_update then 'Formazioni aggiornate' else 'Formazioni ufficiali' end,
      'Giochi con i ' || team_label(t) || '. Guarda come vi siete disposti in campo.',
      '/partita/' || p_match || '/squadre', p_match);
  end loop;
  -- chi è in squadra ma non ancora assegnato a un colore
  perform notify(
    array(select b.user_id from bookings b where b.match_id = p_match and b.list = 'team'
          and not exists (select 1 from lineup l where l.match_id = p_match and l.user_id = b.user_id)),
    'lineup_official', case when p_update then 'Formazioni aggiornate' else 'Formazioni ufficiali' end,
    'Le squadre sono fatte, il tuo colore deve ancora essere deciso.',
    '/partita/' || p_match || '/squadre', p_match);
end $$;

-- p_entries: [{"user_id":"…","team":"white","field_slot":1}, …]
create or replace function public.save_lineup(p_match uuid, p_entries jsonb, p_publish boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
  v_staff boolean := is_staff(v_uid);
  v_delegate boolean;
  v_was_official boolean;
  v_bad text;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'Partita inesistente'; end if;
  v_delegate := m.lineup_delegate = v_uid;
  if not (v_staff or v_delegate) then raise exception 'Non puoi fare le formazioni di questa partita'; end if;
  if m.locked and not has_leader_powers(v_uid) then raise exception 'La partita è chiusa'; end if;
  if now() < lineup_opens_at(m) then
    raise exception 'Le formazioni si possono fare da %', fmt_when(lineup_opens_at(m));
  end if;
  if not v_staff and m.lineup_status <> 'draft' then
    raise exception 'La proposta è già stata inviata';
  end if;

  -- validazione: solo giocatori in squadra, colori bianchi/neri, posizioni uniche
  select string_agg(display_name(x.user_id), ', ') into v_bad
  from jsonb_to_recordset(p_entries) as x(user_id uuid, team text, field_slot smallint)
  where not is_participant(p_match, x.user_id);
  if v_bad is not null then raise exception 'Non sono tra i 10: %', v_bad; end if;

  delete from lineup where match_id = p_match;
  insert into lineup (match_id, user_id, team, field_slot)
  select p_match, x.user_id, x.team, x.field_slot
  from jsonb_to_recordset(p_entries) as x(user_id uuid, team text, field_slot smallint);

  v_was_official := m.lineup_status = 'official';

  if v_staff and (p_publish or v_was_official) then
    update matches set lineup_status = 'official' where id = p_match;
    perform announce_lineup(p_match, v_was_official);
    return 'official';
  elsif not v_staff and p_publish then
    -- REQ-029: la proposta del delegato va approvata
    update matches set lineup_status = 'pending', lineup_proposed_by = v_uid where id = p_match;
    perform notify(staff_ids(), 'lineup_review', 'Formazioni da approvare',
      display_name(v_uid) || ' ha proposto le squadre.', '/partita/' || p_match || '/squadre', p_match);
    return 'pending';
  end if;
  return m.lineup_status;
end $$;

create or replace function public.review_lineup(p_match uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  if not is_staff() then raise exception 'Solo Leader e Premier approvano le formazioni'; end if;
  select * into m from matches where id = p_match for update;
  if m.lineup_status <> 'pending' then raise exception 'Non c''è nessuna proposta da valutare'; end if;
  if p_approve then
    update matches set lineup_status = 'official' where id = p_match;
    perform announce_lineup(p_match, false);
  else
    update matches set lineup_status = 'draft' where id = p_match;
    perform notify(array[m.lineup_proposed_by], 'lineup_rejected', 'Proposta da rivedere',
      'Le formazioni non sono state approvate: puoi modificarle e riproporle.',
      '/partita/' || p_match || '/squadre', p_match);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Risultato (REQ-033..REQ-040)
-- ---------------------------------------------------------------------

-- Controllo coerenza marcatori/risultato (REQ-038). Restituisce l'elenco dei problemi.
create or replace function public.scorer_issues(p_match uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  r results;
  v_issues text[] := '{}';
  w_cred int; b_cred int; w_ast int; b_ast int; w_g int; b_g int;
begin
  select * into r from results where match_id = p_match;
  select
    coalesce(sum(case when l.team = 'white' then s.goals else 0 end), 0)
      + coalesce(sum(case when l.team = 'black' then s.own_goals else 0 end), 0),
    coalesce(sum(case when l.team = 'black' then s.goals else 0 end), 0)
      + coalesce(sum(case when l.team = 'white' then s.own_goals else 0 end), 0),
    coalesce(sum(case when l.team = 'white' then s.assists else 0 end), 0),
    coalesce(sum(case when l.team = 'black' then s.assists else 0 end), 0),
    coalesce(sum(case when l.team = 'white' then s.goals else 0 end), 0),
    coalesce(sum(case when l.team = 'black' then s.goals else 0 end), 0)
  into w_cred, b_cred, w_ast, b_ast, w_g, b_g
  from scorers s join lineup l on l.match_id = s.match_id and l.user_id = s.user_id
  where s.match_id = p_match;

  if w_ast > w_g then v_issues := v_issues || 'I Bianchi hanno più assist che gol segnati'; end if;
  if b_ast > b_g then v_issues := v_issues || 'I Neri hanno più assist che gol segnati'; end if;
  if r.white_goals is not null then
    if w_cred > r.white_goals then
      v_issues := v_issues || format('Ai Bianchi risultano %s gol, ma ne hanno segnati %s', w_cred, r.white_goals);
    end if;
    if b_cred > r.black_goals then
      v_issues := v_issues || format('Ai Neri risultano %s gol, ma ne hanno segnati %s', b_cred, r.black_goals);
    end if;
  end if;
  return v_issues;
end $$;

create or replace function public.submit_result(
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
  if p_diff is null then raise exception 'Indica il risultato'; end if;

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
    when p_white is not null then format('Bianchi %s - %s Neri', p_white, p_black)
    when p_diff = 0 then 'Pareggio'
    when p_diff > 0 then format('Bianchi vincono di %s', p_diff)
    else format('Neri vincono di %s', -p_diff) end;

  if m.locked then
    perform notify(array(select user_id from bookings where match_id = p_match and list = 'team'),
      'result_final', 'Risultato corretto dal Leader', v_text, '/partita/' || p_match || '/risultato', p_match);
  else
    perform notify(array(select user_id from bookings where match_id = p_match and list = 'team' and user_id <> v_uid),
      'result_review', 'Risultato inserito: ' || v_text,
      display_name(v_uid) || ' ha inserito il risultato. Confermi?', '/partita/' || p_match || '/risultato', p_match,
      '[{"action":"confirm_result","title":"Confermo"}]'::jsonb);
  end if;
end $$;

create or replace function public.homologate(p_match uuid, p_by text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update results set status = 'homologated', homologated_by = p_by, homologated_at = now()
  where match_id = p_match and status = 'pending';
  if found then
    perform notify(array(select user_id from bookings where match_id = p_match and list = 'team'),
      'result_homologated', 'Risultato omologato', 'Il risultato è ufficiale.',
      '/partita/' || p_match || '/risultato', p_match);
  end if;
end $$;

-- REQ-035/036: conferma o contesta
create or replace function public.review_result(p_match uuid, p_agree boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches; r results;
  v_uid uuid := auth.uid();
  v_agree int;
begin
  select * into m from matches where id = p_match for update;
  select * into r from results where match_id = p_match;
  if not found then raise exception 'Non c''è ancora un risultato'; end if;
  if not is_participant(p_match, v_uid) then raise exception 'Può confermare solo chi ha giocato'; end if;
  if r.status <> 'pending' then raise exception 'Il risultato è già omologato'; end if;
  if m.locked then raise exception 'Tempo scaduto: ora omologano Leader e Premier'; end if;
  if r.entered_by = v_uid then raise exception 'Non puoi confermare il risultato che hai inserito tu'; end if;

  insert into result_reviews (match_id, user_id, agree, note) values (p_match, v_uid, p_agree, p_note)
  on conflict (match_id, user_id) do update set agree = excluded.agree, note = excluded.note, at = now();

  select count(*) into v_agree from result_reviews where match_id = p_match and agree;
  if v_agree >= (select quorum from app_settings where id = 1) then
    perform homologate(p_match, 'quorum');
  elsif not p_agree then
    perform notify(array[r.entered_by] || staff_ids(), 'result_contested', 'Risultato contestato',
      display_name(v_uid) || ' non è d''accordo' || coalesce(': ' || p_note, '.'),
      '/partita/' || p_match || '/risultato', p_match);
  end if;
end $$;

-- REQ-039: senza quorum entro mezzanotte omologano Leader o Premier
create or replace function public.staff_homologate(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m matches;
begin
  select * into m from matches where id = p_match;
  if has_leader_powers() then
    perform homologate(p_match, 'leader');
  elsif is_staff() then
    if now() < lock_at(m) then raise exception 'Fino a mezzanotte decidono le conferme dei giocatori'; end if;
    perform homologate(p_match, 'staff');
  else
    raise exception 'Solo Leader e Premier possono omologare';
  end if;
end $$;

-- REQ-037: gol, assist, autogol. p_rows: [{"user_id":"…","goals":2,"assists":1,"own_goals":0}, …]
create or replace function public.save_scorers(p_match uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
  v_issues text[];
begin
  select * into m from matches where id = p_match for update;
  if not (is_participant(p_match, v_uid) or is_staff(v_uid)) then raise exception 'Solo chi ha giocato'; end if;
  if now() < result_opens_at(m) then raise exception 'I marcatori si inseriscono a fine partita'; end if;
  if m.locked and not has_leader_powers(v_uid) then raise exception 'Marcatori chiusi: solo il Leader può modificarli'; end if;

  insert into scorers as s (match_id, user_id, goals, assists, own_goals, updated_by, updated_at)
  select p_match, x.user_id, coalesce(x.goals, 0), coalesce(x.assists, 0), coalesce(x.own_goals, 0), v_uid, now()
  from jsonb_to_recordset(p_rows) as x(user_id uuid, goals int, assists int, own_goals int)
  where is_participant(p_match, x.user_id)
  on conflict (match_id, user_id) do update set
    goals = excluded.goals, assists = excluded.assists, own_goals = excluded.own_goals,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  delete from scorers where match_id = p_match and goals = 0 and assists = 0 and own_goals = 0;

  v_issues := scorer_issues(p_match);
  if array_length(v_issues, 1) > 0 then
    raise exception '%', array_to_string(v_issues, '. ');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Votazioni (REQ-041..REQ-046)
-- ---------------------------------------------------------------------

-- p_votes: [{"target_id":"…","score":6.5}, …]
create or replace function public.submit_votes(
  p_match uuid, p_votes jsonb, p_white_pick uuid default null, p_black_pick uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
begin
  select * into m from matches where id = p_match;
  if not is_participant(p_match, v_uid) then raise exception 'Vota solo chi ha giocato'; end if;
  if now() < result_opens_at(m) then raise exception 'Si vota da %', fmt_when(result_opens_at(m)); end if;
  if now() > votes_close_at(m) then raise exception 'Le votazioni sono chiuse'; end if;
  if p_white_pick is not null and not exists (select 1 from lineup where match_id = p_match and user_id = p_white_pick and team = 'white') then
    raise exception 'Il migliore dei Bianchi deve essere un giocatore dei Bianchi';
  end if;
  if p_black_pick is not null and not exists (select 1 from lineup where match_id = p_match and user_id = p_black_pick and team = 'black') then
    raise exception 'Il migliore dei Neri deve essere un giocatore dei Neri';
  end if;

  insert into player_votes as v (match_id, voter_id, target_id, score)
  select p_match, v_uid, x.target_id, x.score
  from jsonb_to_recordset(p_votes) as x(target_id uuid, score numeric)
  where x.target_id <> v_uid and is_participant(p_match, x.target_id) and x.score is not null
  on conflict (match_id, voter_id, target_id) do update set score = excluded.score;

  insert into mvp_votes (match_id, voter_id, white_pick, black_pick)
  values (p_match, v_uid, nullif(p_white_pick, v_uid), nullif(p_black_pick, v_uid))
  on conflict (match_id, voter_id) do update set white_pick = excluded.white_pick, black_pick = excluded.black_pick;
end $$;

-- Scelte del migliore in campo, esplicite o dedotte dai voti (REQ-044)
create or replace function public.mvp_picks(p_match uuid)
returns table (voter_id uuid, team text, pick uuid, deduced boolean)
language sql stable security definer set search_path = public as $$
  with voters as (
    select voter_id from player_votes where match_id = p_match
    union
    select voter_id from mvp_votes where match_id = p_match
  ),
  ranked as (
    select v.voter_id, l.team, v.target_id,
           row_number() over (partition by v.voter_id, l.team order by v.score desc, v.target_id) as rn
    from player_votes v join lineup l on l.match_id = v.match_id and l.user_id = v.target_id
    where v.match_id = p_match
  ),
  teams as (select unnest(array['white','black']) as team)
  select vt.voter_id, t.team,
         coalesce(case t.team when 'white' then e.white_pick else e.black_pick end, r.target_id),
         (case t.team when 'white' then e.white_pick else e.black_pick end) is null
  from voters vt
  cross join teams t
  left join mvp_votes e on e.match_id = p_match and e.voter_id = vt.voter_id
  left join ranked r on r.voter_id = vt.voter_id and r.team = t.team and r.rn = 1
$$;

-- Medie e migliori in campo, visibili a tutti solo dopo almeno 5 votanti (REQ-043)
create or replace function public.vote_summary(p_match uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_voters int;
  v_min int;
  v_result jsonb;
begin
  select vote_min_voters into v_min from app_settings where id = 1;
  select count(distinct voter_id) into v_voters from (
    select voter_id from player_votes where match_id = p_match
    union select voter_id from mvp_votes where match_id = p_match) x;

  if v_voters < v_min and not has_leader_powers() then
    return jsonb_build_object('voters', v_voters, 'threshold', v_min, 'players', null,
                              'my_votes_done', exists (select 1 from player_votes where match_id = p_match and voter_id = auth.uid()));
  end if;

  with avgs as (
    select target_id as user_id, round(avg(score), 2) as avg_score, count(*) as votes
    from player_votes where match_id = p_match group by target_id
  ),
  mvp as (
    select pick as user_id, team, count(*) as mvp_votes from mvp_picks(p_match) where pick is not null group by pick, team
  ),
  mvp_top as (
    select user_id, mvp_votes, mvp_votes = max(mvp_votes) over (partition by team) as is_mvp from mvp
  )
  select jsonb_agg(jsonb_build_object(
           'user_id', b.user_id, 'avg', a.avg_score, 'votes', coalesce(a.votes, 0),
           'mvp_votes', coalesce(t.mvp_votes, 0), 'is_mvp', coalesce(t.is_mvp, false))
         order by a.avg_score desc nulls last)
  into v_result
  from bookings b
  left join avgs a on a.user_id = b.user_id
  left join mvp_top t on t.user_id = b.user_id
  where b.match_id = p_match and b.list = 'team';

  return jsonb_build_object('voters', v_voters, 'threshold', v_min, 'players', coalesce(v_result, '[]'::jsonb),
                            'my_votes_done', exists (select 1 from player_votes where match_id = p_match and voter_id = auth.uid()));
end $$;

-- REQ-046: il Leader concede a qualcuno di vedere i voti di una partita
create or replace function public.grant_vote_visibility(p_match uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_until timestamptz;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può mostrare i voti'; end if;
  select * into m from matches where id = p_match;
  if now() > ends_at(m) + interval '24 hours' then
    raise exception 'I voti si possono condividere solo nelle 24 ore dopo la partita';
  end if;
  select starts_at - interval '24 hours' into v_until from matches
  where starts_at > m.starts_at and status <> 'cancelled' order by starts_at limit 1;
  v_until := coalesce(v_until, m.starts_at + interval '6 days');

  insert into vote_grants (match_id, user_id, until)
  select p_match, u, v_until from unnest(p_users) u
  on conflict (match_id, user_id) do update set until = excluded.until;

  perform notify(p_users, 'vote_grant', 'Puoi vedere i voti',
    'Il Leader ti mostra chi ha votato cosa, fino a ' || fmt_when(v_until) || '.',
    '/partita/' || p_match || '/voti', p_match);
end $$;

create or replace function public.can_see_votes(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_leader_powers()
      or exists (select 1 from vote_grants where match_id = p_match and user_id = auth.uid() and until > now())
$$;
