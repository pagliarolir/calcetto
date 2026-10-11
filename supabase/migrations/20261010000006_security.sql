-- =====================================================================
-- Sicurezza: RLS ovunque, scritture solo tramite funzioni controllate
-- =====================================================================

alter table public.app_settings          enable row level security;
alter table public.profiles              enable row level security;
alter table public.leadership_delegation enable row level security;
alter table public.matches               enable row level security;
alter table public.bookings              enable row level security;
alter table public.priority_windows      enable row level security;
alter table public.lineup                enable row level security;
alter table public.results               enable row level security;
alter table public.result_reviews        enable row level security;
alter table public.scorers               enable row level security;
alter table public.player_votes          enable row level security;
alter table public.mvp_votes             enable row level security;
alter table public.vote_grants           enable row level security;
alter table public.chat_messages         enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.notifications         enable row level security;

-- Nessun accesso anonimo
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;

-- Lettura per i membri autenticati
grant select on public.app_settings, public.leadership_delegation, public.matches, public.bookings,
  public.priority_windows, public.lineup, public.results, public.result_reviews, public.scorers,
  public.player_votes, public.mvp_votes, public.vote_grants, public.chat_messages,
  public.push_subscriptions, public.notifications, public.profiles
to authenticated;

create policy "membri leggono" on public.app_settings          for select to authenticated using (true);
create policy "membri leggono" on public.leadership_delegation for select to authenticated using (true);
create policy "membri leggono" on public.matches               for select to authenticated using (is_active_member());
create policy "membri leggono" on public.bookings              for select to authenticated using (is_active_member());
create policy "membri leggono" on public.results               for select to authenticated using (is_active_member());
create policy "membri leggono" on public.result_reviews        for select to authenticated using (is_active_member());
create policy "membri leggono" on public.scorers               for select to authenticated using (is_active_member());

create policy "propria finestra o staff" on public.priority_windows for select to authenticated
  using (user_id = auth.uid() or is_staff());

-- Formazioni: pubbliche solo quando ufficiali (REQ-029)
create policy "ufficiali o chi le prepara" on public.lineup for select to authenticated
  using (
    exists (select 1 from matches m where m.id = match_id and m.lineup_status = 'official')
    or is_staff()
    or exists (select 1 from matches m where m.id = match_id and m.lineup_delegate = auth.uid())
  );

-- Voti segreti (REQ-042, REQ-045, REQ-046)
create policy "i miei voti, il Leader o chi è autorizzato" on public.player_votes for select to authenticated
  using (voter_id = auth.uid() or can_see_votes(match_id));
create policy "i miei voti, il Leader o chi è autorizzato" on public.mvp_votes for select to authenticated
  using (voter_id = auth.uid() or can_see_votes(match_id));
create policy "proprie o Leader" on public.vote_grants for select to authenticated
  using (user_id = auth.uid() or has_leader_powers());

-- Profili: ognuno legge il proprio; gli altri passano dalla vista "members"
create policy "il mio profilo" on public.profiles for select to authenticated using (id = auth.uid());
create policy "modifico il mio profilo" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
grant update (first_name, last_name, nickname, field_role, birth_date, weight_kg, height_cm, visibility)
  on public.profiles to authenticated;

-- Impostazioni modificabili dal Leader
create policy "il Leader modifica" on public.app_settings for update to authenticated
  using (has_leader_powers()) with check (has_leader_powers());
grant update (game_weekday, game_time, duration_min, booking_days_before, booking_open_time,
  quorum, vote_min_voters, vote_hours, invite_code) on public.app_settings to authenticated;

-- Chat: lettura sempre, scrittura da 24h prima a 24h dopo (REQ-025)
create policy "membri leggono" on public.chat_messages for select to authenticated using (is_active_member());
create policy "scrivo nella finestra della chat" on public.chat_messages for insert to authenticated
  with check (
    user_id = auth.uid() and is_active_member()
    and exists (select 1 from matches m where m.id = match_id
                and now() between chat_opens_at(m) and chat_closes_at(m))
  );
create policy "cancello i miei messaggi" on public.chat_messages for delete to authenticated
  using (user_id = auth.uid() or is_staff());
grant insert (match_id, user_id, body), delete on public.chat_messages to authenticated;

-- Dispositivi per le push
create policy "i miei dispositivi" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant insert, update, delete on public.push_subscriptions to authenticated;

