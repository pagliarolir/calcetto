-- =====================================================================
-- Calcetto del giovedì — schema
-- Tutte le date sono timestamptz; il fuso di riferimento è in app_settings.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- Impostazioni globali (riga unica)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id              smallint primary key default 1 check (id = 1),
  timezone        text     not null default 'Europe/Rome',
  game_weekday    smallint not null default 4 check (game_weekday between 0 and 6), -- 0 = domenica, 4 = giovedì
  game_time       time     not null default '20:00',
  duration_min    smallint not null default 60,
  booking_days_before smallint not null default 3,
  booking_open_time   time not null default '12:00',
  team_size       smallint not null default 10,
  quorum          smallint not null default 5,     -- conferme necessarie oltre a chi inserisce
  vote_min_voters smallint not null default 5,     -- votanti minimi per mostrare le medie
  vote_hours      smallint not null default 48,    -- durata finestra di voto dopo le 21:30
  inactivity_days smallint not null default 15,
  invite_code     text      -- se impostato, chi si registra senza codice resta in attesa di approvazione
);
insert into public.app_settings default values;

-- ---------------------------------------------------------------------
-- Utenti
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  first_name    text not null check (char_length(trim(first_name)) between 1 and 40),
  last_name     text check (char_length(last_name) <= 60),
  nickname      text check (char_length(nickname) <= 30),
  field_role    text check (field_role in ('portiere','difensore','laterale','pivot','jolly')),
  birth_date    date,
  weight_kg     numeric(5,1) check (weight_kg between 30 and 250),
  height_cm     smallint check (height_cm between 120 and 230),
  -- quali campi facoltativi sono visibili agli altri (REQ-003)
  visibility    jsonb not null default
    '{"last_name":true,"nickname":true,"field_role":true,"birth_date":false,"weight_kg":false,"height_cm":false}',
  role          text not null default 'user' check (role in ('leader','premier1','premier2','user')),
  last_seen_at  timestamptz not null default now(),
  active        boolean not null default true,
  pending       boolean not null default false,   -- registrato ma in attesa di approvazione
  created_at    timestamptz not null default now()
);
-- un solo Leader, un solo Premier 1, un solo Premier 2
create unique index profiles_unique_role on public.profiles (role) where role <> 'user';

-- Delega temporanea dei poteri del Leader (REQ-005)
create table public.leadership_delegation (
  id           smallint primary key default 1 check (id = 1),
  delegate_id  uuid references public.profiles (id) on delete set null,
  until        timestamptz,
  created_at   timestamptz not null default now()
);
insert into public.leadership_delegation (id) values (1);

-- ---------------------------------------------------------------------
-- Partite
-- ---------------------------------------------------------------------
create table public.matches (
  id                uuid primary key default gen_random_uuid(),
  nominal_date      date not null,                 -- il giovedì "di calendario" che la partita rappresenta
  starts_at         timestamptz not null,
  duration_min      smallint not null default 60,
  bookings_open_at  timestamptz not null,
  status            text not null default 'scheduled' check (status in ('scheduled','played','cancelled')),
  lineup_status     text not null default 'draft' check (lineup_status in ('draft','pending','official')),
  lineup_delegate   uuid references public.profiles (id) on delete set null,   -- REQ-028
  lineup_proposed_by uuid references public.profiles (id) on delete set null,
  moved             boolean not null default false,                            -- REQ-024
  locked            boolean not null default false,                            -- REQ-040
  -- flag dello scheduler, per non mandare due volte la stessa notifica
  sent_open         boolean not null default false,
  sent_lineup_window boolean not null default false,
  sent_reserve_reminder boolean not null default false,
  sent_result       boolean not null default false,
  created_at        timestamptz not null default now()
);
create index matches_starts_at on public.matches (starts_at);

