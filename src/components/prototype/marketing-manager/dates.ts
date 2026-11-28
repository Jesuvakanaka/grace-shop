// Date and money helpers for the prototype. Dates are plain "YYYY-MM-DD" strings in UTC,
// so a refresh, a time zone or the server never shifts a demo day.

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const SHORT_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Mon 1 Dec" */
export const fmtDay = (iso: string) => DAY_FMT.format(new Date(`${iso}T00:00:00Z`));
/** "1 Dec" */
export const fmtShort = (iso: string) => SHORT_FMT.format(new Date(`${iso}T00:00:00Z`));

/** "Today", "Tomorrow", "Yesterday" or "Mon 1 Dec". */
export function relDay(iso: string, today: string): string {
  const d = daysBetween(today, iso);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return fmtDay(iso);
}

/** Round to cents. */
export const r2 = (n: number) => Math.round(n * 100) / 100;

/** "$65" or "$1.56". */
export function money(n: number): string {
  const v = r2(n);
  return `$${Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const num = (n: number) => Math.round(n).toLocaleString('en-US');
