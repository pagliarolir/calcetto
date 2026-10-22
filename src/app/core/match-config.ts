import { AppSettings, BookingMode, Match } from './models';

/** Configurazione di una partita (la stessa forma usata dal database). */
export interface MatchConfig {
  players_per_team: number;
  team_a_kit: string;
  team_b_kit: string;
  booking_open_days: number;
  booking_open_time: string;   // HH:MM
  booking_close_days: number;
  booking_close_time: string;  // HH:MM
  votes_open_after_min: number;
  votes_hours: number;
  booking_mode: BookingMode;
  /** durata della partita in minuti (1-90) */
  duration_min: number;
}

export type ConfigField = 'time' | 'duration' | 'booking_mode' | 'players_per_team' | 'kits' | 'booking_open' | 'booking_close' | 'votes_open' | 'votes_close';

export const FIELD_LABEL: Record<ConfigField, string> = {
  time: 'ora della partita',
  booking_mode: 'modalità di prenotazione',
  duration: 'durata',
  players_per_team: 'numero di giocatori',
  kits: 'colori delle squadre',
  booking_open: 'apertura delle prenotazioni',
  booking_close: 'chiusura delle prenotazioni',
  votes_open: 'apertura delle votazioni',
  votes_close: 'durata delle votazioni',
};

export const hhmm = (t: string | null | undefined): string => (t ?? '').slice(0, 5);

export function configOfMatch(m: Match): MatchConfig {
  return {
    players_per_team: m.players_per_team, team_a_kit: m.team_a_kit, team_b_kit: m.team_b_kit,
    booking_open_days: m.booking_open_days, booking_open_time: hhmm(m.booking_open_time),
    booking_close_days: m.booking_close_days, booking_close_time: hhmm(m.booking_close_time),
    votes_open_after_min: m.votes_open_after_min, votes_hours: m.votes_hours,
    booking_mode: m.booking_mode,
    duration_min: m.duration_min,
  };
}

export function configOfSettings(s: AppSettings): MatchConfig {
  return {
    players_per_team: s.players_per_team, team_a_kit: s.team_a_kit, team_b_kit: s.team_b_kit,
    booking_open_days: s.booking_days_before, booking_open_time: hhmm(s.booking_open_time),
    booking_close_days: s.booking_close_days, booking_close_time: hhmm(s.booking_close_time),
    votes_open_after_min: s.votes_open_after_min, votes_hours: s.vote_hours,
    booking_mode: s.booking_mode,
    duration_min: s.duration_min,
  };
}

/** Impostazioni cambiate tra due configurazioni (e tra due orari, se indicati). */
export function changedFields(before: MatchConfig, after: MatchConfig, timeBefore?: string, timeAfter?: string): ConfigField[] {
  const out: ConfigField[] = [];
  if (timeBefore !== undefined && timeAfter !== undefined && hhmm(timeBefore) !== hhmm(timeAfter)) out.push('time');
  if (before.duration_min !== after.duration_min) out.push('duration');
  if (before.booking_mode !== after.booking_mode) out.push('booking_mode');
  if (before.players_per_team !== after.players_per_team) out.push('players_per_team');
  if (before.team_a_kit !== after.team_a_kit || before.team_b_kit !== after.team_b_kit) out.push('kits');
  if (before.booking_open_days !== after.booking_open_days || before.booking_open_time !== after.booking_open_time) out.push('booking_open');
  if (before.booking_close_days !== after.booking_close_days || before.booking_close_time !== after.booking_close_time) out.push('booking_close');
  if (before.votes_open_after_min !== after.votes_open_after_min) out.push('votes_open');
  if (before.votes_hours !== after.votes_hours) out.push('votes_close');
  return out;
}

export const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/** Date di calendario (AAAA-MM-GG) di un giorno della settimana tra due date incluse. */
export function weeklyDates(from: string, until: string, weekday: number): string[] {
  if (!from || !until) return [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [uy, um, ud] = until.split('-').map(Number);
  const d = new Date(fy, fm - 1, fd);
  const end = new Date(uy, um - 1, ud);
  const out: string[] = [];
  while (d <= end && out.length < 120) {
    if (d.getDay() === weekday) out.push(isoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Prossima data (oggi compreso) che cade nel giorno della settimana indicato. */
export function nextWeekday(weekday: number): string {
  const d = new Date();
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

export const shortDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
};