-- Prenotazioni (REQ-009..REQ-023)
create table public.bookings (
  match_id    uuid not null references public.matches (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  choice      text not null check (choice in ('present','absent','reserve')),  -- cosa ha dichiarato l'utente
  list        text not null check (list in ('team','reserve','out')),          -- dove si trova davvero
  sort_key    timestamptz not null default clock_timestamp(),                  -- ordine di arrivo nella lista
  placed_by   uuid references public.profiles (id) on delete set null,         -- inserito dal Leader
  late_withdrawal boolean not null default false,                              -- rinuncia nelle 24 ore
  reserve_reply   text check (reserve_reply in ('confirmed','declined')),      -- REQ-020
  updated_at  timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index bookings_list on public.bookings (match_id, list, sort_key);

-- Finestre di prenotazione esclusive (REQ-023)
create table public.priority_windows (
  match_id  uuid not null references public.matches (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  opens_at  timestamptz not null,
  notified  boolean not null default false,
  primary key (match_id, user_id)
);

-- ---------------------------------------------------------------------
-- Formazioni (REQ-026..REQ-032)
-- field_slot: 1 portiere, 2 difensore, 3 laterale sx, 4 laterale dx, 5 pivot
-- ---------------------------------------------------------------------
create table public.lineup (
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  team       text not null check (team in ('white','black')),
  field_slot smallint check (field_slot between 1 and 5),
  primary key (match_id, user_id)
);
create unique index lineup_slot_unique on public.lineup (match_id, team, field_slot) where field_slot is not null;

-- ---------------------------------------------------------------------
-- Risultato (REQ-033..REQ-040)
-- diff = gol bianchi - gol neri. I gol esatti sono facoltativi.
-- ---------------------------------------------------------------------
create table public.results (
  match_id      uuid primary key references public.matches (id) on delete cascade,
  diff          smallint not null,
  white_goals   smallint check (white_goals >= 0),
  black_goals   smallint check (black_goals >= 0),
  entered_by    uuid references public.profiles (id) on delete set null,
  entered_at    timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending','homologated')),
  homologated_by text check (homologated_by in ('quorum','staff','leader')),
  homologated_at timestamptz,
  check ((white_goals is null) = (black_goals is null)),
  check (white_goals is null or diff = white_goals - black_goals)
);

create table public.result_reviews (
  match_id  uuid not null references public.matches (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  agree     boolean not null,
  note      text check (char_length(note) <= 200),
  at        timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table public.scorers (
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  goals      smallint not null default 0 check (goals >= 0),
  assists    smallint not null default 0 check (assists >= 0),
  own_goals  smallint not null default 0 check (own_goals >= 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- ---------------------------------------------------------------------
-- Votazioni (REQ-041..REQ-046)
-- ---------------------------------------------------------------------
create table public.player_votes (
  match_id   uuid not null references public.matches (id) on delete cascade,
  voter_id   uuid not null references public.profiles (id) on delete cascade,
  target_id  uuid not null references public.profiles (id) on delete cascade,
  score      numeric(3,1) not null check (score between 1 and 10 and score * 2 = floor(score * 2)),
  primary key (match_id, voter_id, target_id),
  check (voter_id <> target_id)
);

create table public.mvp_votes (
  match_id    uuid not null references public.matches (id) on delete cascade,
  voter_id    uuid not null references public.profiles (id) on delete cascade,
  white_pick  uuid references public.profiles (id) on delete set null,
  black_pick  uuid references public.profiles (id) on delete set null,
  primary key (match_id, voter_id),
  check (white_pick is distinct from voter_id and black_pick is distinct from voter_id)
);

create table public.vote_grants (
  match_id    uuid not null references public.matches (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  until       timestamptz not null,
  primary key (match_id, user_id)
);

-- ---------------------------------------------------------------------
-- Chat di partita (REQ-025)
-- ---------------------------------------------------------------------
create table public.chat_messages (
  id         bigint generated always as identity primary key,
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index chat_messages_match on public.chat_messages (match_id, created_at);

-- ---------------------------------------------------------------------
-- Notifiche
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- Coda notifiche: è anche la "casella avvisi" dentro l'app
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null,
  url         text,
  match_id    uuid references public.matches (id) on delete cascade,
  actions     jsonb,            -- es. [{"action":"present","title":"Ci sono"}]
  created_at  timestamptz not null default now(),
  push_claimed_at timestamptz,  -- presa in carico dal dispatcher
  read_at     timestamptz
);
create index notifications_user on public.notifications (user_id, created_at desc);
create index notifications_pending on public.notifications (id) where push_claimed_at is null;
