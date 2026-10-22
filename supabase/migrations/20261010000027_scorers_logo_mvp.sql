-- =====================================================================
-- Marcatori, omologazione, durata, logo e migliore in campo
--  * marcatori: ognuno inserisce solo i propri gol/assist/autogol; il Leader
--    quelli di tutti; i dati inseriti dal Leader non si cambiano dagli altri;
--  * il risultato lo omologa il Leader (o chi ne fa le veci): niente più
--    omologazione automatica con le conferme né da parte dei Premier;
--  * durata della partita configurabile da 1 a 90 minuti (predefinita 60);
--  * logo dell'app caricato dal Leader (contenitore pubblico "branding");
--  * un solo migliore in campo per partita (le partite già votate restano
--    con la regola "uno per squadra", così lo storico non cambia).
-- =====================================================================

alter table public.scorers add column set_by_leader boolean not null default false;

alter table public.matches add constraint matches_duration_range check (duration_min between 1 and 90);
alter table public.app_settings add constraint app_settings_duration_range check (duration_min between 1 and 90);

alter table public.matches add column mvp_mode text not null default 'single' check (mvp_mode in ('single', 'per_team'));
update public.matches m set mvp_mode = 'per_team'
 where m.status <> 'scheduled'
    or exists (select 1 from public.player_votes v where v.match_id = m.id)
    or exists (select 1 from public.mvp_votes e where e.match_id = m.id);

-- chi ha i poteri del Leader (titolare, chi ne fa le veci, delegato)
create or replace function public.leader_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from profiles where active and not guest and has_leader_powers(id)
$$;

-- ---------------------------------------------------------------------
-- Logo dell'app: file pubblici (il telefono li scarica senza accesso per l'icona)
-- ---------------------------------------------------------------------
alter table public.app_settings add column logo_id uuid;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576, array['image/png'])
on conflict (id) do nothing;

create policy "logo: lo carica il Leader" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.has_leader_powers());
create policy "logo: lo cambia il Leader" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.has_leader_powers());
create policy "logo: lo toglie il Leader" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.has_leader_powers());

