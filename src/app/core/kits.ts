import { Match, Team } from './models';

/** Tavolozza delle divise (le stesse chiavi del database: kit_name). */
export interface Kit { key: string; name: string; color: string; ink: string }

export const KITS: Kit[] = [
  { key: 'white', name: 'Bianchi', color: '#fafaf7', ink: '#142019' },
  { key: 'black', name: 'Neri', color: '#1a1c20', ink: '#f4f4f1' },
  { key: 'red', name: 'Rossi', color: '#c8102e', ink: '#ffffff' },
  { key: 'blue', name: 'Blu', color: '#1d4ed8', ink: '#ffffff' },
  { key: 'sky', name: 'Azzurri', color: '#38bdf8', ink: '#082f49' },
  { key: 'yellow', name: 'Gialli', color: '#facc15', ink: '#1a1400' },
  { key: 'green', name: 'Verdi', color: '#15803d', ink: '#ffffff' },
  { key: 'orange', name: 'Arancioni', color: '#f97316', ink: '#1a0b00' },
  { key: 'purple', name: 'Viola', color: '#7e22ce', ink: '#ffffff' },
  { key: 'grey', name: 'Grigi', color: '#9ca3af', ink: '#111827' },
];

export const kit = (key: string | null | undefined): Kit => KITS.find((k) => k.key === key) ?? KITS[0];

/** Nomi delle due squadre di una partita: 'white' è la squadra A, 'black' la squadra B. */
export function teamNames(m: Pick<Match, 'team_a_kit' | 'team_b_kit'> | null | undefined): Record<Team, string> {
  return { white: kit(m?.team_a_kit ?? 'white').name, black: kit(m?.team_b_kit ?? 'black').name };
}