-- Avvisi in app
create policy "i miei avvisi" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "segno come letti" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------
-- Vista dei membri: rispetta le preferenze di visibilità (REQ-003)
-- Gira con i permessi del proprietario, quindi espone solo i campi consentiti.
-- ---------------------------------------------------------------------
create or replace view public.members as
with me as (select auth.uid() as uid, public.is_staff() as staff)
select
  p.id,
  p.first_name,
  case when p.id = me.uid or (p.visibility->>'last_name')::boolean  then p.last_name  end as last_name,
  case when p.id = me.uid or (p.visibility->>'nickname')::boolean   then p.nickname   end as nickname,
  case when p.id = me.uid or (p.visibility->>'field_role')::boolean then p.field_role end as field_role,
  case when p.id = me.uid or (p.visibility->>'birth_date')::boolean then p.birth_date end as birth_date,
  case when p.id = me.uid or (p.visibility->>'weight_kg')::boolean  then p.weight_kg  end as weight_kg,
  case when p.id = me.uid or (p.visibility->>'height_cm')::boolean  then p.height_cm  end as height_cm,
  p.role, p.active, p.pending, p.created_at,
  case when me.staff or p.id = me.uid then p.last_seen_at end as last_seen_at
from public.profiles p cross join me
where me.uid is not null
  and (p.active or me.staff or exists (select 1 from public.bookings b where b.user_id = p.id));

revoke all on public.members from anon;
grant select on public.members to authenticated;
grant select on public.booking_board to authenticated;

-- ---------------------------------------------------------------------
-- Funzioni richiamabili dall'app
-- ---------------------------------------------------------------------
grant execute on function
  public.touch(), public.book(uuid, text), public.leader_book(uuid, uuid, text),
  public.set_priority_window(uuid, uuid[], timestamptz), public.clear_priority_window(uuid, uuid),
  public.reserve_reply(uuid, text), public.move_match(uuid, timestamptz), public.cancel_match(uuid),
  public.set_member_role(uuid, text), public.transfer_leadership(uuid),
  public.delegate_leadership(uuid, timestamptz), public.deactivate_member(uuid), public.approve_member(uuid),
  public.set_lineup_delegate(uuid, uuid), public.save_lineup(uuid, jsonb, boolean), public.review_lineup(uuid, boolean),
  public.submit_result(uuid, int, int, int), public.review_result(uuid, boolean, text),
  public.staff_homologate(uuid), public.save_scorers(uuid, jsonb), public.scorer_issues(uuid),
  public.submit_votes(uuid, jsonb, uuid, uuid), public.vote_summary(uuid),
  public.grant_vote_visibility(uuid, uuid[]), public.can_see_votes(uuid),
  public.stats_table(timestamptz, timestamptz), public.attendance_register(timestamptz, timestamptz),
  public.player_history(uuid, timestamptz, timestamptz),
  public.has_leader_powers(uuid), public.is_staff(uuid), public.is_active_member(uuid),
  public.titular_leader(), public.acting_leader(), public.display_name(uuid), public.is_participant(uuid, uuid),
  public.tz(), public.fmt_when(timestamptz), public.team_label(text),
  public.ends_at(public.matches), public.result_opens_at(public.matches), public.lock_at(public.matches),
  public.votes_close_at(public.matches), public.lineup_opens_at(public.matches),
  public.chat_opens_at(public.matches), public.chat_closes_at(public.matches),
  public.mvp_picks(uuid), public.player_match_facts(timestamptz, timestamptz)
to authenticated;

-- Le funzioni interne restano private (eseguibili solo da service_role / owner)
revoke execute on function
  public._book(uuid, uuid, uuid, text, boolean), public.notify(uuid[], text, text, text, text, uuid, jsonb),
  public.kick_dispatcher(), public.claim_notifications(int), public.create_match(timestamptz, date),
  public.ensure_next_match(), public.homologate(uuid, text), public.announce_lineup(uuid, boolean),
  public.notify_lineup_change(uuid, text), public.staff_ids()
from authenticated;
grant execute on function public._book(uuid, uuid, uuid, text, boolean), public.claim_notifications(int)
to service_role;

-- mvp_picks espone le scelte singole: lo limitiamo a chi può vedere i voti
revoke execute on function public.mvp_picks(uuid) from authenticated;

-- ---------------------------------------------------------------------
-- Realtime: tabellone, chat e avvisi si aggiornano dal vivo
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.bookings, public.chat_messages, public.notifications,
  public.results, public.result_reviews, public.matches, public.lineup;
