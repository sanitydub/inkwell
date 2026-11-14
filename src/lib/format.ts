const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const full = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const long = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Compact date for the note list: a time today, a day this year, a full date otherwise. */
export function shortDate(ms: number): string {
	const d = new Date(ms);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) return time.format(d);
	if (d.getFullYear() === now.getFullYear()) return dayMonth.format(d);
	return full.format(d);
}

export const longDate = (ms: number) => long.format(new Date(ms));
