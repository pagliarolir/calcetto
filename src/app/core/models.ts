export type Role = 'leader' | 'premier1' | 'premier2' | 'user';
export type FieldRole = 'portiere' | 'difensore' | 'laterale' | 'pivot' | 'jolly';
export type Choice = 'present' | 'absent' | 'reserve';
export type List = 'team' | 'reserve' | 'out';
export type Team = 'white' | 'black';

export type VisibilityKey = 'last_name' | 'nickname' | 'field_role' | 'birth_date' | 'weight_kg' | 'height_cm' | 'avatar';

export interface Profile {
  id: string;
  first_name: string;
  last_name: string | null;
  nickname: string | null;
  field_role: FieldRole | null;
  birth_date: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  visibility: Record<VisibilityKey, boolean>;
  role: Role;
  last_seen_at: string;
  active: boolean;
  pending: boolean;
  must_change_password: boolean;
  avatar_path: string | null;
}

/** Profilo visto dagli altri: i campi nascosti arrivano null. */
export interface Member {
  id: string;
  first_name: string;
  last_name: string | null;
  nickname: string | null;
  field_role: FieldRole | null;
  birth_date: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  role: Role;
  active: boolean;
  pending: boolean;
  created_at: string;
  last_seen_at: string | null;
  /** percorso nello Storage; null se manca o se l'utente la nasconde */
  avatar_path: string | null;
}

export interface Me {
  profile: Profile;
  leader_powers: boolean;
  staff: boolean;
  acting_leader: string | null;
  titular_leader: string | null;
  delegation: { delegate_id: string; until: string | null } | null;
}

export interface Match {
  id: string;
  nominal_date: string;
  starts_at: string;
  duration_min: number;
  bookings_open_at: string;
  status: 'scheduled' | 'played' | 'cancelled';
  lineup_status: 'draft' | 'pending' | 'official';
  lineup_delegate: string | null;
  lineup_proposed_by: string | null;
  moved: boolean;
  locked: boolean;
  ends_at: string;
  result_opens_at: string;
  lock_at: string;
  votes_close_at: string;
  lineup_opens_at: string;
  chat_opens_at: string;
  chat_closes_at: string;
  venue_name: string | null;
  venue_address: string | null;
  venue_url: string | null;
}

export interface BoardRow {
  match_id: string;
  user_id: string;
  choice: Choice;
  list: List;
  placed_by: string | null;
  late_withdrawal: boolean;
  reserve_reply: 'confirmed' | 'declined' | null;
  updated_at: string;
  is_leader: boolean;
  slot: number | null;
}

export interface LineupRow {
  match_id: string;
  user_id: string;
  team: Team;
  field_slot: number | null;
}

export interface Result {
  match_id: string;
  diff: number;
  white_goals: number | null;
  black_goals: number | null;
  entered_by: string | null;
  entered_at: string;
  status: 'pending' | 'homologated';
  homologated_by: 'quorum' | 'staff' | 'leader' | null;
  homologated_at: string | null;
}

export interface ResultReview {
  match_id: string;
  user_id: string;
  agree: boolean;
  note: string | null;
  at: string;
}

export interface Scorer {
  match_id: string;
  user_id: string;
  goals: number;
  assists: number;
  own_goals: number;
}

export interface PlayerVote {
  match_id: string;
  voter_id: string;
  target_id: string;
  score: number;
}

export interface MvpVote {
  match_id: string;
  voter_id: string;
  white_pick: string | null;
  black_pick: string | null;
}

export interface VoteSummary {
  voters: number;
  threshold: number;
  my_votes_done: boolean;
  players: { user_id: string; avg: number | null; votes: number; mvp_votes: number; is_mvp: boolean }[] | null;
}

export interface ChatMessage {
  id: number;
  match_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  match_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface StatsRow {
  user_id: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  points_per_game: number | null;
  win_pct: number | null;
  goals: number;
  goals_per_game: number | null;
  assists: number;
  own_goals: number;
  team_goals_for: number | null;
  team_goals_against: number | null;
  team_goal_diff: number | null;
  avg_vote: number | null;
  best_avg_vote: number | null;
  worst_avg_vote: number | null;
  mvp_count: number;
  current_form: string | null;
  cur_win_streak: number;
  best_win_streak: number;
  cur_unbeaten: number;
  best_unbeaten: number;
  cur_loss_streak: number;
  worst_loss_streak: number;
  cur_winless: number;
  worst_winless: number;
  attendances: number;
  late_withdrawals: number;
}

export interface MatchFact {
  match_id: string;
  starts_at: string;
  user_id: string;
  team: Team;
  outcome: 'W' | 'D' | 'L';
  team_goals: number | null;
  opp_goals: number | null;
  diff: number;
  goals: number;
  assists: number;
  own_goals: number;
  avg_vote: number | null;
  is_mvp: boolean;
}

export interface AttendanceRow {
  match_id: string;
  starts_at: string;
  user_id: string;
  choice: Choice;
  list: List;
  late_withdrawal: boolean;
}

export interface AppSettings {
  timezone: string;
  game_weekday: number;
  game_time: string;
  duration_min: number;
  booking_days_before: number;
  booking_open_time: string;
  team_size: number;
  quorum: number;
  vote_min_voters: number;
  vote_hours: number;
  inactivity_days: number;
  invite_code: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_url: string | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  leader: 'Leader',
  premier1: 'Primo Premier',
  premier2: 'Secondo Premier',
  user: 'Giocatore',
};

export const FIELD_ROLE_LABEL: Record<FieldRole, string> = {
  portiere: 'Portiere',
  difensore: 'Difensore',
  laterale: 'Laterale',
  pivot: 'Pivot',
  jolly: 'Jolly',
};

/** Posizioni del calcio a 5 sul campo disegnato. */
export const FIELD_SLOTS: { slot: number; label: string }[] = [
  { slot: 1, label: 'Portiere' },
  { slot: 2, label: 'Difensore' },
  { slot: 3, label: 'Laterale sinistro' },
  { slot: 4, label: 'Laterale destro' },
  { slot: 5, label: 'Pivot' },
];

export const TEAM_LABEL: Record<Team, string> = { white: 'Bianchi', black: 'Neri' };