create or replace function public.set_app_logo(p_logo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader cambia il logo'; end if;
  update app_settings set logo_id = p_logo where id = 1;
end $$;

-- leggibile anche prima di accedere: serve per l'icona dell'app
create or replace function public.app_branding() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('logo_id', logo_id) from app_settings where id = 1
$$;

-- ---------------------------------------------------------------------
-- Funzioni esistenti adattate (testo originale con modifiche mirate)
-- ---------------------------------------------------------------------

create or replace function public.save_scorers_unchecked(p_match uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
  v_leader boolean := has_leader_powers(v_uid);
  v_issues text[];
begin
  select * into m from matches where id = p_match for update;
  if not (is_participant(p_match, v_uid) or v_leader) then raise exception 'Solo chi ha giocato'; end if;
  if now() < result_opens_at(m) then raise exception 'I marcatori si inseriscono a fine partita'; end if;
  if m.locked and not v_leader then raise exception 'Marcatori chiusi: solo il Leader può modificarli'; end if;

  -- ognuno inserisce solo i propri gol, assist e autogol; il Leader quelli di tutti
  if not v_leader then
    if exists (select 1 from jsonb_to_recordset(p_rows) as x(user_id uuid) where x.user_id is distinct from v_uid) then
      raise exception 'Puoi inserire solo i tuoi gol, assist e autogol';
    end if;
    -- i dati inseriti dal Leader non si cambiano
    if exists (select 1 from scorers where match_id = p_match and user_id = v_uid and set_by_leader) then
      raise exception 'I tuoi dati li ha inseriti il Leader: non si possono cambiare';
    end if;
  end if;

  insert into scorers as s (match_id, user_id, goals, assists, own_goals, updated_by, updated_at, set_by_leader)
  select p_match, x.user_id, coalesce(x.goals, 0), coalesce(x.assists, 0), coalesce(x.own_goals, 0), v_uid, now(), v_leader
  from jsonb_to_recordset(p_rows) as x(user_id uuid, goals int, assists int, own_goals int)
  where is_participant(p_match, x.user_id)
  on conflict (match_id, user_id) do update set
    goals = excluded.goals, assists = excluded.assists, own_goals = excluded.own_goals,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at, set_by_leader = excluded.set_by_leader;
  -- le righe a zero si tolgono, tranne quelle fissate dal Leader (restano bloccate)
  delete from scorers where match_id = p_match and goals = 0 and assists = 0 and own_goals = 0 and not set_by_leader;

  v_issues := scorer_issues(p_match);
  if array_length(v_issues, 1) > 0 then
    raise exception '%', array_to_string(v_issues, '. ');
  end if;
end $$;

create or replace function public.scorer_issues(p_match uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  r results;
  m matches;
  v_issues text[] := '{}';
  w_cred int; b_cred int; w_ast int; b_ast int; w_g int; b_g int;
begin
  select * into r from results where match_id = p_match;
  select * into m from matches where id = p_match;
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

  -- con l'inserimento di ognuno per sé gli assist si confrontano con i gol del risultato, non con quelli già inseriti
  if r.white_goals is not null and w_ast > r.white_goals then v_issues := v_issues || format('I %s hanno più assist che gol segnati', team_name(m, 'white')); end if;
  if r.black_goals is not null and b_ast > r.black_goals then v_issues := v_issues || format('I %s hanno più assist che gol segnati', team_name(m, 'black')); end if;
  if r.white_goals is not null then
    if w_cred > r.white_goals then
      v_issues := v_issues || format('Ai %s risultano %s gol, ma ne hanno segnati %s', team_name(m, 'white'), w_cred, r.white_goals);
    end if;
    if b_cred > r.black_goals then
      v_issues := v_issues || format('Ai %s risultano %s gol, ma ne hanno segnati %s', team_name(m, 'black'), b_cred, r.black_goals);
    end if;
  end if;
  return v_issues;
end $$;

create or replace function public.review_result_unchecked(p_match uuid, p_agree boolean, p_note text default null) returns void
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
  if m.locked then raise exception 'Tempo scaduto: ora decide il Leader'; end if;
  if r.entered_by = v_uid then raise exception 'Non puoi confermare il risultato che hai inserito tu'; end if;

  insert into result_reviews (match_id, user_id, agree, note) values (p_match, v_uid, p_agree, p_note)
  on conflict (match_id, user_id) do update set agree = excluded.agree, note = excluded.note, at = now();

  -- le conferme aiutano il Leader, che omologa: niente più omologazione automatica
  if not p_agree then
    perform notify(array[r.entered_by] || leader_ids(), 'result_contested', 'Risultato contestato',
      display_name(v_uid) || ' non è d''accordo' || coalesce(': ' || p_note, '.'),
      '/partita/' || p_match || '/risultato', p_match);
  end if;
end $$;

create or replace function public.staff_homologate(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Il risultato lo omologa il Leader'; end if;
  perform homologate(p_match, 'leader');
end $$;

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

create or replace function public.run_scheduler() returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  w record;
  v_url text;
begin
  perform ensure_next_match();

  for m in select * from matches where status = 'scheduled' order by starts_at loop
    v_url := '/partita/' || m.id;

    -- REQ-021: il Leader è sempre il numero 1
    if titular_leader() is not null and m.starts_at > now()
       and not exists (select 1 from bookings where match_id = m.id and user_id = titular_leader()) then
      perform _book(titular_leader(), titular_leader(), m.id, 'present', true);
    end if;

    -- REQ-023: avviso a chi ha una finestra esclusiva
    for w in select * from priority_windows where match_id = m.id and not notified and opens_at <= now() loop
      perform notify(array[w.user_id], 'priority_open', 'Hai la precedenza',
        'Puoi prenotarti prima degli altri per ' || fmt_when(m.starts_at) || '.', v_url, m.id,
        '[{"action":"present","title":"Ci sono"},{"action":"reserve","title":"Riserva"},{"action":"absent","title":"Non ci sono"}]'::jsonb);
      update priority_windows set notified = true where match_id = w.match_id and user_id = w.user_id;
    end loop;

    -- REQ-010: lunedì a mezzogiorno si aprono le prenotazioni
    if not m.sent_open and now() >= m.bookings_open_at then
      perform notify(
        array(select id from profiles where active
              and id not in (select user_id from bookings where match_id = m.id and list <> 'out')),
        'booking_open', 'Si gioca ' || fmt_when(m.starts_at),
        'Prenotazioni aperte. Ci sei?', v_url, m.id,
        '[{"action":"present","title":"Ci sono"},{"action":"reserve","title":"Riserva"},{"action":"absent","title":"Non ci sono"}]'::jsonb);
      update matches set sent_open = true where id = m.id;
    end if;

    -- formazioni: si fanno da subito; a 24 ore dalla partita, promemoria solo se non sono ancora ufficiali
    if not m.sent_lineup_window and now() >= m.starts_at - interval '24 hours' then
      if m.lineup_status <> 'official' then
        perform notify(staff_ids() || array_remove(array[m.lineup_delegate], null), 'lineup_window',
          'Squadre da fare', 'Manca un giorno alla partita e le squadre non sono ancora ufficiali.', v_url || '/squadre', m.id);
      end if;
      update matches set sent_lineup_window = true where id = m.id;
    end if;

    -- REQ-020: alle riserve si chiede conferma (entro 12 ore prima, gradita)
    if not m.sent_reserve_reminder and now() >= m.starts_at - interval '16 hours' then
      perform notify(
        array(select user_id from bookings where match_id = m.id and list = 'reserve' and reserve_reply is null),
        'reserve_check', 'Sei di riserva: ci sei?',
        'Faccelo sapere entro 12 ore dalla partita, così ci organizziamo.', v_url, m.id,
        '[{"action":"reserve_yes","title":"Disponibile"},{"action":"reserve_no","title":"Non posso"}]'::jsonb);
      update matches set sent_reserve_reminder = true where id = m.id;
    end if;

    -- REQ-033: a fine partita il risultato
    if not m.sent_result and now() >= result_opens_at(m) then
      perform notify(array(select user_id from bookings where match_id = m.id and list = 'team'),
        'result_open', 'Com''è finita?', 'Inserisci o conferma il risultato e i marcatori.',
        v_url || '/risultato', m.id);
      update matches set sent_result = true where id = m.id;
    end if;
  end loop;

  -- REQ-041: le votazioni si aprono all'orario impostato per ogni partita (anche dopo la chiusura di mezzanotte)
  for m in select * from matches
           where not sent_votes and status <> 'cancelled' and now() >= votes_opens_at and now() < votes_closes_at loop
    perform notify(array(select user_id from bookings where match_id = m.id and list = 'team'),
      'votes_open', 'Pagelle aperte', 'Vota i compagni e scegli il migliore in campo di ogni squadra.',
      '/partita/' || m.id || '/voti', m.id);
    update matches set sent_votes = true where id = m.id;
  end loop;

  -- REQ-040: a mezzanotte si chiude tutto
  for m in select * from matches where status = 'scheduled' and not locked loop
    if now() >= lock_at(m) then
      update matches set locked = true, status = 'played' where id = m.id;
      if exists (select 1 from results where match_id = m.id and status = 'pending')
         or not exists (select 1 from results where match_id = m.id) then
        -- REQ-039: niente quorum, tocca a Leader e Premier
        perform notify(leader_ids(), 'homologate_needed', 'Risultato da omologare',
          'Il risultato aspetta ancora la tua omologazione.', '/partita/' || m.id || '/risultato', m.id);
      end if;
    end if;
  end loop;

  -- rete di sicurezza: rilancia il dispatcher se qualcosa è rimasto in coda
  if exists (select 1 from notifications where push_claimed_at is null and created_at < now() - interval '2 minutes') then
    perform kick_dispatcher();
  end if;
end $$;

create or replace function public.check_match_config(p jsonb) returns void
language plpgsql immutable as $$
begin
  if p is null or not (p ?& array['players_per_team','team_a_kit','team_b_kit','booking_open_days','booking_open_time',
                                  'booking_close_days','booking_close_time','votes_open_after_min','votes_hours']) then
    raise exception 'Configurazione incompleta';
  end if;
  if (p->>'players_per_team')::int not between 5 and 8 then raise exception 'Si gioca da 5 contro 5 a 8 contro 8'; end if;
  if not (is_kit(p->>'team_a_kit') and is_kit(p->>'team_b_kit')) then raise exception 'Colore delle squadre non valido'; end if;
  if p->>'team_a_kit' = p->>'team_b_kit' then raise exception 'Le due squadre devono avere colori diversi'; end if;
  if (p->>'booking_open_days')::int not between 0 and 14 or (p->>'booking_close_days')::int not between 0 and 14 then
    raise exception 'Apertura e chiusura delle prenotazioni: da 0 a 14 giorni prima';
  end if;
  perform (p->>'booking_open_time')::time, (p->>'booking_close_time')::time;
  if (p->>'votes_open_after_min')::int not between 0 and 2880 then raise exception 'Apertura delle votazioni: da 0 a 2880 minuti dopo la fine'; end if;
  if (p->>'votes_hours')::int not between 1 and 336 then raise exception 'Durata delle votazioni: da 1 a 336 ore'; end if;
  if coalesce(p->>'booking_mode', 'order') not in ('order', 'free') then raise exception 'Modalità di prenotazione non valida'; end if;
  if coalesce((p->>'duration_min')::int, 60) not between 1 and 90 then raise exception 'La durata va da 1 a 90 minuti'; end if;
end $$;

create or replace function public.leader_create_matches(p_dates date[], p_time time, p_config jsonb, p_save_default boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s app_settings;
  d date;
  v_start timestamptz;
  v_id uuid;
  v_created uuid[] := '{}';
  v_skipped date[] := '{}';
  v_leader uuid := titular_leader();
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può creare partite'; end if;
  perform check_match_config(p_config);
  if p_time is null then raise exception 'Indica l''ora della partita'; end if;
  if coalesce(array_length(p_dates, 1), 0) = 0 then raise exception 'Nessuna data scelta'; end if;
  if array_length(p_dates, 1) > 60 then raise exception 'Al massimo 60 partite alla volta'; end if;
  select * into s from app_settings where id = 1;

  for d in select distinct x from unnest(p_dates) x order by x loop
    v_start := (d + p_time) at time zone s.timezone;
    if v_start <= now()
       or exists (select 1 from matches where status <> 'cancelled' and (starts_at at time zone s.timezone)::date = d) then
      v_skipped := v_skipped || d;
      continue;
    end if;
    insert into matches (nominal_date, starts_at, duration_min, bookings_open_at,
                         players_per_team, team_a_kit, team_b_kit, booking_open_days, booking_open_time,
                         booking_close_days, booking_close_time, votes_open_after_min, votes_hours, booking_mode)
    values (d, v_start, coalesce((p_config->>'duration_min')::smallint, s.duration_min), v_start,
            (p_config->>'players_per_team')::smallint, p_config->>'team_a_kit', p_config->>'team_b_kit',
            (p_config->>'booking_open_days')::smallint, (p_config->>'booking_open_time')::time,
            (p_config->>'booking_close_days')::smallint, (p_config->>'booking_close_time')::time,
            (p_config->>'votes_open_after_min')::smallint, (p_config->>'votes_hours')::smallint,
            coalesce(p_config->>'booking_mode', 'order'))
    returning id into v_id;
    -- REQ-021: il Leader è il numero 1
    if v_leader is not null then
      insert into bookings (match_id, user_id, choice, list, sort_key) values (v_id, v_leader, 'present', 'team', '-infinity');
    end if;
    v_created := v_created || v_id;
  end loop;

  if p_save_default then
    perform update_default_match_config(p_config, extract(dow from p_dates[1])::int, p_time);
  end if;
  return jsonb_build_object('created', to_jsonb(v_created), 'skipped', to_jsonb(v_skipped));
end $$;

create or replace function public.update_default_match_config(p_config jsonb, p_weekday int, p_time time) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può cambiare la configurazione'; end if;
  perform check_match_config(p_config);
  if p_weekday not between 0 and 6 then raise exception 'Giorno della settimana non valido'; end if;
  update app_settings set
    game_weekday = p_weekday, game_time = coalesce(p_time, game_time),
    players_per_team = (p_config->>'players_per_team')::smallint,
    team_a_kit = p_config->>'team_a_kit', team_b_kit = p_config->>'team_b_kit',
    booking_days_before = (p_config->>'booking_open_days')::smallint, booking_open_time = (p_config->>'booking_open_time')::time,
    booking_close_days = (p_config->>'booking_close_days')::smallint, booking_close_time = (p_config->>'booking_close_time')::time,
    votes_open_after_min = (p_config->>'votes_open_after_min')::smallint, vote_hours = (p_config->>'votes_hours')::smallint,
    booking_mode = coalesce(p_config->>'booking_mode', 'order'),
    duration_min = coalesce((p_config->>'duration_min')::smallint, duration_min)
  where id = 1;
end $$;

create or replace function public.update_matches_config(p_matches uuid[], p_config jsonb, p_fields text[], p_time time default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  n matches;
  v_count int := 0;
  v_players_changed boolean;
  v_url text;
begin
  if not has_leader_powers() then raise exception 'Solo il Leader può cambiare le partite'; end if;
  perform check_match_config(p_config);
  if 'time' = any (p_fields) and p_time is null then raise exception 'Indica l''ora della partita'; end if;

  for m in select * from matches where id = any (p_matches) order by starts_at for update loop
    if m.status <> 'scheduled' or m.starts_at <= now() then continue; end if;
    v_url := '/partita/' || m.id;

    update matches set
      starts_at = case when 'time' = any (p_fields)
                       then ((m.starts_at at time zone tz())::date + p_time) at time zone tz() else starts_at end,
      players_per_team = case when 'players_per_team' = any (p_fields) then (p_config->>'players_per_team')::smallint else players_per_team end,
      team_a_kit = case when 'kits' = any (p_fields) then p_config->>'team_a_kit' else team_a_kit end,
      team_b_kit = case when 'kits' = any (p_fields) then p_config->>'team_b_kit' else team_b_kit end,
      booking_open_days = case when 'booking_open' = any (p_fields) then (p_config->>'booking_open_days')::smallint else booking_open_days end,
      booking_open_time = case when 'booking_open' = any (p_fields) then (p_config->>'booking_open_time')::time else booking_open_time end,
      booking_close_days = case when 'booking_close' = any (p_fields) then (p_config->>'booking_close_days')::smallint else booking_close_days end,
      booking_close_time = case when 'booking_close' = any (p_fields) then (p_config->>'booking_close_time')::time else booking_close_time end,
      votes_open_after_min = case when 'votes_open' = any (p_fields) then (p_config->>'votes_open_after_min')::smallint else votes_open_after_min end,
      votes_hours = case when 'votes_close' = any (p_fields) then (p_config->>'votes_hours')::smallint else votes_hours end,
      booking_mode = case when 'booking_mode' = any (p_fields) then coalesce(p_config->>'booking_mode', 'order') else booking_mode end,
      duration_min = case when 'duration' = any (p_fields) then coalesce((p_config->>'duration_min')::smallint, duration_min) else duration_min end
    where id = m.id
    returning * into n;

    if n.starts_at <= now() then raise exception 'Con il nuovo orario la partita del % sarebbe già iniziata', to_char(m.starts_at at time zone tz(), 'DD/MM'); end if;

    v_players_changed := n.players_per_team <> m.players_per_team;
    if v_players_changed then
      -- le formazioni vanno rifatte con il nuovo numero di posizioni
      if exists (select 1 from lineup where match_id = m.id) then
        delete from lineup where match_id = m.id;
        if m.lineup_status <> 'draft' then
          update matches set lineup_status = 'draft' where id = m.id;
          perform notify(array(select user_id from bookings where match_id = m.id and list = 'team'),
            'lineup_change', 'Formazioni da rifare',
            'Si gioca ' || n.players_per_team || ' contro ' || n.players_per_team || ': le squadre verranno rifatte.', v_url || '/squadre', m.id);
        end if;
      end if;
      if n.booking_mode = 'order' then
        perform rebalance_match(m.id);
      else
        perform trim_free_team(m.id);
      end if;
    end if;

    if n.booking_mode <> m.booking_mode then
      perform convert_booking_mode(m.id);
    end if;

    if n.starts_at <> m.starts_at then
      perform notify(array(select user_id from bookings where match_id = m.id and list in ('team','reserve')),
        'match_moved', 'Cambio di orario', 'Si gioca ' || fmt_when(n.starts_at) || '.', v_url, m.id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.mvp_picks(p_match uuid)
returns table (voter_id uuid, team text, pick uuid, deduced boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if (select mvp_mode from matches where id = p_match) = 'per_team' then
    -- regola precedente: un migliore per squadra (partite votate prima del cambio)
    return query
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
  left join ranked r on r.voter_id = vt.voter_id and r.team = t.team and r.rn = 1;
  else
    -- un solo migliore in campo: la scelta esplicita o, se manca, il compagno con il voto più alto
    return query
    with voters as (
      select v.voter_id from player_votes v where v.match_id = p_match
      union
      select e.voter_id from mvp_votes e where e.match_id = p_match
    ),
    ranked as (
      select v.voter_id, l.team, v.target_id,
             row_number() over (partition by v.voter_id order by v.score desc, v.target_id) as rn
      from player_votes v join lineup l on l.match_id = v.match_id and l.user_id = v.target_id
      where v.match_id = p_match
    )
    select vt.voter_id,
           coalesce(lp.team, r.team),
           coalesce(coalesce(e.white_pick, e.black_pick), r.target_id),
           coalesce(e.white_pick, e.black_pick) is null
    from voters vt
    left join mvp_votes e on e.match_id = p_match and e.voter_id = vt.voter_id
    left join lineup lp on lp.match_id = p_match and lp.user_id = coalesce(e.white_pick, e.black_pick)
    left join ranked r on r.voter_id = vt.voter_id and r.rn = 1;
  end if;
end $$;

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

  -- le medie si vedono sempre, anche con pochi votanti (la soglia vale solo per la classifica)

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

create or replace function public.submit_votes_unchecked(
  p_match uuid, p_votes jsonb, p_white_pick uuid default null, p_black_pick uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  v_uid uuid := auth.uid();
  v_pick uuid;
  v_pick_team text;
begin
  select * into m from matches where id = p_match;
  -- un solo migliore in campo: si salva nella colonna della sua squadra
  if m.mvp_mode = 'single' then
    if p_white_pick is not null and p_black_pick is not null then raise exception 'Si sceglie un solo migliore in campo'; end if;
    v_pick := coalesce(p_white_pick, p_black_pick);
    select l.team into v_pick_team from lineup l where l.match_id = p_match and l.user_id = v_pick;
    if v_pick is not null and v_pick_team is null then raise exception 'Il migliore in campo deve essere uno dei giocatori'; end if;
    p_white_pick := case when v_pick_team = 'white' then v_pick end;
    p_black_pick := case when v_pick_team = 'black' then v_pick end;
  end if;
  -- vota chi ha giocato; il Leader (o chi ne fa le veci) anche se non ha giocato
  if not (is_participant(p_match, v_uid) or has_leader_powers(v_uid)) then raise exception 'Vota solo chi ha giocato'; end if;
  if now() < m.votes_opens_at then raise exception 'Si vota da %', fmt_when(m.votes_opens_at); end if;
  if now() > m.votes_closes_at then raise exception 'Le votazioni sono chiuse'; end if;
  -- i voti, una volta inviati, non si cambiano più: per nessuno
  if exists (select 1 from player_votes where match_id = p_match and voter_id = v_uid)
     or exists (select 1 from mvp_votes where match_id = p_match and voter_id = v_uid) then
    raise exception 'Hai già votato: i voti non si possono modificare';
  end if;
  if coalesce(jsonb_array_length(p_votes), 0) = 0 and p_white_pick is null and p_black_pick is null then
    raise exception 'Nessun voto da inviare';
  end if;
  if p_white_pick is not null and not exists (select 1 from lineup where match_id = p_match and user_id = p_white_pick and team = 'white') then
    raise exception 'Il migliore dei % deve essere un giocatore dei %', team_name(m, 'white'), team_name(m, 'white');
  end if;
  if p_black_pick is not null and not exists (select 1 from lineup where match_id = p_match and user_id = p_black_pick and team = 'black') then
    raise exception 'Il migliore dei % deve essere un giocatore dei %', team_name(m, 'black'), team_name(m, 'black');
  end if;

  insert into player_votes as v (match_id, voter_id, target_id, score)
  select p_match, v_uid, x.target_id, x.score
  from jsonb_to_recordset(p_votes) as x(target_id uuid, score numeric)
  where x.target_id <> v_uid and is_participant(p_match, x.target_id) and x.score is not null
  on conflict (match_id, voter_id, target_id) do nothing;

  insert into mvp_votes (match_id, voter_id, white_pick, black_pick)
  values (p_match, v_uid, nullif(p_white_pick, v_uid), nullif(p_black_pick, v_uid))
  on conflict (match_id, voter_id) do nothing;
end $$;

revoke execute on function public.leader_ids(), public.set_app_logo(uuid) from public, anon;
grant execute on function public.leader_ids() to authenticated, service_role;
grant execute on function public.set_app_logo(uuid) to authenticated;
grant execute on function public.app_branding() to anon, authenticated;
