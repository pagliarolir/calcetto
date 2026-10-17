const TZ = 'Europe/Rome';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('it-IT', { timeZone: TZ, ...opts });

const dayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const time = fmt({ hour: '2-digit', minute: '2-digit' });
const dateShort = fmt({ day: '2-digit', month: '2-digit', year: '2-digit' });

export const fmtDayLong = (iso: string) => dayLong.format(new Date(iso));
export const fmtDayShort = (iso: string) => dayShort.format(new Date(iso));
export const fmtTime = (iso: string) => time.format(new Date(iso));
export const fmtDate = (iso: string) => dateShort.format(new Date(iso));
export const fmtWhen = (iso: string) => `${fmtDayShort(iso)} alle ${fmtTime(iso)}`;

/** "tra 2 giorni", "tra 3 ore", "tra 12 minuti", "adesso" */
export function fmtCountdown(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const rtf = new Intl.RelativeTimeFormat('it-IT', { numeric: 'auto' });
  if (abs < 60_000) return 'adesso';
  if (abs < 3_600_000) return rtf.format(Math.round(ms / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(ms / 3_600_000), 'hour');
  return rtf.format(Math.round(ms / 86_400_000), 'day');
}

export function fmtAgo(iso: string): string {
  return fmtCountdown(iso);
}

/** Valore per <input type="datetime-local"> nel fuso di Roma. */
export function toLocalInput(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}`;
}

/** Interpreta "2026-10-15T20:00" come ora di Roma e restituisce un ISO UTC. */
export function fromLocalInput(value: string): string {
  const guess = new Date(value + 'Z');
  const roma = new Date(toLocalInput(guess.toISOString()) + 'Z');
  const offset = roma.getTime() - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export function age(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

export function diffText(diff: number, white: number | null, black: number | null,
                         names: { white: string; black: string } = { white: 'Bianchi', black: 'Neri' }): string {
  if (white !== null && black !== null) return `${white} – ${black}`;
  if (diff === 0) return 'Pareggio';
  return diff > 0 ? `${names.white} +${diff}` : `${names.black} +${-diff}`;
}

const weekday = fmt({ weekday: 'long' });
export const fmtWeekday = (iso: string) => weekday.format(new Date(iso));

/** Collegamento alle mappe: Mappe di Apple su iPhone e iPad, Google Maps altrove. */
export function mapsUrl(name: string | null, address: string | null): string | null {
  const q = [name, address].filter((x) => !!x && x.trim()).join(', ');
  if (!q) return null;
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    ? `https://maps.apple.com/?q=${encodeURIComponent(q)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
